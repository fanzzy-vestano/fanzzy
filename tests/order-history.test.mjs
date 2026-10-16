import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/order-history.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function loadHistory(initialStorage = {}) {
  const values = new Map(Object.entries(initialStorage));
  const storage = {
    get length() { return values.size; },
    key: (index) => Array.from(values.keys())[index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
  };
  const api = {};
  new Function("exports", "window", compiled)(api, { localStorage: storage });
  return { ...api, storage };
}

const paidOrder = {
  id: "#FZ-POS-DELETE", total: "₹55", customerName: "Test customer",
  razorpayOrderId: "order_test_delete", razorpayPaymentId: "pay_test_delete",
  paymentStatus: "paid", inventoryAdjusted: true,
  items: [{ productId: "RING-1", name: "Test ring", quantity: 1, price: "₹55" }],
};
const unrelatedOrder = { id: "#FZ-KEEP", total: "₹100", items: [{ productId: "KEEP-1", quantity: 1 }] };
const marker = (order = paidOrder, deletedAt = "2026-10-16T12:00:00.000Z") => ({ order, deletedAt });
const cacheKey = "fanzzy-order-history-deletions";

test("deleted order history matches order, Razorpay payment and Razorpay order identities", () => {
  const { filterOrderHistory } = loadHistory();
  const orders = [
    { ...paidOrder },
    { id: "recovered-payment", razorpayPaymentId: paidOrder.razorpayPaymentId },
    { id: "recovered-order", razorpayOrderId: paidOrder.razorpayOrderId },
    { id: "different-payment", razorpayPaymentId: "pay_keep", razorpayOrderId: "order_keep" },
    unrelatedOrder,
  ];
  assert.deepEqual(filterOrderHistory(orders, [marker()]), [orders[3], unrelatedOrder]);
  assert.equal(orders.length, 5, "filtering must not mutate the caller's saved records");
});

test("stale cache merges cannot restore a deleted order or strip canonical payment and inventory fields", () => {
  const { filterOrderHistory, mergeOrderHistoryForSave } = loadHistory();
  const canonical = { ...paidOrder, inventoryAdjustedAt: "2026-10-16T11:00:00.000Z", paymentStatus: "paid" };
  const stale = { id: paidOrder.id, paymentStatus: "pending", inventoryAdjusted: false, items: [] };
  const latestOtherOrder = { id: "#FZ-NEW-FROM-OTHER-DEVICE", total: "₹200" };
  const incoming = [stale, { id: "recovered-payment", razorpayPaymentId: paidOrder.razorpayPaymentId }, unrelatedOrder];
  const saved = mergeOrderHistoryForSave(incoming, [canonical, latestOtherOrder], [marker()]);

  assert.deepEqual(saved.find((order) => order.id === paidOrder.id), canonical);
  assert.equal(saved.some((order) => order.id === "recovered-payment"), false);
  assert.deepEqual(filterOrderHistory(saved, [marker()]), [unrelatedOrder, latestOtherOrder]);
  assert.equal(incoming[0].inventoryAdjusted, false, "merging must leave the caller's stale cache unchanged");
});

test("archived snapshot restores bookkeeping when the canonical raw order is missing", () => {
  const { filterOrderHistory, mergeOrderHistoryForSave } = loadHistory();
  const saved = mergeOrderHistoryForSave([unrelatedOrder], [], [marker()]);
  assert.deepEqual(saved.find((order) => order.id === paidOrder.id), paidOrder);
  assert.deepEqual(filterOrderHistory(saved, [marker()]), [unrelatedOrder]);
});

test("deletion purges shared and per-user order caches while preserving auth navigation and unrelated data", () => {
  const orderCache = JSON.stringify([paidOrder, unrelatedOrder]);
  const afterAuth = JSON.stringify({ redirectTo: "/orders", orderId: paidOrder.id });
  const otherData = JSON.stringify([paidOrder]);
  const history = loadHistory({
    "fanzzy-orders": orderCache,
    "fanzzy-orders:user-one": orderCache,
    "fanzzy-orders:user-two": orderCache,
    "fanzzy-orders-after-auth": afterAuth,
    "unrelated-setting": otherData,
  });

  history.cacheOrderHistoryDeletions([marker()]);
  for (const key of ["fanzzy-orders", "fanzzy-orders:user-one", "fanzzy-orders:user-two"]) {
    assert.deepEqual(JSON.parse(history.storage.getItem(key)), [unrelatedOrder], key);
  }
  assert.equal(history.storage.getItem("fanzzy-orders-after-auth"), afterAuth);
  assert.equal(history.storage.getItem("unrelated-setting"), otherData);
  assert.deepEqual(history.filterVisibleOrders([paidOrder, unrelatedOrder]), [unrelatedOrder]);
});

test("stale empty remote and browser-cache refreshes cannot clear a deletion", () => {
  const history = loadHistory();
  history.cacheOrderHistoryDeletions([marker()]);
  history.storage.setItem(cacheKey, "[]");
  assert.deepEqual(history.filterVisibleOrders([paidOrder, unrelatedOrder]), [unrelatedOrder]);
  const retained = history.cacheOrderHistoryDeletions([]);
  assert.deepEqual(retained, [marker()]);
  assert.deepEqual(JSON.parse(history.storage.getItem(cacheKey)), [marker()]);
});

test("older same-order marker refreshes retain the newer snapshot and its payment identities", () => {
  const history = loadHistory();
  const newer = marker(paidOrder, "2026-10-16T12:00:00.000Z");
  const older = marker({ id: paidOrder.id, items: [] }, "2026-10-16T11:00:00.000Z");
  history.cacheOrderHistoryDeletions([newer]);
  assert.deepEqual(history.cacheOrderHistoryDeletions([older]), [newer]);
  history.storage.setItem(cacheKey, JSON.stringify([older]));
  assert.deepEqual(history.filterVisibleOrders([
    { id: "recovered-payment", razorpayPaymentId: paidOrder.razorpayPaymentId },
    unrelatedOrder,
  ]), [unrelatedOrder]);
  assert.deepEqual(history.cacheOrderHistoryDeletions([]), [newer]);
});

test("corrupt or unavailable browser storage does not lose known deletion markers", () => {
  const history = loadHistory();
  history.cacheOrderHistoryDeletions([marker()]);
  history.storage.setItem(cacheKey, "not-json");
  assert.deepEqual(history.filterVisibleOrders([paidOrder, unrelatedOrder]), [unrelatedOrder]);
  history.storage.getItem = () => { throw new Error("Storage unavailable"); };
  assert.deepEqual(history.cacheOrderHistoryDeletions([]), [marker()]);
  assert.deepEqual(history.filterVisibleOrders([paidOrder, unrelatedOrder]), [unrelatedOrder]);
});
