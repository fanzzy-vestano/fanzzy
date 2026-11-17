-- REVIEWED SOURCE ONLY. Do not apply to a live project without release approval.
-- No seed/test data, remote calls, credentials or payment-enabling settings.
begin;
create schema if not exists fanzzy_private;
revoke all on schema fanzzy_private from public, anon, authenticated;

create table if not exists fanzzy_private.checkout_requests (
  actor text not null, request_key text not null, request_hash text not null,
  order_id text not null, primary key(actor, request_key)
);
create table if not exists fanzzy_private.reservations (
  order_id text primary key, allocations jsonb not null,
  state text not null check(state in ('reserved','released','consumed')),
  created_at timestamptz not null default now()
);
create table if not exists fanzzy_private.payment_attempts (
  order_id text primary key, token text not null unique,
  state text not null check(state in ('creating','ambiguous','rejected','bound')),
  provider_order_id text unique, receipt text not null unique, amount bigint not null check(amount > 0),
  created_at timestamptz not null default now()
);
create table if not exists fanzzy_private.payments (
  payment_id text primary key, order_id text not null unique,
  provider_order_id text not null unique, amount bigint not null check(amount > 0),
  captured_at timestamptz not null default now()
);
create table if not exists fanzzy_private.callback_events (
  event_key text primary key, body_hash text not null, order_id text not null,
  created_at timestamptz not null default now()
);
create table if not exists fanzzy_private.promotion_redemptions (
  order_id text not null, offer_id text not null, actor text not null,
  sets integer not null check(sets>0),
  state text not null check(state in ('held','consumed','released')),
  primary key(order_id,offer_id)
);
create table if not exists fanzzy_private.checkout_outbox (
  id bigint generated always as identity primary key, order_id text not null,
  kind text not null check(kind in ('vendor_sync','shipment','inventory_review')),
  state text not null default 'pending' check(state in ('pending','claimed','sending','completed','reconciliation')),
  token text, lease_until timestamptz, result jsonb, updated_at timestamptz not null default now(),
  unique(order_id, kind)
);
revoke all on all tables in schema fanzzy_private from public, anon, authenticated;

create or replace function fanzzy_private.money(v text) returns bigint
language sql immutable strict set search_path = pg_catalog as $$
  select round(regexp_replace(v, '[^0-9.-]', '', 'g')::numeric * 100)::bigint
$$;

-- All checkout RPCs take the same transaction-scoped advisory lock, then row
-- locks on orders/settings/products. Locks survive different Worker instances.
-- The global lock deliberately favours correctness over checkout throughput.
create or replace function fanzzy_private.inventory(o jsonb, mode text, saved jsonb default null)
returns jsonb language plpgsql set search_path = pg_catalog, public as $$
declare
  variants jsonb; sizes jsonb; types jsonb; allocations jsonb := '[]'; line jsonb; a jsonb;
  sku_key text; size_sku text; variant_sku text; size_key text; label text; product_sku text;
  pv jsonb; candidate jsonb; vi integer; line_index integer; quantity integer; current_stock integer; delta integer;
  has_size boolean; has_variant boolean; available integer; aggregate integer; matches integer;
