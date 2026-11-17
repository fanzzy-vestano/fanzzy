-- Keep the existing price/settings checks and add an atomic first-purchase
-- guard. Pending quotes may coexist; only one can reserve or complete.
-- Parenthesize the variant JSON expression before removing its stock key.
-- Without this, PostgreSQL attempts integer subtraction with the word stock.
do $$ declare definition text; begin
  definition := pg_get_functiondef('fanzzy_private.inventory(jsonb,text,jsonb)'::regprocedure);
  if position('pv->vi-''stock''' in definition)>0 then
    execute replace(definition,'pv->vi-''stock''','(pv->vi)-''stock''');
  end if;
end $$;

-- Local variables in the legacy redemption routine need distinct names from
-- table columns; function-name qualification does not name its inner block.
do $$ declare definition text; begin
  definition := pg_get_functiondef('fanzzy_private.promotions(jsonb,jsonb,text)'::regprocedure);
  if position('promotions.order_id' in definition)>0 or position('''userId''=actor' in definition)>0 then
    definition := replace(definition,'order_id text:=o->>''id''','promotion_order_id text:=o->>''id''');
    definition := replace(definition,'actor text:=o->>''userId''','promotion_actor text:=o->>''userId''');
    definition := replace(definition,'promotions.order_id','promotion_order_id');
    definition := replace(definition,'promotions.actor','promotion_actor');
    definition := replace(definition,'coalesce(actor,','coalesce(promotion_actor,');
    definition := replace(definition,'redemption.id,actor,redemption.sets','redemption.id,promotion_actor,redemption.sets');
    definition := replace(definition,'''userId''=actor','''userId''=promotion_actor');
    execute definition;
  end if;
end $$;

-- A checkout attempt variable is also named token. Qualify the outbox column
-- when acknowledging fulfilment jobs so paid orders can finish dispatch.
do $$ declare definition text; begin
  definition := pg_get_functiondef('public.fanzzy_checkout(text,text,text,jsonb)'::regprocedure);
  if position('and token=p_data->>''token''' in definition)>0 then
    execute replace(definition,'and token=p_data->>''token''','and checkout_outbox.token=p_data->>''token''');
  end if;
end $$;

do $$ begin
  if to_regprocedure('fanzzy_private.check_quote_before_sales_promotions(jsonb)') is null then
    alter function fanzzy_private.check_quote(jsonb) rename to check_quote_before_sales_promotions;
  end if;
end $$;

create or replace function fanzzy_private.check_quote(o jsonb) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare prior_orders jsonb;
begin
  -- Serialize settings edits with quote validation, alongside the checkout
  -- RPC's existing lock on the orders setting.
  perform 1 from public.store_settings where key='sales_promotions' for update;
  perform fanzzy_private.check_quote_before_sales_promotions(o);
  if coalesce((o->'_quote'->>'firstPurchase')::boolean,false) then
    select coalesce(value::jsonb,'[]'::jsonb) into prior_orders from public.store_settings where key='orders';
    if exists (
      select 1 from jsonb_array_elements(coalesce(prior_orders,'[]'::jsonb)) previous
      where previous->>'id' is distinct from o->>'id'
        and previous->>'userId'=o->>'userId'
        and previous->>'status' is distinct from 'Cancelled'
        and (previous->>'paymentStatus' in ('paid','cod_pending','cod_collected')
          or previous->>'status'='Delivered'
          or (coalesce((previous->>'inventoryReserved')::boolean,false)
            and not coalesce((previous->>'inventoryReleased')::boolean,false)))
    ) then raise exception 'First-purchase offer is no longer available; refresh your cart'; end if;
  end if;
end $$;

revoke all on function fanzzy_private.check_quote(jsonb) from public;
revoke all on function fanzzy_private.check_quote_before_sales_promotions(jsonb) from public;
