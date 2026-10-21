-- Local preparation only. Apply separately before enabling the new POS client.
-- One RPC call is one PostgreSQL transaction: exceptions roll back every write.
create table if not exists public.pos_sale_commits (
  id text primary key,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.pos_sale_commits enable row level security;
revoke all on public.pos_sale_commits from public, anon, authenticated;

create or replace function public.commit_pos_sale(p_order jsonb, p_verified_upi boolean default false)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  prior public.pos_sale_commits%rowtype;
  product public.products%rowtype;
  line jsonb;
  orders jsonb; variants jsonb; sizes jsonb; types jsonb;
  product_variants jsonb; product_sizes jsonb; chosen jsonb;
  variant_key text; size_key text; size_name text; variant_name text;
  variant_index integer; quantity integer; available integer; remaining integer;
  order_id text := p_order->>'id';
  saved_order jsonb; result jsonb; snapshots jsonb;
  subtotal numeric := 0; discount numeric; total numeric;
begin
  if jsonb_typeof(p_order) is distinct from 'object'
    or order_id is null or order_id !~ '^#FZ-POS-[A-Za-z0-9-]{6,80}$'
    or p_order->>'posPaymentMethod' is null or not (p_order->>'posPaymentMethod' in ('Cash', 'Card') or (p_verified_upi and p_order->>'posPaymentMethod'='UPI'))
    or jsonb_typeof(p_order->'items') is distinct from 'array'
    or jsonb_array_length(p_order->'items') not between 1 and 200 then
    raise exception using errcode='22023', message='Invalid POS sale';
  end if;
  -- Serialize POS commits across worker instances, including repeated requests.
  perform pg_advisory_xact_lock(hashtextextended('fanzzy-atomic-pos', 0));
  select * into prior from public.pos_sale_commits where id=order_id;
  if found then
    if prior.request <> p_order then
      raise exception using errcode='23505', message='Sale reference already used for a different bill';
    end if;
    return jsonb_build_object('order',prior.result->'order','products','[]'::jsonb,'orders',
      coalesce((select value::jsonb from public.store_settings where key='orders'),'[]'::jsonb),'replayed',true);
  end if;
  insert into public.store_settings(key, value) values
    ('orders','[]'), ('product_variants','{}'), ('product_size_stock','{}'), ('product_variant_type','{}')
    on conflict (key) do nothing;
  perform 1 from public.store_settings where key in ('orders','product_variants','product_size_stock','product_variant_type') order by key for update;
  select value::jsonb into orders from public.store_settings where key='orders';
  select value::jsonb into variants from public.store_settings where key='product_variants';
  select value::jsonb into sizes from public.store_settings where key='product_size_stock';
  select value::jsonb into types from public.store_settings where key='product_variant_type';
  if jsonb_typeof(orders) <> 'array' or jsonb_typeof(variants) <> 'object' or jsonb_typeof(sizes) <> 'object' or jsonb_typeof(types) <> 'object' then
    raise exception using errcode='22023', message='Saved inventory or orders are invalid';
  end if;
  if exists(select 1 from jsonb_array_elements(orders) o where o->>'id'=order_id) and not p_verified_upi then
    raise exception using errcode='23505', message='Order reference already exists; check Orders';
  end if;
  if p_verified_upi then
    if p_order->>'posPaymentMethod'<>'UPI' or coalesce(p_order->>'razorpayPaymentId','')='' then
      raise exception using errcode='22023', message='Verified UPI payment required';
    end if;
    select coalesce(jsonb_agg(o),'[]'::jsonb) into orders from jsonb_array_elements(orders) o where o->>'id' is distinct from order_id;
  end if;
  -- Lock all product rows in a consistent order before touching any stock.
  perform 1 from public.products p where p.sku in
    (select item->>'productId' from jsonb_array_elements(p_order->'items') item)
    order by p.sku for update;
  for line in select * from jsonb_array_elements(p_order->'items') loop
    if coalesce(line->>'quantity','') !~ '^[1-9][0-9]{0,2}$' then
      raise exception using errcode='22023', message='Invalid sale quantity';
    end if;
    quantity := (line->>'quantity')::integer;
    select * into product from public.products where sku=line->>'productId';
    if not found or product.status='Draft' or product.price<=0 then
      raise exception using errcode='22023', message='Product is unavailable; refresh the catalog';
    end if;
    subtotal := subtotal + regexp_replace(coalesce(line->>'price',''), '[^0-9.-]', '', 'g')::numeric * quantity;
    if regexp_replace(coalesce(line->>'price',''), '[^0-9.-]', '', 'g')::numeric < 0 then
      raise exception using errcode='22023', message='Invalid sale price';
    end if;
    select key into variant_key from jsonb_object_keys(variants) key
      where regexp_replace(lower(key),'[^a-z0-9]','','g')=regexp_replace(lower(product.sku),'[^a-z0-9]','','g') limit 1;
    select key into size_key from jsonb_object_keys(sizes) key
      where regexp_replace(lower(key),'[^a-z0-9]','','g')=regexp_replace(lower(product.sku),'[^a-z0-9]','','g') limit 1;
    variant_key := coalesce(variant_key,product.sku); size_key := coalesce(size_key,product.sku);
    product_variants := coalesce(variants->variant_key,'[]');
    product_sizes := coalesce(sizes->size_key,'{}');
    size_name := nullif(trim(line->>'size'),''); variant_name := nullif(trim(line->>'variantName'),'');
    variant_index := null; chosen := null;
    if size_name is not null or variant_name is not null then
      select (ordinality-1)::integer, value into variant_index, chosen
        from jsonb_array_elements(product_variants) with ordinality
        where lower(regexp_replace(trim(coalesce(case when size_name is not null then value->>'size' end, value->>'name', 'Option '||ordinality)), '^size\s+', '', 'i'))
          = lower(regexp_replace(coalesce(size_name,variant_name), '^size\s+', '', 'i')) limit 1;
    elsif jsonb_array_length(product_variants)>0 or product_sizes<>'{}'::jsonb then
      raise exception using errcode='22023', message='Select the exact size or variant';
    end if;
    if size_name is not null then
      select key into size_name from jsonb_object_keys(product_sizes) key
        where lower(regexp_replace(trim(key),'^size\s+','','i'))=lower(regexp_replace(size_name,'^size\s+','','i')) limit 1;
      if size_name is null and (chosen is null or chosen->>'stock' is null) then
        raise exception using errcode='22023', message='Selected size no longer exists';
      end if;
      if size_name is not null then
        available := (product_sizes->>size_name)::integer;
        if available < quantity then raise exception using errcode='P0001', message='Not enough size stock'; end if;
        product_sizes := jsonb_set(product_sizes,array[size_name],to_jsonb(available-quantity));
        sizes := jsonb_set(sizes,array[size_key],product_sizes);
      end if;
    end if;
    if chosen is not null and chosen->>'stock' is not null then
      available := (chosen->>'stock')::integer;
      if available < quantity then raise exception using errcode='P0001', message='Not enough variant stock'; end if;
      product_variants := jsonb_set(product_variants,array[variant_index::text,'stock'],to_jsonb(available-quantity));
      variants := jsonb_set(variants,array[variant_key],product_variants);
    elsif variant_name is not null and line->>'size' is null then
      raise exception using errcode='22023', message='Selected variant no longer exists';
    elsif line->>'size' is null then
      if product.stock < quantity then raise exception using errcode='P0001', message='Not enough product stock'; end if;
    end if;
    update public.products set stock=greatest(0, stock-quantity), updated_at=now() where sku=product.sku;
  end loop;
  discount := coalesce((p_order->>'couponDiscount')::numeric,0);
  total := regexp_replace(coalesce(p_order->>'total',''), '[^0-9.-]', '', 'g')::numeric;
  if discount<0 or discount>subtotal or total<0 or round(subtotal-discount,2)<>round(total,2) then
    raise exception using errcode='22023', message='Bill total does not match its items and discount';
  end if;
  for product in select * from public.products where sku in
    (select item->>'productId' from jsonb_array_elements(p_order->'items') item) loop
    select key into variant_key from jsonb_object_keys(variants) key
      where regexp_replace(lower(key),'[^a-z0-9]','','g')=regexp_replace(lower(product.sku),'[^a-z0-9]','','g') limit 1;
    select key into size_key from jsonb_object_keys(sizes) key
      where regexp_replace(lower(key),'[^a-z0-9]','','g')=regexp_replace(lower(product.sku),'[^a-z0-9]','','g') limit 1;
    if variant_key is not null and exists(select 1 from jsonb_array_elements(variants->variant_key) v where v->>'stock' is not null) then
      select coalesce(sum((v->>'stock')::integer),0) into remaining from jsonb_array_elements(variants->variant_key) v;
    elsif size_key is not null and sizes->size_key<>'{}'::jsonb then
      select coalesce(sum(value::integer),0) into remaining from jsonb_each_text(sizes->size_key);
    else remaining := product.stock;
    end if;
    update public.products set status=case when remaining<=0 then 'Draft' when remaining<10 then 'Low stock' else 'Published' end where sku=product.sku;
  end loop;
  saved_order := (case when p_verified_upi then p_order else p_order - 'razorpayPaymentId' - 'razorpayOrderId' end) || jsonb_build_object(
    'posSale',true,'inventoryAdjusted',true,'status','Delivered',
    'paymentMethod',case when p_order->>'posPaymentMethod'='Cash' then 'cod' else 'online' end,
    'paymentStatus',case when p_order->>'posPaymentMethod'='Cash' then 'cod_collected' else 'paid' end);
  orders := jsonb_build_array(saved_order)||orders;
  update public.store_settings set value=orders::text, updated_at=now() where key='orders';
  update public.store_settings set value=variants::text, updated_at=now() where key='product_variants';
  update public.store_settings set value=sizes::text, updated_at=now() where key='product_size_stock';
  select coalesce(jsonb_agg(jsonb_build_object('sku',p.sku,'stock',p.stock,'status',p.status,'variants',coalesce((select value from jsonb_each(variants) where regexp_replace(lower(key),'[^a-z0-9]','','g')=regexp_replace(lower(p.sku),'[^a-z0-9]','','g') limit 1),'[]'::jsonb),'sizeStock',coalesce((select value from jsonb_each(sizes) where regexp_replace(lower(key),'[^a-z0-9]','','g')=regexp_replace(lower(p.sku),'[^a-z0-9]','','g') limit 1),'{}'::jsonb))),'[]')
    into snapshots from public.products p where p.sku in (select item->>'productId' from jsonb_array_elements(p_order->'items') item);
  result := jsonb_build_object('order',saved_order,'products',snapshots,'replayed',false);
  insert into public.pos_sale_commits(id,request,result) values(order_id,p_order,jsonb_build_object('order',saved_order));
  return result || jsonb_build_object('orders',orders);
end;
$$;
revoke all on function public.commit_pos_sale(jsonb,boolean) from public, anon, authenticated;
grant execute on function public.commit_pos_sale(jsonb,boolean) to service_role;

create unique index if not exists pos_sale_payment_once on public.pos_sale_commits ((result->'order'->>'razorpayPaymentId')) where result->'order'->>'razorpayPaymentId' is not null;

create or replace function public.finalize_pos_payment(p_razorpay_order_id text, p_payment_id text, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare pending jsonb; orders jsonb;
begin
  if coalesce(p_razorpay_order_id,'')='' or coalesce(p_payment_id,'')='' or p_amount is null or p_amount<=0 then
    raise exception using errcode='22023', message='Verified payment details required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fanzzy-atomic-pos',0));
  select value::jsonb into orders from public.store_settings where key='orders' for update;
  select o into pending from jsonb_array_elements(orders) o where o->>'razorpayOrderId'=p_razorpay_order_id limit 1;
  if pending is null or coalesce(pending->>'id','') !~ '^#FZ-POS-' or pending->>'posPaymentMethod' is distinct from 'UPI' then
    raise exception using errcode='22023', message='Pending POS bill was not found';
  end if;
  if round(regexp_replace(pending->>'total','[^0-9.-]','','g')::numeric*100) <> p_amount then
    raise exception using errcode='22023', message='Captured payment amount does not match the saved bill';
  end if;
  if pending->>'paymentStatus'='paid' and pending->>'inventoryAdjusted'='true' then
    if pending->>'razorpayPaymentId' is distinct from p_payment_id then raise exception using errcode='23505', message='Bill already has a different payment'; end if;
    return jsonb_build_object('order',pending,'orders',orders,'products','[]'::jsonb,'replayed',true);
  end if;
  -- Legacy partial deductions cannot safely be inferred. Do not guess stock.
  if pending->>'inventoryReserved'='true' and pending->>'inventoryReleased' is distinct from 'true' then
    raise exception using errcode='22023', message='Reserved legacy POS sale needs inventory review before confirmation';
  end if;
  pending := pending || jsonb_build_object('razorpayPaymentId',p_payment_id);
  return public.commit_pos_sale(pending,true);
end;
$$;
revoke all on function public.finalize_pos_payment(text,text,bigint) from public, anon, authenticated;
grant execute on function public.finalize_pos_payment(text,text,bigint) to service_role;