begin
  select value::jsonb into variants from public.store_settings where key='product_variants' for update;
  select value::jsonb into sizes from public.store_settings where key='product_size_stock' for update;
  select value::jsonb into types from public.store_settings where key='product_variant_type' for update;
  for line,line_index in select value,(ordinality-1)::integer from jsonb_array_elements(case when mode='release' then saved else o->'items' end) with ordinality loop
    if mode='release' then
      a := line; product_sku := a->>'sku'; quantity := (a->>'quantity')::integer;
      select stock into strict current_stock from public.products where sku=product_sku for update;
      size_sku := a->>'sizeSku'; size_key := a->>'sizeKey'; variant_sku := a->>'variantSku'; vi := (a->>'variantIndex')::integer;
      has_size := size_key is not null; has_variant := vi is not null;
      if has_variant then
        -- A catalog edit can reorder variants between reserve and release.
        -- Resolve the exact saved option instead of crediting its old index.
        pv:=coalesce(variants->variant_sku,'[]'::jsonb);
        select count(*)::integer,min((ordinality-1)::integer) into matches,vi
          from jsonb_array_elements(pv) with ordinality where value-'stock'=a->'variantIdentity';
        if matches<>1 then raise exception 'Reserved variant changed; inventory needs review'; end if;
      end if;
    else
      quantity := (line->>'quantity')::integer;
      if quantity is null or quantity < 1 or quantity > 10000 or jsonb_typeof(line->'quantity') is distinct from 'number' then raise exception 'Invalid item quantity'; end if;
      select p.sku,p.stock into strict product_sku,current_stock from public.products p
        where lower(regexp_replace(p.sku,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace(line->>'productId','[^a-zA-Z0-9]','','g')) for update;
      select key into size_sku from jsonb_each(sizes) where lower(regexp_replace(key,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace(product_sku,'[^a-zA-Z0-9]','','g'));
      select key into variant_sku from jsonb_each(variants) where lower(regexp_replace(key,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace(product_sku,'[^a-zA-Z0-9]','','g'));
      select key into sku_key from jsonb_each(types) where lower(regexp_replace(key,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace(product_sku,'[^a-zA-Z0-9]','','g'));
      size_key := null; vi := null; has_size := false; has_variant := false;
      pv := coalesce(variants->variant_sku,'[]'::jsonb);
      if nullif(line->>'size','') is not null then
        label := lower(trim(line->>'size'));
        select key into size_key from jsonb_each(coalesce(sizes->size_sku,'{}'::jsonb)) where lower(trim(key))=label;
        select count(*)::integer,min((ordinality-1)::integer) into matches,vi from jsonb_array_elements(pv) with ordinality
          where lower(trim(coalesce(value->>'size',value->>'name')))=label
          and (nullif(line->>'variantName','') is null or lower(trim(value->>'name'))=lower(trim(line->>'variantName')));
        if matches>1 then raise exception 'Selected size is ambiguous'; end if;
        has_size := size_key is not null;
        has_variant := vi is not null and jsonb_typeof(pv->vi->'stock')='number';
        if not has_size and not has_variant then raise exception 'Selected size is unavailable'; end if;
      elsif nullif(line->>'variantName','') is not null then
        select count(*)::integer,min((ordinality-1)::integer) into matches,vi from jsonb_array_elements(pv) with ordinality
          where lower(trim(coalesce(nullif(value->>'name',''),'Option '||ordinality)))=lower(trim(line->>'variantName'));
        if matches>1 then raise exception 'Selected variant is ambiguous'; end if;
        has_variant := vi is not null and jsonb_typeof(pv->vi->'stock')='number';
        if not has_variant then raise exception 'Selected variant is unavailable'; end if;
      elsif jsonb_array_length(pv)>0 or types->>sku_key='size' then
        raise exception 'Select the product size or variant';
      end if;
      a := jsonb_strip_nulls(jsonb_build_object('sku',product_sku,'quantity',quantity,
        'sizeSku',case when has_size then size_sku end,'sizeKey',case when has_size then size_key end,
        'variantSku',case when has_variant then variant_sku end,'variantIndex',case when has_variant then vi end,
        'variantIdentity',case when has_variant then pv->vi-'stock' end,
        'lineIndex',line_index));
    end if;
    allocations := allocations || jsonb_build_array(a);
    if mode='adopt' then continue; end if;
    delta := case when mode='release' then quantity else -quantity end;
    if has_size then
      available := (sizes #>> array[size_sku,size_key])::integer;
      if available is null or available+delta<0 then raise exception 'Selected size does not have enough stock'; end if;
      sizes := jsonb_set(sizes,array[size_sku,size_key],to_jsonb(available+delta),false);
    end if;
    if has_variant then
      available := (variants #>> array[variant_sku,vi::text,'stock'])::integer;
      if available is null or available+delta<0 then raise exception 'Selected variant does not have enough stock'; end if;
      variants := jsonb_set(variants,array[variant_sku,vi::text,'stock'],to_jsonb(available+delta),false);
    end if;
    if has_size then
      select sum(value::text::integer)::integer into aggregate from jsonb_each(sizes->size_sku);
    elsif has_variant then
      select sum((value->>'stock')::integer)::integer into aggregate from jsonb_array_elements(variants->variant_sku);
    else
      aggregate := current_stock+delta;
    end if;
    if aggregate is null or aggregate<0 then raise exception 'Product does not have enough stock'; end if;
    update public.products set stock=aggregate,updated_at=now() where sku=product_sku;
  end loop;
  if mode<>'adopt' then
    update public.store_settings set value=variants::text,updated_at=now() where key='product_variants';
    update public.store_settings set value=sizes::text,updated_at=now() where key='product_size_stock';
  end if;
  return allocations;
end $$;

create or replace function fanzzy_private.check_quote(o jsonb) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare dependency record; actual text; price numeric; quoted_promotions jsonb; live_promotions jsonb;
begin
  if o->'_quote' is null then raise exception 'Server checkout quote is required'; end if;
  if (o->'_quote'->>'expiresAt') is null or (o->'_quote'->>'expiresAt')::timestamptz < now() then raise exception 'Checkout quote expired; refresh your cart'; end if;
  for dependency in select * from jsonb_each_text(o->'_quote'->'settings') loop
    select value into actual from public.store_settings where key=dependency.key;
    if dependency.key='promotional_offers' and actual is not null then
      -- Usage is maintained by this same transaction. Changing only usageCount
      -- must not invalidate another already reserved checkout's pricing.
      select coalesce(jsonb_agg(value-'usageCount' order by value->>'id'),'[]'::jsonb) into live_promotions from jsonb_array_elements(actual::jsonb);
      select coalesce(jsonb_agg(value-'usageCount' order by value->>'id'),'[]'::jsonb) into quoted_promotions from jsonb_array_elements(dependency.value::jsonb);
      if live_promotions is distinct from quoted_promotions then raise exception 'Checkout settings changed; refresh your cart'; end if;
    elsif actual is distinct from dependency.value then raise exception 'Checkout settings changed; refresh your cart'; end if;
  end loop;
  for dependency in select * from jsonb_each_text(o->'_quote'->'prices') loop
    select p.price into price from public.products p where sku=dependency.key and status in ('Published','Low stock') for update;
    if price is null or round(price*100)::bigint<>dependency.value::bigint then raise exception 'Product price changed; refresh your cart'; end if;
  end loop;
end $$;

-- Promotion capacity is held with inventory, then consumed with payment/COD.
-- Two Workers cannot both spend the last offer use or a customer's last use.
create or replace function fanzzy_private.promotions(o jsonb,orders jsonb,mode text) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare
  offers jsonb; offer jsonb; redemption record; saved fanzzy_private.promotion_redemptions%rowtype;
  offer_index integer; held integer; customer_used integer; legacy_used integer; consumed integer; used integer;
  total_limit integer; customer_limit integer; order_id text:=o->>'id'; actor text:=o->>'userId';
begin
  if mode='release' then
    update fanzzy_private.promotion_redemptions set state='released' where promotion_redemptions.order_id=promotions.order_id and state='held';
    return;
  end if;
  if mode='cancel' then
    select value::jsonb into offers from public.store_settings where key='promotional_offers' for update;
    for saved in select * from fanzzy_private.promotion_redemptions r where r.order_id=promotions.order_id and r.state='consumed' loop
      select (ordinality-1)::integer,value into offer_index,offer from jsonb_array_elements(offers) with ordinality where value->>'id'=saved.offer_id;
      if offer_index is not null then
        offer:=jsonb_set(offer,'{usageCount}',to_jsonb(greatest(0,coalesce((offer->>'usageCount')::integer,0)-saved.sets)));
        offers:=jsonb_set(offers,array[offer_index::text],offer);
      end if;
    end loop;
    update fanzzy_private.promotion_redemptions set state='released' where promotion_redemptions.order_id=promotions.order_id and state in ('held','consumed');
    if offers is not null then update public.store_settings set value=offers::text,updated_at=now() where key='promotional_offers'; end if;
    return;
  end if;
  select value::jsonb into offers from public.store_settings where key='promotional_offers' for update;
  for redemption in select value->>'id' as id,sum((value->>'sets')::integer)::integer as sets
    from jsonb_array_elements(coalesce(o->'_quote'->'promotions','[]'::jsonb)) group by value->>'id' loop
    if coalesce(redemption.id,'')='' or redemption.sets is null or redemption.sets<1 or coalesce(actor,'')='' then raise exception 'Invalid promotion redemption'; end if;
    select * into saved from fanzzy_private.promotion_redemptions r where r.order_id=promotions.order_id and r.offer_id=redemption.id;
    if saved.state='consumed' or (saved.state='held' and mode='reserve') then continue; end if;
    select (ordinality-1)::integer,value into offer_index,offer from jsonb_array_elements(offers) with ordinality where value->>'id'=redemption.id;
    if offer_index is null then raise exception 'Promotion no longer exists'; end if;
    if saved.state is distinct from 'held' then
      if offer->>'status' is distinct from 'Active' or (nullif(offer->>'startsAt','')::timestamptz>now()) or (nullif(offer->>'endsAt','')::timestamptz<now()) then raise exception 'Promotion is no longer active'; end if;
      total_limit:=coalesce((offer->>'maxTotalUsage')::integer,0);
      customer_limit:=coalesce((offer->>'perCustomerLimit')::integer,0);
      if redemption.sets>1 and ((offer->>'type'='bundle' and coalesce((offer->>'allowMultipleBundles')::boolean,false)=false)
        or (offer->>'type'<>'bundle' and coalesce((offer->>'allowMultipleQualifyingSets')::boolean,true)=false)) then raise exception 'Promotion applies once per cart'; end if;
      select count(*)::integer into legacy_used from (
        select distinct prior->>'id',coalesce(item->'promotion'->>'groupId','legacy')
        from jsonb_array_elements(orders) prior cross join lateral jsonb_array_elements(coalesce(prior->'items','[]'::jsonb)) item
        where prior->>'paymentStatus' in ('paid','cod_pending','cod_collected') and item->'promotion'->>'offerId'=redemption.id
          and not exists(select 1 from fanzzy_private.promotion_redemptions r where r.order_id=prior->>'id' and r.offer_id=redemption.id)
      ) previous_groups;
      select coalesce(sum(r.sets),0)::integer into consumed from fanzzy_private.promotion_redemptions r where r.offer_id=redemption.id and r.state='consumed';
      used:=greatest(coalesce((offer->>'usageCount')::integer,0),legacy_used+consumed);
      select coalesce(sum(r.sets),0)::integer into held from fanzzy_private.promotion_redemptions r where r.offer_id=redemption.id and r.state='held';
      if total_limit>0 and used+held+redemption.sets>total_limit then raise exception 'Promotion usage limit has been reached'; end if;
      select coalesce(sum(r.sets),0)::integer into customer_used from fanzzy_private.promotion_redemptions r where r.offer_id=redemption.id and r.actor=promotions.actor and r.state in ('held','consumed');
      select customer_used+count(*)::integer into customer_used from (
        select distinct prior->>'id',coalesce(item->'promotion'->>'groupId','legacy')
        from jsonb_array_elements(orders) prior cross join lateral jsonb_array_elements(coalesce(prior->'items','[]'::jsonb)) item
        where prior->>'paymentStatus' in ('paid','cod_pending','cod_collected') and prior->>'userId'=actor and item->'promotion'->>'offerId'=redemption.id
          and not exists(select 1 from fanzzy_private.promotion_redemptions r where r.order_id=prior->>'id' and r.offer_id=redemption.id)
      ) previous_groups;
      if customer_limit>0 and customer_used+redemption.sets>customer_limit then raise exception 'Customer promotion usage limit has been reached'; end if;
      insert into fanzzy_private.promotion_redemptions(order_id,offer_id,actor,sets,state) values(promotions.order_id,redemption.id,actor,redemption.sets,'held')
        on conflict(order_id,offer_id) do update set sets=excluded.sets,state='held';
      offer:=jsonb_set(offer,'{usageCount}',to_jsonb(used));
    end if;
    if mode='consume' then
      offer:=jsonb_set(offer,'{usageCount}',to_jsonb(coalesce((offer->>'usageCount')::integer,0)+redemption.sets));
      update fanzzy_private.promotion_redemptions r set state='consumed' where r.order_id=promotions.order_id and r.offer_id=redemption.id;
    end if;
    offers:=jsonb_set(offers,array[offer_index::text],offer);
  end loop;
  if offers is not null then update public.store_settings set value=offers::text,updated_at=now() where key='promotional_offers'; end if;
end $$;

create or replace function public.fanzzy_checkout(p_action text,p_order_id text default '',p_actor text default '',p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  orders jsonb; o jsonb; index_no integer; a jsonb; rows_changed integer; entry jsonb; current_order jsonb;
  attempt fanzzy_private.payment_attempts%rowtype; reservation fanzzy_private.reservations%rowtype;
  payment fanzzy_private.payments%rowtype; event fanzzy_private.callback_events%rowtype;
  req fanzzy_private.checkout_requests%rowtype; job fanzzy_private.checkout_outbox%rowtype;
  allocations jsonb; amount bigint; token text; changes jsonb; k text; placed_at timestamptz; existing boolean := false;
  selected_item_indexes integer[] := array[]::integer[]; selected_allocations jsonb := '[]'::jsonb; remaining_allocations jsonb := '[]'::jsonb;
  next_items jsonb := '[]'::jsonb; cancellation_history jsonb := '[]'::jsonb; item jsonb; item_index integer; allocation_index integer; refund_amount bigint := 0;
  active_item_count integer := 0; selected_item_count integer := 0; full_cancellation boolean := false; refund_state text; cancellation_id text;
begin
  if p_action='version' then return jsonb_build_object('version',2); end if;
  perform pg_advisory_xact_lock(7192026,1019);
  perform set_config('fanzzy.checkout_rpc','on',true);
  insert into public.store_settings(key,value) values('orders','[]'),('product_variants','{}'),('product_size_stock','{}'),('product_variant_type','{}') on conflict(key) do nothing;
  perform 1 from public.store_settings where key in ('orders','product_variants','product_size_stock','product_variant_type','payment_methods','delivery_charge','promotional_offers','marketing_records','agents','pickup_hubs') order by key for update;
  select value::jsonb into orders from public.store_settings where key='orders';
  if jsonb_typeof(orders)<>'array' then raise exception 'Saved order storage is invalid'; end if;
  if p_action='list' then return orders; end if;
  if p_action='lookup_request' then
    select * into req from fanzzy_private.checkout_requests where actor=p_actor and request_key=p_data->>'requestKey';
    if req.order_id is null then return 'null'::jsonb; end if;
    select value into o from jsonb_array_elements(orders) where value->>'id'=req.order_id;
    return jsonb_build_object('order',o,'request_hash',req.request_hash);
  end if;

  if p_action='outbox_claim' then
    -- A sending job is never automatically retried: an external provider may
    -- have accepted it even when our process crashed before recording success.
    update fanzzy_private.checkout_outbox set state='reconciliation',updated_at=now()
      where state='sending' and lease_until<now();
    select * into job from fanzzy_private.checkout_outbox where
      (p_order_id='' or order_id=p_order_id) and (p_data->>'kind' is null or kind=p_data->>'kind')
      and (state='pending' or (state='claimed' and lease_until<now())) order by id limit 1 for update;
    if job.id is null then return 'null'::jsonb; end if;
    update fanzzy_private.checkout_outbox set state='claimed',token=p_data->>'token',lease_until=now()+interval '5 minutes',updated_at=now() where id=job.id returning * into job;
    return to_jsonb(job);
  elsif p_action in ('outbox_sending','outbox_complete','outbox_unknown') then
    update fanzzy_private.checkout_outbox set state=case p_action when 'outbox_sending' then 'sending' when 'outbox_complete' then 'completed' else 'reconciliation' end,
      result=p_data->'result',updated_at=now() where id=(p_data->>'id')::bigint and token=p_data->>'token'
      and state=case when p_action='outbox_sending' then 'claimed' else 'sending' end and lease_until>=now();
    get diagnostics rows_changed=row_count;
    if rows_changed<>1 then raise exception 'Outbox lease is no longer owned'; end if;
    return jsonb_build_object('saved',true);
  end if;

  if p_action in ('patch','admin_patch') then
    if p_action='admin_patch' then
      for entry in select value from jsonb_array_elements(coalesce(p_data->'created','[]'::jsonb)) loop
        if coalesce(entry->>'id','') not like '#FZ-POS-%' then raise exception 'Customer orders must use checkout creation'; end if;
        if exists(select 1 from jsonb_array_elements(orders) x where x->>'id'=entry->>'id') then raise exception 'POS order already exists'; end if;
        orders:=orders||jsonb_build_array(entry);
      end loop;
    end if;
    for entry in select value from jsonb_array_elements(coalesce(p_data->'patches','[]'::jsonb)) loop
      select (ordinality-1)::integer,value into index_no,current_order from jsonb_array_elements(orders) with ordinality where value->>'id'=entry->>'id';
      if index_no is null then raise exception 'Saved order was not found'; end if;
      changes:=entry->'changes';
      for k in select jsonb_object_keys(changes) loop
        if k in ('paymentStatus','paymentMethod','razorpayOrderId','razorpayPaymentId','inventoryReserved','inventoryReleased','inventoryAdjusted','items','total','userId','_quote','id') then raise exception 'Protected order field cannot be patched'; end if;
        if coalesce(current_order->k,'null'::jsonb) is distinct from coalesce(entry->'before'->k,'null'::jsonb) then raise exception 'Order changed; reload before saving'; end if;
      end loop;
      orders:=jsonb_set(orders,array[index_no::text],current_order||changes);
    end loop;
    update public.store_settings set value=orders::text,updated_at=now() where key='orders';
    return orders;
  end if;

  if p_action='save' then
    if coalesce(p_actor,'')='' or coalesce(p_order_id,'')='' or coalesce(p_data->>'requestKey','')='' or coalesce(p_data->>'requestHash','')='' then raise exception 'Customer and checkout request key are required'; end if;
    select * into req from fanzzy_private.checkout_requests where actor=p_actor and request_key=p_data->>'requestKey';
    if req.order_id is not null then
      if req.request_hash<>p_data->>'requestHash' then raise exception 'Checkout request key was reused for different details'; end if;
      select value into o from jsonb_array_elements(orders) where value->>'id'=req.order_id;
      return o;
    end if;
    if exists(select 1 from jsonb_array_elements(orders) x where x->>'id'=p_order_id) then raise exception 'Order ID is already in use'; end if;
    o:=(p_data->'order')||jsonb_build_object('id',p_order_id,'userId',p_actor,'paymentStatus','pending','inventoryReserved',false,'inventoryReleased',false,'inventoryAdjusted',false,'_quote',p_data->'quote');
    perform fanzzy_private.check_quote(o);
    insert into fanzzy_private.checkout_requests values(p_actor,p_data->>'requestKey',p_data->>'requestHash',p_order_id);
    update public.store_settings set value=(jsonb_build_array(o)||orders)::text,updated_at=now() where key='orders';
    return o;
  end if;

  select (ordinality-1)::integer,value into index_no,o from jsonb_array_elements(orders) with ordinality where value->>'id'=p_order_id;
  if index_no is null then raise exception 'Saved order was not found'; end if;
  if p_action in ('reserve','release','cod','claim_attempt','cancel') and (coalesce(p_actor,'')='' or o->>'userId' is distinct from p_actor) then raise exception 'Order does not belong to this customer'; end if;
  select * into reservation from fanzzy_private.reservations where order_id=p_order_id for update;
  select * into attempt from fanzzy_private.payment_attempts where order_id=p_order_id for update;
  if p_action='attempt' then return case when attempt.order_id is null then 'null'::jsonb else to_jsonb(attempt) end; end if;

  if p_action='prepare_shipment' then
    if o->>'paymentStatus' not in ('paid','cod_pending','cod_collected') or o->>'inventoryAdjusted' is distinct from 'true' then raise exception 'Confirmed payment and inventory are required'; end if;
    if o->>'fulfillmentMethod'='pickup' or p_order_id like '#FZ-POS-%' or o->>'status' in ('Cancelled','Delivered') then raise exception 'Order cannot create a shipment'; end if;
    select * into job from fanzzy_private.checkout_outbox where order_id=p_order_id and kind='shipment' for update;
    if job.state in ('claimed','sending','reconciliation') then raise exception 'Shipment already processing or awaiting reconciliation'; end if;
    if nullif(o->>'delhiveryAwb','') is not null then return o; end if;
    if job.state='completed' and coalesce(job.result->>'awaitingWeight','false')<>'true' then raise exception 'Shipment outcome must be reconciled'; end if;
    if (p_data->>'weight') is null or (p_data->>'weight')::integer not between 500 and 30000 then raise exception 'Invalid packed parcel weight'; end if;
    o:=o||jsonb_build_object('delhiveryWeightGrams',(p_data->>'weight')::integer,'delhiveryPickupLocation',p_data->>'pickupLocation','delhiveryPickupRequestTime',p_data->>'pickupTime','delhiveryShipmentStatus','awaiting_weight');
    insert into fanzzy_private.checkout_outbox(order_id,kind) values(p_order_id,'shipment') on conflict(order_id,kind) do update set state='pending',token=null,lease_until=null;
    orders:=jsonb_set(orders,array[index_no::text],o);
    update public.store_settings set value=orders::text,updated_at=now() where key='orders';
    return o;
  elsif p_action='tracking' then
    if o->>'delhiveryAwb' is distinct from p_data->>'waybill' then raise exception 'Shipment does not match this order'; end if;
    o:=o||jsonb_build_object('delhiveryLiveStatus',p_data->>'status','delhiveryLiveStatusType',p_data->>'statusType','delhiveryLiveStatusDate',p_data->>'statusDate','delhiveryLiveLocation',p_data->>'location','delhiveryScans',p_data->'scans','delhiveryLastTrackedAt',now());
    if p_data->>'status' ~* 'delivered' then
      o:=o||jsonb_build_object('status','Delivered');
      if o->>'paymentStatus'='cod_pending' then o:=o||jsonb_build_object('paymentStatus','cod_collected'); end if;
    elsif p_data->>'status' ~* '(picked|dispatched|in transit|out for delivery|shipped)' and o->>'status'='Processing' then o:=o||jsonb_build_object('status','Shipped');
    end if;
    orders:=jsonb_set(orders,array[index_no::text],o);
    update public.store_settings set value=orders::text,updated_at=now() where key='orders';
    return o;
  end if;

  if p_action in ('reserve','cod') then
    if p_action='cod' and (o->>'paymentMethod' is distinct from 'cod' or coalesce((select (value::jsonb->>'cod')::boolean from public.store_settings where key='payment_methods'),false)=false) then raise exception 'COD is unavailable for this order'; end if;
    if o->>'paymentStatus' in ('paid','cod_pending','cod_collected') then return o; end if;
    if o->>'paymentStatus' is distinct from 'pending' then raise exception 'Order is no longer pending'; end if;
    if reservation.state is distinct from 'reserved' then
      perform fanzzy_private.check_quote(o);
      perform fanzzy_private.promotions(o,orders,'reserve');
      allocations:=fanzzy_private.inventory(o,case when o->>'inventoryReserved'='true' and o->>'inventoryReleased' is distinct from 'true' then 'adopt' else 'reserve' end);
      insert into fanzzy_private.reservations(order_id,allocations,state) values(p_order_id,allocations,'reserved')
        on conflict(order_id) do update set allocations=excluded.allocations,state='reserved',created_at=now();
      o:=o||jsonb_build_object('inventoryReserved',true,'inventoryReleased',false,'inventoryReservedAt',now());
    end if;
    if p_action='cod' then
      perform fanzzy_private.promotions(o,orders,'consume');
      update fanzzy_private.reservations set state='consumed' where order_id=p_order_id;
      o:=o||jsonb_build_object('paymentStatus','cod_pending','inventoryAdjusted',true);
    end if;
  elsif p_action in ('release','expire') then
    if o->>'paymentStatus' is distinct from 'pending' then return o; end if;
    if attempt.order_id is not null and attempt.state<>'rejected' then raise exception 'Provider payment attempt needs reconciliation before release'; end if;
    if nullif(o->>'razorpayOrderId','') is not null then raise exception 'Provider order needs reconciliation before release'; end if;
    if p_action='expire' and coalesce((o->>'inventoryReservedAt')::timestamptz,now())>now()-interval '15 minutes' then return o; end if;
    if reservation.order_id is null and o->>'inventoryReserved'='true' and o->>'inventoryReleased' is distinct from 'true' then
      allocations:=fanzzy_private.inventory(o,'adopt');
      insert into fanzzy_private.reservations(order_id,allocations,state) values(p_order_id,allocations,'reserved') returning * into reservation;
    end if;
    if reservation.state='reserved' then
      perform fanzzy_private.inventory(o,'release',reservation.allocations);
      update fanzzy_private.reservations set state='released' where order_id=p_order_id;
    end if;
    perform fanzzy_private.promotions(o,orders,'release');
    o:=o||jsonb_build_object('inventoryReleased',true,'inventoryAdjusted',false);
  elsif p_action='cancel' then
    if coalesce(p_data->>'cancellationReason','') not in ('Ordered by mistake','Need to change items or delivery details','Delivery is taking too long','Found a better price','Other') then
      raise exception 'A cancellation reason is required';
    end if;
    if p_data->>'cancellationReason'='Other' and length(trim(coalesce(p_data->>'cancellationDescription','')))=0 then
      raise exception 'A cancellation description is required for Other';
    end if;
    if length(coalesce(p_data->>'cancellationDescription',''))>500 then
      raise exception 'Cancellation description must be 500 characters or fewer';
    end if;
    if jsonb_typeof(p_data->'itemIndexes') is distinct from 'array' or jsonb_array_length(p_data->'itemIndexes') not between 1 and 100 then
      raise exception 'Select one or more order items to cancel';
    end if;
    for entry in select value from jsonb_array_elements(p_data->'itemIndexes') loop
      if jsonb_typeof(entry)<>'number' or entry::text !~ '^[0-9]+$' then raise exception 'Invalid order item selection'; end if;
      item_index:=(entry #>> '{}')::integer;
      if item_index=any(selected_item_indexes) then raise exception 'An order item was selected more than once'; end if;
      selected_item_indexes:=array_append(selected_item_indexes,item_index);
    end loop;
    if o->>'status'='Cancelled' then raise exception 'This order has already been cancelled'; end if;
    if o->>'status' is distinct from 'Processing' then raise exception 'Only orders that are still processing can be cancelled'; end if;
    if jsonb_typeof(o->'items') is distinct from 'array' or jsonb_array_length(o->'items')=0 then raise exception 'This order has no cancellable items'; end if;
    if nullif(o->>'delhiveryAwb','') is not null or o->>'delhiveryShipmentStatus' in ('pending','created') then
      raise exception 'This order can no longer be cancelled because shipment processing has started';
    end if;
    if exists(select 1 from fanzzy_private.checkout_outbox where order_id=p_order_id and kind='shipment' and state<>'pending' and coalesce(result->>'awaitingWeight','false')<>'true') then
      raise exception 'This order can no longer be cancelled because shipment processing has started';
    end if;
    begin
      placed_at:=(o->>'createdAt')::timestamptz;
    exception when others then
      raise exception 'This order does not have a valid placement time for cancellation';
    end;
    if placed_at<=now()-interval '12 hours' then raise exception 'Orders can only be cancelled within 12 hours of being placed'; end if;
    if o->>'paymentStatus'='pending' and attempt.order_id is not null and attempt.state<>'rejected' then
      raise exception 'This order can no longer be cancelled because payment processing has started';
    end if;
    for item,item_index in select value,(ordinality-1)::integer from jsonb_array_elements(o->'items') with ordinality loop
      if coalesce((item->>'cancelled')::boolean,false) then
        next_items:=next_items||jsonb_build_array(item);
      else
        active_item_count:=active_item_count+1;
        if item_index=any(selected_item_indexes) then
          selected_item_count:=selected_item_count+1;
          refund_amount:=refund_amount+fanzzy_private.money(item->>'price')*(item->>'quantity')::integer;
          next_items:=next_items||jsonb_build_array(item||jsonb_build_object('cancelled',true,'cancelledAt',now()));
        else
          next_items:=next_items||jsonb_build_array(item);
        end if;
      end if;
    end loop;
    if selected_item_count<>cardinality(selected_item_indexes) then raise exception 'One or more selected items are no longer available to cancel'; end if;
    full_cancellation:=selected_item_count=active_item_count;
    if full_cancellation then refund_amount:=fanzzy_private.money(o->>'total'); end if;
    if refund_amount is null or refund_amount<0 then raise exception 'Selected item refund amount is invalid'; end if;
    if reservation.state not in ('reserved','consumed') or jsonb_typeof(reservation.allocations) is distinct from 'array' then raise exception 'Order stock reservation is unavailable'; end if;
    for a,allocation_index in select value,(ordinality-1)::integer from jsonb_array_elements(reservation.allocations) with ordinality loop
      item_index:=case when coalesce(a->>'lineIndex','') ~ '^[0-9]+$' then (a->>'lineIndex')::integer else allocation_index end;
      if coalesce(a->>'lineIndex','') !~ '^[0-9]+$' then a:=a||jsonb_build_object('lineIndex',item_index); end if;
      if item_index=any(selected_item_indexes) then selected_allocations:=selected_allocations||jsonb_build_array(a); else remaining_allocations:=remaining_allocations||jsonb_build_array(a); end if;
    end loop;
    if jsonb_array_length(selected_allocations)<>selected_item_count then raise exception 'Order stock reservation does not match the selected items'; end if;
    perform fanzzy_private.inventory(o,'release',selected_allocations);
    update fanzzy_private.reservations set allocations=remaining_allocations,state=case when jsonb_array_length(remaining_allocations)=0 then 'released' else state end where order_id=p_order_id;
    refund_state:=case when o->>'paymentStatus' in ('paid','cod_collected') or nullif(o->>'razorpayPaymentId','') is not null then 'Pending' else 'Not applicable' end;
    cancellation_id:=p_order_id||'-C'||(case when jsonb_typeof(o->'cancellationRecords')='array' then jsonb_array_length(o->'cancellationRecords') else 0 end+1)::text;
    cancellation_history:=case when jsonb_typeof(o->'cancellationRecords')='array' then o->'cancellationRecords' else '[]'::jsonb end;
    cancellation_history:=cancellation_history||jsonb_build_array(jsonb_build_object(
      'id',cancellation_id,'itemIndexes',to_jsonb(selected_item_indexes),'refundAmount',refund_amount::numeric/100,
      'refundStatus',refund_state,'reason',p_data->>'cancellationReason',
      'description',case when p_data->>'cancellationReason'='Other' then trim(p_data->>'cancellationDescription') else null end,
      'createdAt',now(),'fullOrder',full_cancellation
    ));
    if full_cancellation then
      if o->>'paymentStatus' in ('paid','cod_pending','cod_collected') then
        perform fanzzy_private.promotions(o,orders,'cancel');
      else
        perform fanzzy_private.promotions(o,orders,'release');
      end if;
      delete from fanzzy_private.checkout_outbox
        where order_id=p_order_id and (state='pending' or (kind='shipment' and state='completed' and coalesce(result->>'awaitingWeight','false')='true'));
      o:=o||jsonb_build_object(
        'status','Cancelled','cancelledAt',now(),'cancelledBy','customer',
        'cancellationReason',p_data->>'cancellationReason',
        'cancellationDescription',case when p_data->>'cancellationReason'='Other' then trim(p_data->>'cancellationDescription') else null end,
        'cancellationRecords',cancellation_history,'items',next_items,
        'inventoryReleased',true,'inventoryAdjusted',false,'refundStatus',refund_state
      );
    else
      delete from fanzzy_private.checkout_outbox
        where order_id=p_order_id and kind='shipment' and (state='pending' or (state='completed' and coalesce(result->>'awaitingWeight','false')='true'));
      if o->>'paymentMethod'='cod' and o->>'paymentStatus'='cod_pending' then
        amount:=fanzzy_private.money(o->>'total');
        if amount is null or amount<=refund_amount then raise exception 'The remaining COD total is invalid'; end if;
        o:=o||jsonb_build_object('total','₹'||(amount-refund_amount)/100||'.'||lpad(((amount-refund_amount)%100)::text,2,'0'));
      end if;
      o:=o||jsonb_build_object(
        'items',next_items,'cancellationRecords',cancellation_history,
        'cancellationReason',p_data->>'cancellationReason',
        'cancellationDescription',case when p_data->>'cancellationReason'='Other' then trim(p_data->>'cancellationDescription') else null end,
        'refundStatus',refund_state,'delhiveryAwb',null,'delhiveryTrackingUrl',null,
        'delhiveryShipmentStatus','skipped','delhiveryWeightGrams',null,
        'delhiveryShipmentCreatedAt',null,'delhiveryShipmentRequestedAt',null
      );
    end if;
  elsif p_action='claim_attempt' then
    if o->>'paymentStatus' is distinct from 'pending' or o->>'paymentMethod' is distinct from 'online' then raise exception 'Pending online order is required'; end if;
    if o->>'inventoryReserved' is distinct from 'true' or o->>'inventoryReleased'='true' then raise exception 'Order stock must be reserved'; end if;
    if coalesce((select (value::jsonb->>'online')::boolean from public.store_settings where key='payment_methods'),false)=false then raise exception 'Online payment is unavailable'; end if;
    if attempt.order_id is not null then return jsonb_build_object('order',o,'attempt',to_jsonb(attempt),'claimed',false); end if;
    if coalesce(p_data->>'token','')='' then raise exception 'Payment attempt token is required'; end if;
    perform fanzzy_private.check_quote(o);
    amount:=fanzzy_private.money(o->>'total');
    if amount is null or amount<100 or amount>1000000000 then raise exception 'Order amount is invalid'; end if;
    insert into fanzzy_private.payment_attempts(order_id,token,state,receipt,amount) values(p_order_id,p_data->>'token','creating',replace(p_order_id,'#',''),amount) returning * into attempt;
    return jsonb_build_object('order',o,'attempt',to_jsonb(attempt),'claimed',true);
  elsif p_action in ('bind_attempt','ambiguous_attempt','reject_attempt') then
    if attempt.order_id is null or coalesce(p_data->>'token','')='' or attempt.token is distinct from p_data->>'token' then raise exception 'Payment attempt is no longer owned'; end if;
    if p_action='bind_attempt' then
      if coalesce(p_data->>'providerOrderId','') !~ '^order_[A-Za-z0-9]+$' then raise exception 'Provider order ID is invalid'; end if;
      if attempt.state='bound' and attempt.provider_order_id<>p_data->>'providerOrderId' then raise exception 'Provider order already bound'; end if;
      if attempt.state not in ('creating','ambiguous','bound') then raise exception 'Payment attempt cannot be bound'; end if;
      update fanzzy_private.payment_attempts set provider_order_id=p_data->>'providerOrderId',state='bound' where order_id=p_order_id;
      o:=o||jsonb_build_object('razorpayOrderId',p_data->>'providerOrderId');
    else
      update fanzzy_private.payment_attempts set state=case p_action when 'reject_attempt' then 'rejected' else 'ambiguous' end where order_id=p_order_id and state='creating';
      return o;
    end if;
  elsif p_action in ('capture','payment_failed') then
    a:=p_data->'payment';
    if coalesce(p_data->>'eventKey','')='' or coalesce(p_data->>'eventHash','')='' then raise exception 'Callback identity and body hash are required'; end if;
    if p_action='payment_failed' then
      if a->>'status' is distinct from 'failed' or coalesce(a->>'order_id','')='' or a->>'order_id' is distinct from o->>'razorpayOrderId' then raise exception 'Failure event does not match this order'; end if;
      select * into event from fanzzy_private.callback_events where event_key=p_data->>'eventKey';
      if event.event_key is not null and (event.body_hash is distinct from p_data->>'eventHash' or event.order_id is distinct from p_order_id) then raise exception 'Callback identity conflict'; end if;
      insert into fanzzy_private.callback_events(event_key,body_hash,order_id) values(p_data->>'eventKey',p_data->>'eventHash',p_order_id) on conflict do nothing;
      -- A failure notification cannot reverse a capture or free a payable order.
      return o;
    end if;
    if a->>'status' is distinct from 'captured' or a->>'captured' is distinct from 'true' or a->>'currency' is distinct from 'INR' or coalesce(a->>'id','')='' then raise exception 'Payment is not captured in INR'; end if;
    if o->>'paymentMethod' is distinct from 'online' then raise exception 'Online payment cannot confirm this payment method'; end if;
    amount:=fanzzy_private.money(o->>'total');
    if (a->>'amount')::bigint is distinct from amount or amount is null or amount<100 then raise exception 'Captured amount does not match order'; end if;
    if p_order_id like '#FZ-POS-%' and nullif(a->>'order_id','') is null then
      a:=a||jsonb_build_object('order_id','pos:'||(a->>'id'));
      o:=o||jsonb_build_object('razorpayOrderId',a->>'order_id');
    end if;
    if coalesce(o->>'razorpayOrderId','')<>coalesce(a->>'order_id','') or coalesce(a->>'order_id','')='' then raise exception 'Captured payment is not bound to this order'; end if;
    if coalesce(p_data->>'eventKey','')='' then raise exception 'Callback identity is required'; end if;
    select * into event from fanzzy_private.callback_events where event_key=p_data->>'eventKey';
    if event.event_key is not null then
      if event.body_hash is distinct from p_data->>'eventHash' or event.order_id is distinct from p_order_id then raise exception 'Callback identity conflict'; end if;
      return o;
    end if;
    select * into payment from fanzzy_private.payments where payment_id=a->>'id' or order_id=p_order_id or provider_order_id=a->>'order_id' limit 1;
    if payment.payment_id is not null then
      if payment.payment_id<>a->>'id' or payment.order_id<>p_order_id or payment.provider_order_id<>a->>'order_id' then raise exception 'Conflicting captured payment requires review'; end if;
      existing:=true;
    elsif nullif(o->>'razorpayPaymentId','') is not null and o->>'razorpayPaymentId'<>a->>'id' then
      raise exception 'Order already has another payment';
    end if;
    if not existing then
      perform fanzzy_private.promotions(o,orders,'consume');
      -- A legacy explicit inventoryAdjusted=true is already consumed. Never
      -- re-deduct it while importing the first v2 payment callback.
      if o->>'inventoryAdjusted'='true' then
        null;
      elsif reservation.state='reserved' or (o->>'inventoryReserved'='true' and o->>'inventoryReleased' is distinct from 'true') then
        o:=o||jsonb_build_object('inventoryAdjusted',true);
      else
        begin
          allocations:=fanzzy_private.inventory(o,'reserve');
          insert into fanzzy_private.reservations(order_id,allocations,state) values(p_order_id,allocations,'consumed')
            on conflict(order_id) do update set allocations=excluded.allocations,state='consumed';
          o:=o||jsonb_build_object('inventoryAdjusted',true,'inventoryReleased',false,'inventoryReserved',true);
        exception when others then
          -- Subtransaction rolls back ALL partial stock changes. Preserve the
          -- fact of capture, withhold fulfilment and queue manual review.
          o:=o||jsonb_build_object('inventoryAdjusted',false,'fulfillmentReview','inventory');
        end;
      end if;
      update fanzzy_private.reservations set state='consumed' where order_id=p_order_id and state='reserved';
      insert into fanzzy_private.payments(payment_id,order_id,provider_order_id,amount) values(a->>'id',p_order_id,a->>'order_id',amount);
      o:=o||jsonb_build_object('paymentStatus','paid','razorpayPaymentId',a->>'id');
    end if;
    insert into fanzzy_private.callback_events(event_key,body_hash,order_id) values(p_data->>'eventKey',p_data->>'eventHash',p_order_id);
  else
    raise exception 'Unsupported checkout action';
  end if;

  if o->>'status' is distinct from 'Cancelled' and o->>'paymentStatus' in ('paid','cod_pending') then
    if o->>'inventoryAdjusted'='true' then
      insert into fanzzy_private.checkout_outbox(order_id,kind) values(p_order_id,'vendor_sync') on conflict do nothing;
      if o->>'fulfillmentMethod' is distinct from 'pickup' and p_order_id not like '#FZ-POS-%' then
        insert into fanzzy_private.checkout_outbox(order_id,kind) values(p_order_id,'shipment') on conflict do nothing;
      end if;
    else
      insert into fanzzy_private.checkout_outbox(order_id,kind,state) values(p_order_id,'inventory_review','reconciliation') on conflict do nothing;
    end if;
  end if;
  orders:=jsonb_set(orders,array[index_no::text],o);
  update public.store_settings set value=orders::text,updated_at=now() where key='orders';
  return o;
end $$;
revoke all on function public.fanzzy_checkout(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.fanzzy_checkout(text,text,text,jsonb) to service_role;
revoke all on all functions in schema fanzzy_private from public,anon,authenticated;

-- RLS removes the public order/PII read and all anonymous mutations. Existing
-- authenticated admin catalog editing is retained; orders use the server RPC.
-- Policies are permissive (ORed) by default. Leaving even an unknown older
-- public policy in place would defeat the new whitelist and expose orders.
do $$ declare policy record; begin
  for policy in select schemaname,tablename,policyname from pg_policies where schemaname='public' and tablename in ('products','store_settings') loop
    execute format('drop policy %I on %I.%I',policy.policyname,policy.schemaname,policy.tablename);
  end loop;
end $$;
alter table public.products enable row level security;
alter table public.store_settings enable row level security;
create policy "Fanzzy public catalog products" on public.products for select to anon,authenticated using(status in ('Published','Low stock'));
create policy "Fanzzy admin products" on public.products for all to authenticated
  using(auth.jwt()->>'email'='fanzzy@vestanoretail.com') with check(auth.jwt()->>'email'='fanzzy@vestanoretail.com');
create policy "Fanzzy public settings projection" on public.store_settings for select to anon,authenticated
  using(key in ('announcement','hero_image','hero_slides','hero_slide_duration','delivery_charge','pickup_hubs','payment_methods','collections','agents','category_catalog','product_variants','product_variant_type','product_sizes','product_size_stock','product_image_adjustments','promotional_offers','marketing_records','product_hsn_codes','product_bill_names') or key like 'vendor_categories:%');
create policy "Fanzzy admin settings" on public.store_settings for all to authenticated
  using(key<>'orders' and auth.jwt()->>'email'='fanzzy@vestanoretail.com')
  with check(key<>'orders' and auth.jwt()->>'email'='fanzzy@vestanoretail.com');

-- Even a service-role stale whole-array write must use patch/capture RPCs.
create or replace function fanzzy_private.guard_order_write() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if ((tg_op<>'INSERT' and old.key='orders') or (tg_op<>'DELETE' and new.key='orders')) and current_setting('fanzzy.checkout_rpc',true) is distinct from 'on' then
    raise exception 'Order writes require the transactional checkout RPC';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists fanzzy_guard_order_write on public.store_settings;
create trigger fanzzy_guard_order_write before insert or update or delete on public.store_settings for each row execute function fanzzy_private.guard_order_write();
commit;
