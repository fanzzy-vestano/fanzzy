import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { loadBrowserStorage } from "./helpers/browser-storage-fixture.mjs";
import { savePendingPosOrder, confirmPosOrder } from "../lib/pos-checkout.ts";

const order = {
  id: "#FZ-POS-TEST01", paymentStatus: "pending", razorpayOrderId: "order_test",
  items: [{ productId: "SKU1", name: "Shirt", variantName: "Blue", size: "M", quantity: 2, price: "₹50", image: "/shirt.png" }],
};
const payment = { razorpay_order_id: "order_test", razorpay_payment_id: "pay_test", razorpay_signature: "signature" };

test("saved product, variant, size and quantity survive payment and order recovery", async () => {
  let stored = [{ id: "#FZ-OTHER", paymentStatus: "pending", items: [{ name: "Other product" }] }];
  const read = async () => ({ data: structuredClone(stored), error: null });
  await savePendingPosOrder(order, read, async (orders) => { stored = structuredClone(orders); return null; });
  assert.deepEqual(stored[0].items, order.items);
  const calls = [];
  const verify = async (body) => {
    calls.push(body);
    if (!body.posSale) stored[0] = { ...stored[0], paymentStatus: "paid", razorpayPaymentId: "pay_test", inventoryAdjusted: true };
    return { verified: true };
  };
  const confirmed = await confirmPosOrder(order.id, 10000, payment, verify, read);
  assert.equal(calls[0].posSale, true);
  assert.equal(calls[0].posAmount, 10000);
  assert.equal(calls[1].posSale, undefined);
  assert.equal(confirmed.order.id, order.id);
  assert.deepEqual(confirmed.order.items, order.items);
  assert.equal(confirmed.orders.length, 2);
  // Retrying confirmation reuses the same order and does not add duplicates.
  await confirmPosOrder(order.id, 10000, payment, verify, read);
  assert.equal(stored.length, 2);
});

test("storage failures block payment preparation without discarding existing orders", async () => {
  let writes = 0;
  const save = async () => { writes++; return new Error("offline"); };
  await assert.rejects(savePendingPosOrder(order, async () => ({ data: null, error: new Error("offline") }), save), /Could not load orders/);
  assert.equal(writes, 0);
  await assert.rejects(savePendingPosOrder(order, async () => ({ data: [], error: null }), save), /Could not save the selected products/);
  assert.equal(writes, 1);
});

test("payment verification failure cannot finalize an order", async () => {
  let calls = 0;
  await assert.rejects(confirmPosOrder(order.id, 10000, payment, async () => { calls++; return { verified: false }; }, async () => { throw new Error("must not read"); }), /could not be verified/);
  assert.equal(calls, 1);
});

test("confirmation requires the saved items and the exact verified payment", async () => {
  for (const bad of [
    { ...order, paymentStatus: "paid", razorpayPaymentId: "pay_test", items: [] },
    { ...order, paymentStatus: "paid", razorpayPaymentId: "pay_other" },
    order,
  ]) {
    await assert.rejects(confirmPosOrder(order.id, 10000, payment, async () => ({ verified: true }), async () => ({ data: [bad], error: null })), /waiting for the saved order/);
  }
});

test("an already-paid order cannot be overwritten by a pending checkout", async () => {
  await assert.rejects(savePendingPosOrder(order, async () => ({ data: [{ ...order, paymentStatus: "paid" }], error: null }), async () => { throw new Error("must not write"); }), /already paid/);
});

