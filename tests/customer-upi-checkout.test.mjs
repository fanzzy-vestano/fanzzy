import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { createFixture } from "./helpers/checkout-storage-fixture.mjs";

const compile = file => ts.transpileModule(readFileSync(new URL("../" + file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helpers = {};
new Function("exports", compile("lib/customer-upi-checkout.ts"))(helpers);
const browser = () => ({ localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, dispatchEvent() {} });
const tick = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 0)); };

test("UPI ID entry is limited to iOS mobile web, including iPad desktop mode", () => {
  for (const userAgent of ["iPhone", "iPad", "iPod"]) assert.equal(helpers.supportsUpiIdEntry({ userAgent }), true);
  assert.equal(helpers.supportsUpiIdEntry({ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 }), true);
  for (const userAgent of ["Android Chrome", "Windows Chrome", "Macintosh Safari", ""]) assert.equal(helpers.supportsUpiIdEntry({ userAgent }), false);
});

test("supported ID checkout preserves QR, app and all default payment fallbacks", () => {
  const options = helpers.customerUpiOptions(true, true).config.display;
  assert.deepEqual(options.blocks.upi_id.instruments, [{ method: "upi", flows: ["collect"] }]);
  assert.deepEqual(options.blocks.upi_fallback.instruments, [{ method: "upi", flows: ["qr", "intent"] }]);
  assert.equal(options.preferences.show_default_blocks, true);
  for (const [selected, supported] of [[true, false], [false, true], [false, false]]) {
    assert.deepEqual(helpers.customerUpiOptions(selected, supported).config.display.hide, [{ method: "upi", flows: ["collect"] }]);
  }
});

test("VPA entry and format validation stay with Razorpay; provider rejection never confirms an order", async () => {
  const fixture = createFixture(browser(), { upiChoice: "upi-id", upiIdSupported: true });
  await fixture.submitCheckout();
  assert.equal(fixture.state.providerOptions.config.display.blocks.upi_id.name, "Pay using UPI ID");
  fixture.state.providerEvents["payment.failed"]({ error: { description: "Invalid UPI ID. Enter a valid address such as name@okaxis." } });
  assert.match(fixture.state.paymentNotice, /Invalid UPI ID/);
  assert.equal(fixture.state.confirmation, null);
  assert.equal(fixture.state.calls.some(call => call.route === "/mock/verify"), false);
  // A subsequent valid provider payment is still confirmed on the backend.
  await fixture.completePayment();
  assert.equal(fixture.state.confirmation.paymentStatus, "paid");
});

test("a successful payment callback is serialized; duplicate callbacks do not create or deduct twice", async () => {
  const fixture = createFixture(browser());
  await Promise.all([fixture.submitCheckout(), fixture.submitCheckout()]);
  assert.equal(fixture.state.openCount, 1);
  fixture.state.providerOptions.handler({ razorpay_order_id: "order_LOCAL", razorpay_payment_id: "pay_LOCAL", razorpay_signature: "LOCAL_SIGNATURE" });
  fixture.state.providerOptions.handler({ razorpay_order_id: "order_LOCAL", razorpay_payment_id: "pay_LOCAL", razorpay_signature: "LOCAL_SIGNATURE" });
  await tick();
  assert.equal(fixture.savedOrders().length, 1);
  assert.equal(fixture.state.calls.filter(call => call.route === "/mock/verify").length, 1);
  assert.equal(fixture.state.productUpdates, 1);
  fixture.state.providerOptions.handler({ razorpay_order_id: "order_LOCAL", razorpay_payment_id: "pay_LOCAL", razorpay_signature: "LOCAL_SIGNATURE" });
  await tick();
  assert.equal(fixture.state.paying, false);
  assert.equal(fixture.state.calls.filter(call => call.route === "/mock/verify").length, 1);
});

test("dismiss and retry reuse the same merchant and Razorpay order", async () => {
  const fixture = createFixture(browser());
  await fixture.submitCheckout();
  fixture.state.providerOptions.modal.ondismiss(); await tick();
  await fixture.submitCheckout();
  assert.equal(fixture.state.openCount, 2);
  assert.equal(fixture.state.calls.filter(call => call.route === "/mock/order").length, 1);
  assert.equal(fixture.savedOrders().length, 1);
  await fixture.completePayment(); assert.equal(fixture.state.confirmation.paymentStatus, "paid");
});

