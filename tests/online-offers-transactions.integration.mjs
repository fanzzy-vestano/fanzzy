import assert from "node:assert/strict";
export async function runOnlineOfferTransactionTests(pool) {
  const rpc = async (action, id = "", actor = "customer-online-offers", data = {}) => (await pool.query("select public.fanzzy_checkout($1,$2,$3,$4::jsonb) as value", [action, id, actor, JSON.stringify(data)])).rows[0].value;
  await pool.query(`begin; select set_config('fanzzy.checkout_rpc','on',true);
    truncate fanzzy_private.checkout_requests,fanzzy_private.reservations,fanzzy_private.payment_attempts,fanzzy_private.payments,fanzzy_private.callback_events,fanzzy_private.checkout_outbox,fanzzy_private.promotion_redemptions restart identity;
    delete from public.store_settings; delete from public.products; commit;`);
  await pool.query("insert into public.products(sku,price,stock) values ('ONLINE-A',100,5)");
  await rpc("list");
  const settings = { payment_methods: JSON.stringify({ online: true, cod: true, codCharge: 0 }), delivery_charge: JSON.stringify({ enabled: false, amount: 0 }), product_variants: "{}", product_size_stock: "{}", product_variant_type: "{}", sales_promotions: JSON.stringify([{ id: "first-online", name: "First purchase", status: "Active" }]) };
  for (const [key, value] of Object.entries(settings)) await pool.query("insert into public.store_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value", [key, value]);
  const quote = { expiresAt: new Date(Date.now() + 900000).toISOString(), prices: { "ONLINE-A": 10000 }, settings, firstPurchase: true, salesOfferId: "first-online" };
  const save = (id) => rpc("save", id, "customer-online-offers", { order: { id, userId: "customer-online-offers", total: "₹90", promotionDiscount: 10, paymentMethod: "online", paymentStatus: "pending", fulfillmentMethod: "delivery", items: [{ productId: "ONLINE-A", name: "Test", quantity: 1, price: "₹100" }] }, requestKey: id, requestHash: id, quote });
  await save("ONLINE-FIRST-1"); await save("ONLINE-FIRST-2");
  const results = await Promise.allSettled([rpc("reserve", "ONLINE-FIRST-1"), rpc("reserve", "ONLINE-FIRST-2")]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.match(results.find((result) => result.status === "rejected").reason.message, /First-purchase/);
  const winner = results[0].status === "fulfilled" ? "ONLINE-FIRST-1" : "ONLINE-FIRST-2";
  const loser = winner === "ONLINE-FIRST-1" ? "ONLINE-FIRST-2" : "ONLINE-FIRST-1";
  await rpc("release", winner);
  await rpc("reserve", loser);
  console.log("PASS: concurrent first-purchase quotes cannot both reserve, and released reservations can be retried");
  await pool.query("update public.store_settings set value=$1 where key='sales_promotions'", [JSON.stringify([{ id: "first-online", status: "Paused" }])]);
  await assert.rejects(save("ONLINE-FIRST-3"), /settings changed/);
  console.log("PASS: changing sales offers invalidates older checkout quotes");
}