// Exercise the actual React event handlers with a fake provider and storage.
// No live payment, stock mutation or network request is made by this harness.
function checkoutHarness({ saveError = null, fullStorage = false, windowOverride = null } = {}) {
  const source = fs.readFileSync("app/admin/page.tsx", "utf8");
  const start = source.indexOf("  const confirmUpiSale = ");
  const end = source.indexOf("  const updateQuantity = ", start);
  assert.ok(start > 0 && end > start);
  const code = ts.transpile(source.slice(start, end) + "\nreturn startUpiCheckout;", { target: ts.ScriptTarget.ES2022 });
  const state = { orders: [], options: null, opened: 0, lastSale: null, error: "", events: [] };
  const current = { status: "ready", orderId: "order_test", keyId: "public_test", amount: 10000 };
  const refs = { current };
  const dependencies = {
    posPaymentProcessingRef: { current: false }, posQrRef: refs, posOrderIdRef: { current: order.id },
    total: 100, discount: 0, customerName: "Customer", customerPhone: "", checkoutBusy: false,
    cartLines: [{ product: { sku: "SKU1", name: "Shirt" }, selection: { price: "₹50", image: "/shirt.png", variantName: "Blue", size: "M" }, quantity: 2 }],
    savePendingPosOrder, confirmPosOrder,
    fetchStoreOrders: async () => ({ data: structuredClone(state.orders), error: null }),
    saveStoreOrders: async (orders) => { if (!saveError) state.orders = structuredClone(orders); return saveError; },
    loadAdminRazorpayCheckout: async () => class {
      constructor(options) { state.options = options; }
      open() { assert.deepEqual(state.orders[0].items[0], { productId: "SKU1", productName: "Shirt", name: "Shirt", quantity: 2, price: "₹50", image: "/shirt.png", variantName: "Blue", variantImage: "/shirt.png", size: "M" }); state.opened++; }
    },
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (!body.posSale) state.orders[0] = { ...state.orders[0], paymentStatus: "paid", razorpayPaymentId: "pay_test", inventoryAdjusted: true };
      return new Response(JSON.stringify({ verified: true }));
    },
    adminRazorpayApiUrl: () => "https://payment.test/verify", formatPosCurrency: (n) => `₹${n}`, filterVisibleOrders: (orders) => orders,
    setCheckoutBusy: () => {}, setError: (error) => { state.error = error; }, setPosQr: () => {},
    setLastSale: (sale) => { state.lastSale = sale; }, setCart: () => {}, setDiscountValue: () => {},
    setCustomerName: () => {}, setCustomerPhone: () => {}, setLastProduct: () => {}, onNotify: () => {},
    window: { localStorage: {
      getItem: () => null,
      setItem: () => { if (fullStorage) throw new DOMException("Storage full", "QuotaExceededError"); },
    }, dispatchEvent: (event) => { state.events.push(event.type); } },
  };
  if (windowOverride) dependencies.window = windowOverride;
  dependencies.browserLocalStorage = loadBrowserStorage(dependencies.window).browserLocalStorage;
  return { state, start: new Function(...Object.keys(dependencies), code)(...Object.values(dependencies)), refs };
}

test("actual POS handler saves products before opening and completes the itemized order automatically", async () => {
  const harness = checkoutHarness();
  await harness.start();
  assert.equal(harness.state.opened, 1);
  harness.state.options.handler(payment);
  for (let i = 0; i < 20 && !harness.state.lastSale; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.state.error, "");
  assert.equal(harness.state.lastSale.id, order.id);
  assert.equal(harness.state.lastSale.paymentStatus, "paid");
  assert.equal(harness.state.lastSale.items[0].variantName, "Blue");
  assert.equal(harness.state.lastSale.items[0].size, "M");
  assert.ok(harness.state.events.includes("fanzzy-orders-updated"));
  harness.state.options.modal.ondismiss();
  assert.equal(harness.refs.current.status, "idle");
});

test("actual POS handler never opens payment when saving selected products fails", async () => {
  const harness = checkoutHarness({ saveError: new Error("offline") });
  await harness.start();
  assert.equal(harness.state.opened, 0);
  assert.match(harness.state.error, /Could not save the selected products/);
});

test("POS UPI startup and verified sale completion tolerate full browser storage", async () => {
  const harness = checkoutHarness({ fullStorage: true });
  await harness.start();
  assert.equal(harness.state.opened, 1);
  harness.state.options.handler(payment);
  for (let i = 0; i < 20 && !harness.state.lastSale; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.state.error, "");
  assert.equal(harness.state.lastSale?.paymentStatus, "paid");
  assert.equal(harness.refs.current.status, "idle");
});