test("confirmation failure retains proof and retries verification without another payment or stock release", async () => {
  const options = { verifyFailure: true }, fixture = createFixture(browser(), options);
  await fixture.submitCheckout(); await fixture.completePayment();
  assert.equal(fixture.state.confirmation, null); assert.equal(fixture.state.confirmationPending, true);
  assert.equal(fixture.state.calls.some(call => call.route === "/mock/release-stock"), false);
  fixture.state.providerOptions.modal.ondismiss();
  options.verifyFailure = false;
  await fixture.scope.retryConfirmationRef.current();
  assert.equal(fixture.state.confirmation.paymentStatus, "paid");
  assert.equal(fixture.state.calls.filter(call => call.route === "/mock/order").length, 1);
  assert.equal(fixture.state.openCount, 1);
});

test("payment proof for a different order is rejected before verification", async () => {
  const fixture = createFixture(browser()); await fixture.submitCheckout();
  fixture.state.providerOptions.handler({ razorpay_order_id: "order_OTHER", razorpay_payment_id: "pay_OTHER", razorpay_signature: "OTHER" }); await tick();
  assert.equal(fixture.state.confirmation, null);
  assert.match(fixture.state.paymentNotice, /reference mismatch/);
  assert.equal(fixture.state.calls.some(call => call.route === "/mock/verify"), false);
});

test("confirmation gate never accepts another payment while the original is unconfirmed", async () => {
  const gate = helpers.paymentConfirmationGate();
  const proof = { razorpay_order_id: "order_A", razorpay_payment_id: "pay_A", razorpay_signature: "proof" };
  await assert.rejects(gate.confirm(proof, async () => { throw Error("offline"); }), /offline/);
  await assert.rejects(gate.confirm({ ...proof, razorpay_payment_id: "pay_B" }, async () => {}), /Do not pay again/);
  await gate.confirm(proof, async () => {}); assert.equal(gate.confirmed, true);
});

test("unconfirmed payment proof survives a refresh and resumes verification without opening Razorpay", async () => {
  const values = new Map();
  const window = { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }, dispatchEvent() {} };
  const first = createFixture(window, { verifyFailure: true });
  await first.submitCheckout(); await first.completePayment();
  const before = first.savedOrders();
  const freshWindow = { ...window };
  const next = createFixture(freshWindow, { initialOrders: before });
  await next.submitCheckout();
  assert.equal(next.state.confirmation.paymentStatus, "paid");
  assert.equal(next.state.calls.some(call => call.route === "/mock/order"), false);
  assert.equal(next.state.calls.some(call => call.route === "/mock/reserve-stock"), false);
  assert.equal(next.savedOrders().length, 1);
  assert.equal(next.state.opened, false);
});

test("customer payment attempts have a durable IndexedDB fallback when localStorage is full", async () => {
  const { createRequire } = await import("node:module");
  const { IDBFactory } = createRequire(import.meta.url)("fake-indexeddb");
  const { loadBrowserStorage } = await import("./helpers/browser-storage-fixture.mjs");
  const indexedDB = new IDBFactory();
  const full = () => ({ indexedDB, localStorage: { getItem: () => null, setItem() { throw new DOMException("full", "QuotaExceededError"); }, removeItem() {} } });
  const key = "fanzzy-customer-checkout-attempt:LOCAL", expected = JSON.stringify({ orderId: "#FZ-LOCAL", providerOrder: "order_LOCAL" });
  const first = loadBrowserStorage(full()); first.browserLocalStorage.setItem(key, expected); assert.equal(await first.flushBrowserStorage(), true);
  const restored = loadBrowserStorage(full()); await restored.prepareBrowserStorage(); assert.equal(restored.browserLocalStorage.getItem(key), expected);
});

test("recovering an earlier payment preserves a newly edited cart instead of paying for it twice", async () => {
  const values = new Map();
  const window = { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }, dispatchEvent() {} };
  const first = createFixture(window, { verifyFailure: true });
  await first.submitCheckout(); await first.completePayment();
  const next = createFixture({ ...window }, { initialOrders: first.savedOrders() });
  next.scope.cartItems = next.scope.cartItems.map(item => ({ ...item, quantity: 2 }));
  next.scope.cart = { "LOCAL-PRODUCT": 2 }; next.state.cart = next.scope.cart;
  await next.submitCheckout();
  assert.equal(next.state.confirmation.paymentStatus, "paid");
  assert.deepEqual(next.state.cart, { "LOCAL-PRODUCT": 2 });
  assert.equal(next.state.calls.some(call => call.route === "/mock/order"), false);
  assert.equal(next.savedOrders().length, 1);
});

