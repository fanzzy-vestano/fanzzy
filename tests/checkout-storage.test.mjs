import assert from "node:assert/strict";
import test from "node:test";
import { createFixture } from "./helpers/checkout-storage-fixture.mjs";

function browser(mode = "full") {
  const values = new Map();
  const accesses = [];
  const localStorage = {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem(key) { accesses.push(["read", key]); return values.get(key) ?? null; },
    setItem(key, value) {
      accesses.push(["write", key]);
      if (mode === "full") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      values.set(key, value);
    },
    removeItem(key) { values.delete(key); },
  };
  return {
    values, accesses,
    window: { localStorage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {} },
  };
}

for (const mode of ["normal", "full"]) {
  for (const method of ["online", "cod"]) {
    test(method + " checkout uses backend orders with " + mode + " storage", async () => {
      const b = browser(mode);
      const existing = { id: "#FZ-EXISTING", userId: "OTHER-CUSTOMER", paymentStatus: "paid", total: "₹500", items: [] };
      const fixture = createFixture(b.window, { paymentMethod: method, initialOrders: [existing] });
      fixture.cartEffect();
      await fixture.submitCheckout();
      if (method === "online") {
        assert.equal(fixture.state.opened, true);
        const before = fixture.state.calls.length;
        await fixture.submitCheckout();
        assert.equal(fixture.state.calls.length, before);
        await fixture.completePayment();
      }
      assert.equal(fixture.state.confirmation?.paymentStatus, method === "online" ? "paid" : "cod_pending");
      assert.equal(fixture.state.paying, false);
      assert.deepEqual(fixture.state.cart, {});
      assert.deepEqual(fixture.savedOrders().find(order => order.id === existing.id), existing);
      fixture.cartEffect();
      fixture.decrementLocalInventoryOnce(fixture.state.confirmation);
      assert.equal(fixture.state.productUpdates, 1);
      assert.equal(fixture.state.toasts.some(text => /quota|exceeded/i.test(text)), false);
      assert.equal(b.accesses.some(([, key]) => key === "fanzzy-orders" || key.startsWith("fanzzy-orders:")), false);
    });
  }
}

for (const options of [{ pendingStatus: 503 }, { pendingNetworkError: true }, { failInitialHistory: true, historyStatus: 503 }]) {
  test("backend failure stops payment: " + JSON.stringify(options), async () => {
    const fixture = createFixture(browser().window, options);
    await fixture.submitCheckout();
    assert.equal(fixture.state.opened, false);
    assert.equal(fixture.state.confirmation, null);
    assert.equal(fixture.state.paying, false);
    assert.equal(fixture.state.calls.some(call => call.route.startsWith("/mock/")), false);
    assert.equal(fixture.state.toasts.length, 1);
  });
}

for (const options of [{ verifyFailure: true }, { historyStatus: 503 }, { omitConfirmation: true }]) {
  test("unverified or unavailable backend confirmation cannot show success: " + JSON.stringify(options), async () => {
    const fixture = createFixture(browser().window, options);
    await fixture.submitCheckout();
    // Omitted initial history must still be an empty successful backend read.
    assert.equal(fixture.state.opened, true);
    await fixture.completePayment();
    assert.equal(fixture.state.confirmation, null);
    assert.equal(fixture.state.toasts.length, 1);
    if (!options.verifyFailure) assert.equal(fixture.state.calls.some(call => call.route === "/mock/release-stock"), false);
  });
}

test("backend history ignores stale local orders and never writes them back", async () => {
  const b = browser("normal");
  b.values.set("fanzzy-orders", '[{"id":"#FZ-STALE","userId":"LOCAL-CUSTOMER","paymentStatus":"paid"}]');
  const order = { id: "#FZ-SERVER", userId: "LOCAL-CUSTOMER", paymentStatus: "paid" };
  const fixture = createFixture(b.window, { initialOrders: [order] });
  await fixture.refreshOrders();
  assert.deepEqual(fixture.state.orders.map(value => value.id), [order.id]);
  assert.equal(fixture.state.calls.some(call => call.method === "POST" && call.route === "/orders/pending"), false);
  assert.equal(b.accesses.some(([, key]) => key === "fanzzy-orders" || key.startsWith("fanzzy-orders:")), false);
});
