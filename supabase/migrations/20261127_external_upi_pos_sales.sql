-- A counter sale paid to a separately managed UPI QR cannot be verified by
-- Razorpay.  It is still an in-person, staff-confirmed payment and must be
-- saved atomically with the stock change, rather than masquerading as a card
-- transaction or being followed by a second manual stock adjustment.
--
-- Keep Razorpay UPI on its existing verified-only path.  This migration only
-- adds the explicit External UPI label to the direct POS commit allow-list.
do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('public.commit_pos_sale(jsonb, boolean)'::regprocedure)
    into definition;

  if position('''External UPI''' in definition) = 0 then
    if position('''Cash'', ''Card''' in definition) = 0 then
      raise exception 'Could not upgrade commit_pos_sale for External UPI; the installed function has an unexpected definition';
    end if;
    definition := replace(definition, '''Cash'', ''Card''', '''Cash'', ''Card'', ''External UPI''');
    execute definition;
  end if;
end;
$migration$;