test("server rejects authorized, failed and mismatched payments despite a valid callback signature", async () => {
  const secret = "LOCAL_TEST_ONLY", orderId = "order_LOCAL", paymentId = "pay_LOCAL";
  const signature = createHmac("sha256", secret).update(orderId + "|" + paymentId).digest("hex");
  for (const [status, id, expected] of [["authorized", paymentId, 409], ["failed", paymentId, 409], ["captured", "pay_OTHER", 502], ["captured", paymentId, 200]]) {
    const route = {}; let finalized = 0;
    new Function("exports", "require", "process", "fetch", compile("app/api/razorpay/verify/route.ts"))(route,
      name => name === "node:crypto" ? { createHmac, timingSafeEqual: (a, b) => a.equals(b) } : {
        finalizeRazorpayPayment: async () => { finalized++; return { inventoryAdjusted: true }; },
      }, { env: { RAZORPAY_KEY_SECRET: secret } },
      async () => Response.json({ id, order_id: orderId, status, amount: 3900 }));
    const response = await route.POST(new Request("https://local.invalid/verify", { method: "POST", body: JSON.stringify({ razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: signature }) }));
    assert.equal(response.status, expected); assert.equal(finalized, expected === 200 ? 1 : 0);
  }
});

test("production payment Worker rejects an incorrect bill amount/currency before any database write", async () => {
  for (const [amount, currency] of [[3800, "INR"], [3900, "USD"], [3900, "INR"]]) {
    let writes = 0, deductions = 0;
    let orders = [{ id: "#FZ-CUSTOMER", total: "₹39", razorpayOrderId: "order_LOCAL", paymentStatus: "pending", inventoryReserved: true }];
    const fetch = async (url, init = {}) => {
      if (url.startsWith("https://api.razorpay.com/")) return Response.json({ id: "pay_LOCAL", order_id: "order_LOCAL", status: "captured", amount, currency });
      if (url.includes("store_settings")) {
        if (init.method === "POST") { writes++; orders = JSON.parse(JSON.parse(init.body)[0].value); return new Response(null, { status: 204 }); }
        return Response.json([{ value: JSON.stringify(orders) }]);
      }
      throw Error("Unexpected request: " + url);
    };
    const exported = {};
    new Function("exports", "require", "fetch", compile("worker/razorpay-api.ts"))(exported, name => {
      if (name === "../lib/inventory-adjustment") return { adjustOrderInventory: async () => { deductions++; return { complete: true }; } };
      if (name === "../lib/pos-sale-server") return { finalizeAtomicPosPayment: () => { throw Error("Not a POS bill"); } };
      throw Error("Unmocked import: " + name);
    }, fetch);
    const env = { RAZORPAY_KEY_ID: "LOCAL", RAZORPAY_KEY_SECRET: "LOCAL_SECRET", SUPABASE_URL: "https://db.invalid", SUPABASE_SERVICE_ROLE_KEY: "LOCAL_ROLE" };
    const signature = createHmac("sha256", env.RAZORPAY_KEY_SECRET).update("order_LOCAL|pay_LOCAL").digest("hex");
    const request = () => new Request("https://local.invalid/verify", { method: "POST", body: JSON.stringify({ razorpayOrderId: "order_LOCAL", razorpayPaymentId: "pay_LOCAL", razorpaySignature: signature }) });
    const response = await exported.default.fetch(request(), env);
    if (amount === 3900 && currency === "INR") {
      assert.equal(response.status, 200); assert.equal((await response.json()).verified, true);
      const writesBeforeReplay = writes;
      assert.equal((await exported.default.fetch(request(), env)).status, 200);
      assert.equal(writes, writesBeforeReplay); assert.equal(deductions, 0);
    } else { assert.equal(response.status, 502); assert.equal(writes, 0); assert.equal(deductions, 0); }
  }
});
