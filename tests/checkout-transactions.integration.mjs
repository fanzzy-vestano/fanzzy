import assert from "node:assert/strict";

export async function runTransactionTests(pool) {
  const settings = {
    payment_methods: JSON.stringify({ online: true, cod: true, codCharge: 0 }),
    delivery_charge: JSON.stringify({ enabled: false, amount: 30, freeAboveEnabled: true, freeAbove: 300 }),
    product_variants: "{}", product_size_stock: "{}", product_variant_type: "{}",
  };
  const actor = "phone:919999999999";
  const query = (sql, args) => pool.query(sql, args);
  const rpc = async (action, id = "", owner = "", data = {}) => (await query("select public.fanzzy_checkout($1,$2,$3,$4::jsonb) as value", [action, id, owner, JSON.stringify(data)])).rows[0].value;
  const reset = async (stock = 1) => {
    await query(`begin; select set_config('fanzzy.checkout_rpc','on',true);
      truncate fanzzy_private.checkout_requests,fanzzy_private.reservations,fanzzy_private.payment_attempts,fanzzy_private.payments,fanzzy_private.callback_events,fanzzy_private.checkout_outbox,fanzzy_private.promotion_redemptions restart identity;
      delete from public.store_settings; delete from public.products; commit;`);
    await query("insert into public.products(sku,price,stock) values ('SKU-1',100,$1),('SKU-2',100,0)", [stock]);
    await query("select public.fanzzy_checkout('list')");
    for (const [key, value] of Object.entries(settings)) await query("insert into public.store_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value", [key, value]);
  };
  const order = (id, extra = {}) => ({ id, userId: actor, phone: "+919999999999", date: "2026-10-19", total: "₹100", paymentMethod: "online", paymentStatus: "pending", fulfillmentMethod: "delivery", items: [{ productId: "SKU-1", name: "Fixture product", quantity: 1, price: "₹100" }], ...extra });
  const quote = () => ({ expiresAt: new Date(Date.now() + 900000).toISOString(), prices: { "SKU-1": 10000 }, settings: { payment_methods: settings.payment_methods, delivery_charge: settings.delivery_charge } });
  const save = (id, extra = {}, key = id) => rpc("save", id, actor, { order: order(id, extra), requestKey: key, requestHash: JSON.stringify(extra), quote: quote() });
  const stock = async (sku = "SKU-1") => (await query("select stock from products where sku=$1", [sku])).rows[0].stock;
  const current = async (id) => (await rpc("list")).find((row) => row.id === id);
  const count = async (table) => Number((await query(`select count(*) as n from fanzzy_private.${table}`)).rows[0].n);
  const capture = (id, eventKey, change = {}) => rpc("capture", id, "", { payment: { id: "pay_fixture", order_id: "order_fixture", status: "captured", captured: true, currency: "INR", amount: 10000, ...change }, eventKey, eventHash: eventKey });
  const bind = async (id) => { const result = await rpc("claim_attempt", id, actor, { token: `fixture-${id}` }); await rpc("bind_attempt", id, "", { token: result.attempt.token, providerOrderId: "order_fixture" }); };
  const cases = [];
  const test = (name, fn) => cases.push([name, fn]);

  test("32 different orders compete for the final unit without overselling", async () => {
    await reset(); for (let i = 0; i < 32; i++) await save(`#FZ-LAST-${i}`);
    const results = await Promise.allSettled(Array.from({ length: 32 }, (_, i) => rpc("reserve", `#FZ-LAST-${i}`, actor)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, results.filter((r) => r.status === "rejected").slice(0, 3).map((r) => r.reason.message).join("; "));
    assert.equal(await stock(), 0); assert.equal(await count("reservations"), 1);
  });
  test("32 duplicate reservations and releases each mutate inventory once", async () => {
    await reset(3); await save("#FZ-DUPLICATE");
    await Promise.all(Array.from({ length: 32 }, () => rpc("reserve", "#FZ-DUPLICATE", actor)));
    assert.equal(await stock(), 2);
    await Promise.all(Array.from({ length: 32 }, () => rpc("release", "#FZ-DUPLICATE", actor)));
    assert.equal(await stock(), 3); assert.equal(await count("reservations"), 1);
  });
  test("a failure on a later line rolls back every earlier stock and order mutation", async () => {
    await reset(5);
    await save("#FZ-ROLLBACK", { total: "₹200", items: [...order().items, { ...order().items[0], productId: "SKU-2" }] });
    await assert.rejects(() => rpc("reserve", "#FZ-ROLLBACK", actor));
    assert.equal(await stock(), 5); assert.equal(await stock("SKU-2"), 0);
    assert.equal(await count("reservations"), 0); assert.equal((await current("#FZ-ROLLBACK")).inventoryReserved, false);
  });
  test("32 duplicate COD confirmations consume one reservation and queue one fulfilment job per kind", async () => {
    await reset(3); await save("#FZ-COD", { paymentMethod: "cod" });
    await Promise.all(Array.from({ length: 32 }, () => rpc("cod", "#FZ-COD", actor)));
    assert.equal(await stock(), 2); assert.equal((await current("#FZ-COD")).paymentStatus, "cod_pending");
    assert.equal(await count("checkout_outbox"), 2);
  });
  test("an eligible customer cancellation restores COD stock and removes unsent fulfilment jobs", async () => {
    await reset(3);
    await save("#FZ-CANCEL", { paymentMethod: "cod", status: "Processing", delhiveryShipmentStatus: "awaiting_weight", createdAt: new Date().toISOString() });
    await rpc("cod", "#FZ-CANCEL", actor);
    await query("update fanzzy_private.checkout_outbox set state='completed',result='{\"awaitingWeight\":true}'::jsonb where order_id=$1 and kind='shipment'", ["#FZ-CANCEL"]);
    await assert.rejects(() => rpc("cancel", "#FZ-CANCEL", "another-customer"));
    await assert.rejects(() => rpc("cancel", "#FZ-CANCEL", actor));
    await assert.rejects(() => rpc("cancel", "#FZ-CANCEL", actor, { cancellationReason: "Other" }));
    const cancelled = await rpc("cancel", "#FZ-CANCEL", actor, { cancellationReason: "Other", cancellationDescription: "Placed the order twice", itemIndexes: [0] });
    assert.equal(cancelled.status, "Cancelled");
    assert.equal(cancelled.cancelledBy, "customer");
    assert.equal(cancelled.cancellationReason, "Other");
    assert.equal(cancelled.cancellationDescription, "Placed the order twice");
    assert.equal(cancelled.refundStatus, "Not applicable");
    assert.equal(await stock(), 3);
    assert.equal((await query("select state from fanzzy_private.reservations where order_id=$1", ["#FZ-CANCEL"])).rows[0].state, "released");
    assert.equal(await count("checkout_outbox"), 0);
    await assert.rejects(() => rpc("cancel", "#FZ-CANCEL", actor, { cancellationReason: "Ordered by mistake", itemIndexes: [0] }));
  });
  test("customer cancellation closes after twelve hours", async () => {
    await reset(3);
    await save("#FZ-CANCEL-OLD", { paymentMethod: "cod", status: "Processing", createdAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString() });
    await rpc("cod", "#FZ-CANCEL-OLD", actor);
    await assert.rejects(() => rpc("cancel", "#FZ-CANCEL-OLD", actor, { cancellationReason: "Ordered by mistake", itemIndexes: [0] }));
    assert.equal((await current("#FZ-CANCEL-OLD")).status, "Processing");
    assert.equal(await stock(), 2);
  });
  test("a customer can cancel selected order lines while the remaining COD items stay active", async () => {
    await reset(3);
    const item = order().items[0];
    await save("#FZ-CANCEL-PARTIAL", {
      paymentMethod: "cod",
      status: "Processing",
      total: "₹200",
      createdAt: new Date().toISOString(),
      items: [item, { ...item, name: "Second fixture product" }],
    });
    await rpc("cod", "#FZ-CANCEL-PARTIAL", actor);
    assert.equal(await stock(), 1);
    const partial = await rpc("cancel", "#FZ-CANCEL-PARTIAL", actor, { cancellationReason: "Ordered by mistake", itemIndexes: [0] });
    assert.equal(partial.status, "Processing");
    assert.equal(partial.total, "₹100.00");
    assert.equal(partial.items[0].cancelled, true);
    assert.equal(partial.items[1].cancelled, undefined);
    assert.equal(partial.cancellationRecords[0].refundAmount, 100);
    assert.equal(partial.cancellationRecords[0].fullOrder, false);
    assert.equal(await stock(), 2);
    assert.equal((await query("select jsonb_array_length(allocations) as n,state from fanzzy_private.reservations where order_id=$1", ["#FZ-CANCEL-PARTIAL"])).rows[0].n, 1);
    const fullyCancelled = await rpc("cancel", "#FZ-CANCEL-PARTIAL", actor, { cancellationReason: "Need to change items or delivery details", itemIndexes: [1] });
    assert.equal(fullyCancelled.status, "Cancelled");
    assert.equal(fullyCancelled.cancellationRecords.length, 2);
    assert.equal(fullyCancelled.cancellationRecords[1].fullOrder, true);
    assert.equal(await stock(), 3);
    assert.equal(await count("checkout_outbox"), 0);
  });
  test("a cancelled online payment enters the refund queue and an admin can record its refund reference", async () => {
    await reset(3);
    await save("#FZ-CANCEL-ONLINE", { status: "Processing", createdAt: new Date().toISOString() });
    await rpc("reserve", "#FZ-CANCEL-ONLINE", actor);
    await bind("#FZ-CANCEL-ONLINE");
    await capture("#FZ-CANCEL-ONLINE", "cancel-online-capture");
    const cancelled = await rpc("cancel", "#FZ-CANCEL-ONLINE", actor, { cancellationReason: "Ordered by mistake", itemIndexes: [0] });
    assert.equal(cancelled.refundStatus, "Pending");
    const orders = await rpc("admin_patch", "", "", {
      patches: [{
        id: "#FZ-CANCEL-ONLINE",
        before: { refundStatus: "Pending", refundReference: null },
        changes: { refundStatus: "Completed", refundReference: "rfnd_fixture" },
      }],
    });
    const refunded = orders.find((order) => order.id === "#FZ-CANCEL-ONLINE");
    assert.equal(refunded.refundStatus, "Completed");
    assert.equal(refunded.refundReference, "rfnd_fixture");
  });
  test("concurrent browser and webhook capture callbacks commit one payment without re-deducting reserved stock", async () => {
    await reset(3); await save("#FZ-CAPTURE"); await rpc("reserve", "#FZ-CAPTURE", actor); await bind("#FZ-CAPTURE");
    await Promise.all(Array.from({ length: 32 }, (_, i) => capture("#FZ-CAPTURE", `event-${i}`)));
    assert.equal(await stock(), 2); assert.equal(await count("payments"), 1);
    assert.equal(await count("callback_events"), 32); assert.equal(await count("checkout_outbox"), 2);
    assert.equal((await current("#FZ-CAPTURE")).inventoryAdjusted, true);
  });
  test("same event replay is a no-op and reusing its ID with a different body is rejected", async () => {
    await reset(); await save("#FZ-REPLAY"); await rpc("reserve", "#FZ-REPLAY", actor); await bind("#FZ-REPLAY");
    await capture("#FZ-REPLAY", "event-fixed"); await capture("#FZ-REPLAY", "event-fixed");
    await assert.rejects(() => rpc("capture", "#FZ-REPLAY", "", { payment: { id: "pay_fixture", order_id: "order_fixture", status: "captured", captured: true, currency: "INR", amount: 10000 }, eventKey: "event-fixed", eventHash: "changed" }));
    assert.equal(await count("callback_events"), 1); assert.equal(await stock(), 0);
  });
  test("uncaptured, partial, wrong-currency, null and conflicting captures cannot confirm orders", async () => {
    await reset(); await save("#FZ-INVALID"); await rpc("reserve", "#FZ-INVALID", actor); await bind("#FZ-INVALID");
    for (const change of [{ status: "authorized" }, { captured: false }, { status: null }, { currency: null }, { amount: null }, { amount: 1 }, { currency: "USD" }, { order_id: "order_other" }]) await assert.rejects(() => capture("#FZ-INVALID", "invalid", change));
    assert.equal(await count("payments"), 0); assert.equal((await current("#FZ-INVALID")).paymentStatus, "pending");
    await capture("#FZ-INVALID", "valid");
    await assert.rejects(() => capture("#FZ-INVALID", "conflict", { id: "pay_other" }));
    assert.equal(await count("payments"), 1);
  });
  test("32 concurrent provider-order claims allow exactly one external creation", async () => {
    await reset(); await save("#FZ-CLAIM"); await rpc("reserve", "#FZ-CLAIM", actor);
    const results = await Promise.all(Array.from({ length: 32 }, (_, i) => rpc("claim_attempt", "#FZ-CLAIM", actor, { token: `token-${i}` })));
    assert.equal(results.filter((row) => row.claimed).length, 1); assert.equal(await count("payment_attempts"), 1);
    const token = results.find((row) => row.claimed).attempt.token;
    await rpc("ambiguous_attempt", "#FZ-CLAIM", "", { token });
    assert.equal((await rpc("claim_attempt", "#FZ-CLAIM", actor, { token: "new-token" })).claimed, false);
    await assert.rejects(() => rpc("release", "#FZ-CLAIM", actor));
  });
  test("duplicate checkout submission returns the same saved order and rejects changed details", async () => {
    await reset(); const first = await save("#FZ-FIRST", {}, "request-stable");
    const second = await save("#FZ-SECOND", {}, "request-stable");
    assert.equal(first.id, second.id); assert.equal((await rpc("list")).length, 1);
    await assert.rejects(() => save("#FZ-THIRD", { total: "₹1" }, "request-stable"));
  });
  test("foreign or missing identity cannot reserve or release customer stock", async () => {
    await reset(); await save("#FZ-OWNER");
    for (const owner of ["", "other-account", null]) await assert.rejects(() => rpc("reserve", "#FZ-OWNER", owner));
    assert.equal(await stock(), 1);
  });
  test("stale whole-array writes are blocked and field patches preserve payment flags", async () => {
    await reset(); await save("#FZ-PATCH");
    await assert.rejects(() => query("update store_settings set value='[]' where key='orders'"));
    await assert.rejects(() => query("update store_settings set key='orders-renamed' where key='orders'"));
    await rpc("patch", "", "", { patches: [{ id: "#FZ-PATCH", before: { status: null }, changes: { status: "Packed" } }] });
    await assert.rejects(() => rpc("patch", "", "", { patches: [{ id: "#FZ-PATCH", before: { status: null }, changes: { status: "Cancelled" } }] }));
    await assert.rejects(() => rpc("patch", "", "", { patches: [{ id: "#FZ-PATCH", before: { paymentStatus: "pending" }, changes: { paymentStatus: "paid" } }] }));
    assert.equal((await current("#FZ-PATCH")).paymentStatus, "pending");
  });
  test("variant release credits the saved option after array reorder and rejects ambiguous options", async () => {
    await reset(3);
    await query("update store_settings set value=$1 where key='product_variants'", [JSON.stringify({ "SKU-1": [{ name: "Red", stock: 1 }, { name: "Blue", stock: 2 }] })]);
    await save("#FZ-VARIANT", { items: [{ ...order().items[0], variantName: "Red" }] });
    await rpc("reserve", "#FZ-VARIANT", actor);
    await query("update store_settings set value=$1 where key='product_variants'", [JSON.stringify({ "SKU-1": [{ name: "Blue", stock: 2 }, { name: "Red", stock: 0 }] })]);
    await rpc("release", "#FZ-VARIANT", actor);
    assert.deepEqual(JSON.parse((await query("select value from store_settings where key='product_variants'")).rows[0].value)["SKU-1"], [{ name: "Blue", stock: 2 }, { name: "Red", stock: 1 }]);
    assert.equal(await stock(), 3);
    await query("update store_settings set value=$1 where key='product_variants'", [JSON.stringify({ "SKU-1": [{ name: "Red", stock: 1 }, { name: "Red", stock: 2 }] })]);
    await save("#FZ-AMBIGUOUS", { items: [{ ...order().items[0], variantName: "Red" }] });
    await assert.rejects(() => rpc("reserve", "#FZ-AMBIGUOUS", actor));
    assert.equal(await stock(), 3);
  });
  test("captured payments remain paid but cannot fulfil when a late unreserved capture has insufficient stock", async () => {
    await reset(0); await save("#FZ-LATE");
    await query("begin; select set_config('fanzzy.checkout_rpc','on',true); update store_settings set value=jsonb_set(value::jsonb,'{0,razorpayOrderId}','\"order_fixture\"')::text where key='orders'; commit;");
    const result = await capture("#FZ-LATE", "late-captured");
    assert.equal(result.paymentStatus, "paid"); assert.equal(result.inventoryAdjusted, false); assert.equal(result.fulfillmentReview, "inventory");
    assert.equal(await count("payments"), 1); assert.equal(await stock(), 0);
    assert.deepEqual((await query("select kind,state from fanzzy_private.checkout_outbox")).rows, [{ kind: "inventory_review", state: "reconciliation" }]);
  });
  test("missing attempt tokens, provider IDs and callback hashes fail closed", async () => {
    await reset(); await save("#FZ-NULLS"); await rpc("reserve", "#FZ-NULLS", actor);
    await assert.rejects(() => rpc("bind_attempt", "#FZ-NULLS", "", { token: null, providerOrderId: null }));
    await assert.rejects(() => rpc("claim_attempt", "#FZ-NULLS", actor, { token: null }));
    await bind("#FZ-NULLS");
    await assert.rejects(() => rpc("bind_attempt", "#FZ-NULLS", "", { token: "fixture-#FZ-NULLS", providerOrderId: null }));
    await assert.rejects(() => rpc("capture", "#FZ-NULLS", "", { payment: { id: "pay_fixture", order_id: "order_fixture", status: "captured", captured: true, currency: "INR", amount: 10000 }, eventKey: "event-nohash", eventHash: null }));
    assert.equal((await current("#FZ-NULLS")).paymentStatus, "pending");
  });
  test("failure callbacks never release payable stock or reverse a captured payment", async () => {
    await reset(); await save("#FZ-FAILED"); await rpc("reserve", "#FZ-FAILED", actor); await bind("#FZ-FAILED");
    const failure = { payment: { id: "pay_failed", order_id: "order_fixture", status: "failed" }, eventKey: "failed-event", eventHash: "failed-hash" };
    await rpc("payment_failed", "#FZ-FAILED", "", failure); await rpc("payment_failed", "#FZ-FAILED", "", failure);
    assert.equal(await stock(), 0); await assert.rejects(() => rpc("release", "#FZ-FAILED", actor));
    await capture("#FZ-FAILED", "captured-event"); await rpc("payment_failed", "#FZ-FAILED", "", failure);
    assert.equal((await current("#FZ-FAILED")).paymentStatus, "paid"); assert.equal(await count("payments"), 1);
  });
  test("offer capacity and per-customer limits are held and consumed atomically across concurrent orders", async () => {
    await reset(64);
    const offer = { id: "offer-fixture", status: "Active", type: "bogo", maxTotalUsage: 2, perCustomerLimit: 1, usageCount: 0 };
    await query("insert into store_settings(key,value) values('promotional_offers',$1)", [JSON.stringify([offer])]);
    const promoQuote = () => ({ ...quote(), settings: { ...quote().settings, promotional_offers: JSON.stringify([offer]) }, promotions: [{ ...offer, sets: 1 }] });
    const promoSave = (id, owner) => rpc("save", id, owner, { order: order(id, { paymentMethod: "cod" }), requestKey: id, requestHash: id, quote: promoQuote() });
    for (let i = 0; i < 32; i++) await promoSave(`#FZ-OFFER-${i}`, i < 16 ? actor : `fixture-actor-${i}`);
    const claims = await Promise.allSettled(Array.from({ length: 32 }, (_, i) => rpc("reserve", `#FZ-OFFER-${i}`, i < 16 ? actor : `fixture-actor-${i}`)));
    const winners = claims.flatMap((result, i) => result.status === "fulfilled" ? [i] : []);
    assert.equal(winners.length, 2, claims.filter((result) => result.status === "rejected").slice(0, 3).map((result) => result.reason.message).join("; ")); assert.equal(winners.filter((i) => i < 16).length, 1); assert.equal(await stock(), 62);
    const first = winners[0]; const firstActor = first < 16 ? actor : `fixture-actor-${first}`;
    await Promise.all(Array.from({ length: 32 }, () => rpc("cod", `#FZ-OFFER-${first}`, firstActor)));
    assert.equal(JSON.parse((await query("select value from store_settings where key='promotional_offers'")).rows[0].value)[0].usageCount, 1);
    const second = winners[1]; await rpc("release", `#FZ-OFFER-${second}`, second < 16 ? actor : `fixture-actor-${second}`);
    const replacement = winners.includes(31) ? 30 : 31;
    await rpc("cod", `#FZ-OFFER-${replacement}`, `fixture-actor-${replacement}`);
    assert.equal(JSON.parse((await query("select value from store_settings where key='promotional_offers'")).rows[0].value)[0].usageCount, 2);
    assert.equal(Number((await query("select sum(sets) as n from fanzzy_private.promotion_redemptions where state='consumed'")).rows[0].n), 2);
    assert.equal(await stock(), 62);
  });
  test("public roles cannot read private orders, change stock or execute checkout RPCs", async () => {
    await reset(); await save("#FZ-PRIVATE");
    const client = await pool.connect();
    try {
      await client.query("set role anon");
      assert.equal((await client.query("select * from store_settings where key='orders'")).rowCount, 0);
      assert.equal((await client.query("update products set stock=10000 returning *")).rowCount, 0);
      await assert.rejects(() => client.query("select public.fanzzy_checkout('list')"));
    } finally { await client.query("reset role"); client.release(); }
  });
  test("32 concurrent outbox consumers claim a job once and a sending timeout never causes automatic resend", async () => {
    await reset(); await save("#FZ-OUTBOX", { paymentMethod: "cod" }); await rpc("cod", "#FZ-OUTBOX", actor);
    const jobs = await Promise.all(Array.from({ length: 32 }, (_, i) => rpc("outbox_claim", "#FZ-OUTBOX", "", { token: `job-${i}`, kind: "shipment" })));
    const claimed = jobs.filter(Boolean); assert.equal(claimed.length, 1);
    await rpc("outbox_sending", "", "", { id: claimed[0].id, token: claimed[0].token });
    await query("update fanzzy_private.checkout_outbox set lease_until=now()-interval '1 minute' where kind='shipment'");
    assert.equal(await rpc("outbox_claim", "#FZ-OUTBOX", "", { token: "retry", kind: "shipment" }), null);
    assert.equal((await query("select state from fanzzy_private.checkout_outbox where kind='shipment'")).rows[0].state, "reconciliation");
  });
  let passed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); passed++; console.log(`PASS ${name}`); }
    catch (error) { console.error(`FAIL ${name}`); throw error; }
  }
  console.log(JSON.stringify({ database: "PostgreSQL (isolated localhost fixtures)", passed, failed: 0 }));
}
