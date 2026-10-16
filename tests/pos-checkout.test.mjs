import assert from "node:assert/strict";
import test from "node:test";
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
