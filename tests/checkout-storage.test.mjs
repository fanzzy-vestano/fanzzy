import assert from "node:assert/strict";
import test from "node:test";
import { createFixture } from "./helpers/checkout-storage-fixture.mjs";

function browser(storageMode = "normal") {
  const store = new Map();
  const accesses = [];
  const localStorage = {
    getItem(key) { accesses.push(["read", key]); return store.get(key) ?? null; },
    setItem(key, value) {
      accesses.push(["write", key]);
      if (storageMode === "full") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      store.set(key, value);
    },
    removeItem(key) { accesses.push(["remove", key]); store.delete(key); },
  };
  const window = { localStorage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {} };
  if (storageMode === "blocked") Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Storage unavailable", "SecurityError"); } });
  return { window, store, accesses };
}

for (const mode of ["normal", "full", "blocked"]) {
  test("online checkout and verified confirmation work with " + mode + " browser storage", async () => {
    const b = browser(mode);
    const fixture = createFixture(b.window);
    fixture.cartEffect();
    await fixture.submitCheckout();
    assert.equal(fixture.state.opened, true);
    assert.equal(fixture.state.toasts.length, 0);
    assert.equal(fixture.savedOrders().length, 1);
    assert.deepEqual(fixture.state.calls.map(call => call.route), ["/orders/pending", "/mock/reserve-stock", "/mock/order"]);
    const first = fixture.state.calls[0];
    assert.equal(first.headers["idempotency-key"], first.body.order.id);
    await fixture.submitCheckout();
    assert.equal(fixture.state.calls.length, 3, "Second click must not start another payment");
    await fixture.completePayment();
    assert.equal(fixture.state.confirmation?.paymentStatus, "paid");
    assert.equal(fixture.state.paying, false);
    assert.deepEqual(fixture.state.cart, {});
    fixture.cartEffect();
    assert.equal(fixture.state.productUpdates, 1);
    fixture.decrementLocalInventoryOnce(fixture.state.confirmation);
    assert.equal(fixture.state.productUpdates, 1, "Failed cache persistence cannot repeat an in-memory adjustment");
    assert.equal(fixture.state.calls.some(call => call.route === "/mock/release-stock"), false);
    assert.equal(b.accesses.some(([, key]) => key === "fanzzy-orders" || key.startsWith("fanzzy-orders:")), false);
  });
}

test("COD confirms from the backend when browser storage is full", async () => {
  const fixture = createFixture(browser("full").window, { paymentMethod: "cod" });
  await fixture.submitCheckout();
  assert.equal(fixture.state.confirmation?.paymentStatus, "cod_pending");
  assert.equal(fixture.state.opened, false);
  assert.equal(fixture.state.paying, false);
});

test("checkout waits for current offer validation before saving or contacting payment", async () => {
  const fixture = createFixture(browser("blocked").window);
  fixture.scope.onlineOffersReady = false;
  await fixture.submitCheckout();
  assert.equal(fixture.state.calls.length, 0);
  assert.equal(fixture.state.opened, false);
  assert.match(fixture.state.toasts[0], /Offers are still loading/);
});

for (const options of [
  { pendingStatus: 503 }, { pendingNetworkError: true }, { pendingMalformed: true },
  { pendingReply: { saved: false } }, { pendingReply: { saved: true } },
  { pendingReply: { saved: true, order: { id: "#FZ-WRONG" } } },
]) {
  test("backend save must be confirmed before stock/payment: " + JSON.stringify(options), async () => {
    const fixture = createFixture(browser("full").window, options);
    await fixture.submitCheckout();
    assert.equal(fixture.state.opened, false);
    assert.equal(fixture.state.paying, false);
    assert.equal(fixture.state.toasts.length, 1);
    assert.deepEqual(fixture.state.calls.map(call => call.route), ["/orders/pending"]);
  });
}

test("payment verification failure never displays a successful confirmation", async () => {
  const fixture = createFixture(browser("full").window, { verifyFailure: true });
  await fixture.submitCheckout();
  await fixture.completePayment();
  assert.equal(fixture.state.confirmation, null);
  assert.match(fixture.state.toasts[0], /Verification rejected/);
});

for (const options of [{ historyStatus: 503 }, { omitConfirmation: true }]) {
  test("confirmation requires the backend paid order: " + JSON.stringify(options), async () => {
    const fixture = createFixture(browser("full").window, options);
    await fixture.submitCheckout();
    await fixture.completePayment();
    assert.equal(fixture.state.confirmation, null);
    assert.match(fixture.state.toasts[0], /awaiting server verification/);
    assert.equal(fixture.state.calls.some(call => call.route === "/mock/release-stock"), false);
  });
}

test("order history and reload use only the authenticated backend, ignoring stale browser orders", async () => {
  const b = browser();
  const order = { id: "#FZ-SERVER", userId: "LOCAL-CUSTOMER", paymentStatus: "paid" };
  b.store.set("fanzzy-orders", JSON.stringify([{ ...order, id: "#FZ-STALE" }]));
  b.store.set("fanzzy-orders:LOCAL-CUSTOMER", JSON.stringify([{ ...order, id: "#FZ-STALE" }]));
  const fixture = createFixture(b.window, { initialOrders: [order] });
  await fixture.refreshOrders();
  assert.deepEqual(fixture.state.orders.map(value => value.id), [order.id]);
  assert.equal(b.accesses.length, 0, "History must not read or delete browser orders");
  const request = fixture.state.calls.find(call => call.route === "/orders");
  assert.equal(request.cache, "no-store");
  const reloaded = createFixture(browser("blocked").window, { initialOrders: fixture.savedOrders() });
  await reloaded.refreshOrders();
  assert.deepEqual(reloaded.state.orders.map(value => value.id), [order.id]);
});

test("a successful empty backend history does not resurrect cached orders", async () => {
  const b = browser();
  b.store.set("fanzzy-orders", '[{"id":"#FZ-STALE","userId":"LOCAL-CUSTOMER","paymentStatus":"paid"}]');
  const fixture = createFixture(b.window);
  await fixture.refreshOrders();
  assert.deepEqual(fixture.state.orders, []);
});
