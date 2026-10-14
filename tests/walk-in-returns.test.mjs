import assert from "node:assert/strict";
import test from "node:test";

import {
  processWalkInReturn,
  summarizeReturnableOrder,
  validateReturnSubmission,
} from "../lib/walk-in-returns.ts";

const config = {
  supabaseUrl: "https://returns.test",
  supabaseKey: "service-test-key",
};

const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});

const sampleOrder = {
  id: "#FZ-RET-1",
  date: "2026-10-14",
  status: "Delivered",
  total: "₹1,800",
  customerName: "Walk In Customer",
  phone: "+91 90000 00000",
  paymentStatus: "paid",
  paymentMethod: "online",
  items: [
    { name: "Pearl Ring · Size 6", productName: "Pearl Ring", productId: "RING-6", size: "6", quantity: 2, price: "₹900" },
  ],
};

const normalVariantOrder = {
  id: "#FZ-RET-2",
  date: "2026-10-14",
  status: "Delivered",
  total: "₹500",
  customerName: "Variant Customer",
  paymentStatus: "paid",
  paymentMethod: "online",
  items: [
    { name: "Stud Earrings · Gold", productName: "Stud Earrings", productId: "STUD-1", variantName: "Gold", quantity: 1, price: "₹500" },
    { name: "Stud Earrings · Silver", productName: "Stud Earrings", productId: "STUD-1", variantName: "Silver", quantity: 1, price: "₹500" },
  ],
};

const installReturnsApi = (t, state) => {
  const originalFetch = globalThis.fetch;
  const writes = [];
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method || "GET").toUpperCase();

    if (method === "GET" && url.includes("/store_settings?key=eq.")) {
      const key = decodeURIComponent(url.match(/key=eq\.([^&]+)/)?.[1] || "");
      const values = {
        orders: state.orders || [],
        walk_in_returns: state.returns || [],
        product_damages: state.damages || {},
        product_variants: state.variants || {},
        product_size_stock: state.sizeStock || {},
        product_variant_type: state.variantTypes || {},
      };
      return jsonResponse([{ value: JSON.stringify(values[key] ?? {}) }]);
    }

    if (method === "GET" && url.includes("/products?select=sku,stock")) {
      return jsonResponse(state.products || []);
    }

    if (method === "POST" && url.includes("/store_settings?on_conflict=key")) {
      if (state.failSettingWrite) return new Response("write failed", { status: 500 });
      const body = JSON.parse(String(init.body || "[]"));
      writes.push({ kind: "setting", body });
      for (const row of body) {
        if (row.key === "walk_in_returns") state.returns = JSON.parse(row.value);
        if (row.key === "orders") state.orders = JSON.parse(row.value);
        if (row.key === "product_damages") state.damages = JSON.parse(row.value);
        if (row.key === "product_size_stock") state.sizeStock = JSON.parse(row.value);
        if (row.key === "product_variants") state.variants = JSON.parse(row.value);
      }
      return new Response(null, { status: 204 });
    }

    if (method === "PATCH" && url.includes("/products?sku=eq.")) {
      if (state.failProductPatch) return new Response("patch failed", { status: 500 });
      writes.push({ kind: "product", url, body: JSON.parse(String(init.body || "{}")) });
      return new Response(null, { status: 204 });
    }

    throw new Error(`Unexpected returns request: ${method} ${url}`);
  };

  return writes;
};

test("Other return reason requires a non-empty description", () => {
  const summary = summarizeReturnableOrder(sampleOrder, []);

  assert.throws(() => validateReturnSubmission({
    orderItemId: summary.lines[0].id,
    quantity: 1,
    reason: "Other",
    description: "   ",
    refundMethod: "Cash",
    settlementStatus: "Completed",
    cashAmount: 900,
  }, summary), /Please provide a description/);
});

test("unsupported return reasons are rejected", () => {
  const summary = summarizeReturnableOrder(sampleOrder, []);

  assert.throws(() => validateReturnSubmission({
    orderItemId: summary.lines[0].id,
    quantity: 1,
    reason: "Store credit",
    refundMethod: "Cash",
    settlementStatus: "Completed",
    cashAmount: 900,
  }, summary), /supported return reason/);
});

test("completed UPI refunds require a transaction reference", () => {
  const summary = summarizeReturnableOrder(sampleOrder, []);

  assert.throws(() => validateReturnSubmission({
    orderItemId: summary.lines[0].id,
    quantity: 1,
    reason: "Product not as expected",
    refundMethod: "UPI",
    settlementStatus: "Completed",
    refundReference: "",
  }, summary), /UPI transaction reference/);
});

test("cash refunds cannot be marked completed below the eligible amount", () => {
  const summary = summarizeReturnableOrder(sampleOrder, []);

  assert.throws(() => validateReturnSubmission({
    orderItemId: summary.lines[0].id,
    quantity: 1,
    reason: "Product quality issue",
    refundMethod: "Cash",
    settlementStatus: "Completed",
    cashAmount: 899,
  }, summary), /Cash amount handed back/);
});

test("pending UPI refund can be recorded without a transaction reference", () => {
  const summary = summarizeReturnableOrder(sampleOrder, []);

  const result = validateReturnSubmission({
    orderItemId: summary.lines[0].id,
    quantity: 1,
    reason: "Product not as expected",
    refundMethod: "UPI",
    settlementStatus: "Pending",
  }, summary);

  assert.equal(result.refundAmount, 900);
  assert.equal(result.settlementStatus, "Pending");
});

test("remaining quantity accounts for previous partial returns", () => {
  const firstSummary = summarizeReturnableOrder(sampleOrder, []);
  const summary = summarizeReturnableOrder(sampleOrder, [{
    id: "RET-1",
    clientRequestId: "one",
    orderId: sampleOrder.id,
    orderItemId: firstSummary.lines[0].id,
    orderItemIndex: 0,
    productId: "RING-6",
    productName: "Pearl Ring",
    sku: "RING-6",
    variantName: "",
    size: "6",
    quantity: 1,
    reason: "Size or variant issue",
    description: "",
    damaged: false,
    refundAmount: 900,
    refundMethod: "Cash",
    refundReference: "",
    refundStatus: "Refund Completed",
    returnStatus: "Return Received",
    settlementStatus: "Completed",
    createdAt: "2026-10-14T00:00:00.000Z",
    staffMember: "Admin",
    inventoryAdjustment: { adjusted: true, damagedQuantity: 0, restockedQuantity: 1, stockScope: "Size 6" },
  }]);

  assert.equal(summary.lines[0].previouslyReturned, 1);
  assert.equal(summary.lines[0].remainingEligible, 1);
  assert.throws(() => validateReturnSubmission({
    orderItemId: summary.lines[0].id,
    quantity: 2,
    reason: "Size or variant issue",
    refundMethod: "Cash",
    settlementStatus: "Completed",
    cashAmount: 1800,
  }, summary), /remaining eligible/);
});

test("non-damaged return restocks the exact size and records the refund", async (t) => {
  const writes = installReturnsApi(t, {
    orders: [structuredClone(sampleOrder)],
    returns: [],
    sizeStock: { "RING-6": { "6": 3 } },
    variantTypes: { "RING-6": "size" },
    products: [{ sku: "RING-6", stock: 3 }],
  });
  const summary = summarizeReturnableOrder(sampleOrder, []);

  const record = await processWalkInReturn({
    orderId: sampleOrder.id,
    orderItemId: summary.lines[0].id,
    quantity: 1,
    reason: "Size or variant issue",
    damaged: false,
    refundMethod: "Cash",
    settlementStatus: "Completed",
    cashAmount: 900,
    staffMember: "Counter",
    clientRequestId: "restock-once",
  }, config);

  assert.equal(record.refundAmount, 900);
  assert.equal(record.inventoryAdjustment.adjusted, true);
  assert.equal(record.inventoryAdjustment.restockedQuantity, 1);
  const sizeWrite = writes.find((write) => write.kind === "setting" && write.body[0].key === "product_size_stock");
  assert.equal(JSON.parse(sizeWrite.body[0].value)["RING-6"]["6"], 4);
});

test("damaged return records damage without increasing sellable stock", async (t) => {
  const writes = installReturnsApi(t, {
    orders: [structuredClone(sampleOrder)],
    returns: [],
    sizeStock: { "RING-6": { "6": 3 } },
    variantTypes: { "RING-6": "size" },
    products: [{ sku: "RING-6", stock: 3 }],
  });
  const summary = summarizeReturnableOrder(sampleOrder, []);

  const record = await processWalkInReturn({
    orderId: sampleOrder.id,
    orderItemId: summary.lines[0].id,
    quantity: 1,
    reason: "Product quality issue",
    damaged: true,
    refundMethod: "UPI",
    refundReference: "UPI123",
    settlementStatus: "Completed",
    staffMember: "Counter",
    clientRequestId: "damage-once",
  }, config);

  assert.equal(record.inventoryAdjustment.damagedQuantity, 1);
  assert.equal(writes.some((write) => write.kind === "product"), false);
  const damageWrite = writes.find((write) => write.kind === "setting" && write.body[0].key === "product_damages");
  assert.equal(JSON.parse(damageWrite.body[0].value)["RING-6"][0].returnId, record.id);
});

test("duplicate client request id returns the existing record without double restocking", async (t) => {
  const state = {
    orders: [structuredClone(sampleOrder)],
    returns: [],
    sizeStock: { "RING-6": { "6": 3 } },
    variantTypes: { "RING-6": "size" },
    products: [{ sku: "RING-6", stock: 3 }],
  };
  const writes = installReturnsApi(t, state);
  const summary = summarizeReturnableOrder(sampleOrder, []);
  const request = {
    orderId: sampleOrder.id,
    orderItemId: summary.lines[0].id,
    quantity: 1,
    reason: "Size or variant issue",
    damaged: false,
    refundMethod: "Cash",
    settlementStatus: "Completed",
    cashAmount: 900,
    clientRequestId: "same-click",
  };

  const first = await processWalkInReturn(request, config);
  const second = await processWalkInReturn(request, config);

  assert.equal(second.id, first.id);
  const sizeWrites = writes.filter((write) => write.kind === "setting" && write.body[0].key === "product_size_stock");
  assert.equal(sizeWrites.length, 1);
});

test("normal variant return restocks only the selected variant", async (t) => {
  const writes = installReturnsApi(t, {
    orders: [structuredClone(normalVariantOrder)],
    returns: [],
    variants: { "STUD-1": [{ name: "Gold", stock: 2 }, { name: "Silver", stock: 4 }] },
    variantTypes: { "STUD-1": "normal" },
    products: [{ sku: "STUD-1", stock: 6 }],
  });
  const summary = summarizeReturnableOrder(normalVariantOrder, []);

  const record = await processWalkInReturn({
    orderId: normalVariantOrder.id,
    orderItemId: summary.lines[0].id,
    quantity: 1,
    reason: "Wrong product received",
    damaged: false,
    refundMethod: "Cash",
    settlementStatus: "Completed",
    cashAmount: 500,
    clientRequestId: "variant-restock",
  }, config);

  assert.equal(record.variantName, "Gold");
  const variantWrite = writes.find((write) => write.kind === "setting" && write.body[0].key === "product_variants");
  assert.deepEqual(JSON.parse(variantWrite.body[0].value)["STUD-1"], [{ name: "Gold", stock: 3 }, { name: "Silver", stock: 4 }]);
});

test("free promotional item refunds zero and still observes quantity limits", () => {
  const promoOrder = {
    ...sampleOrder,
    items: [{ ...sampleOrder.items[0], quantity: 1, price: "₹0", promotion: { role: "free", label: "BOGO", linePrice: 0, regularPrice: 900 } }],
  };
  const summary = summarizeReturnableOrder(promoOrder, []);
  const result = validateReturnSubmission({
    orderItemId: summary.lines[0].id,
    quantity: 1,
    reason: "Product not as expected",
    refundMethod: "Cash",
    settlementStatus: "Completed",
    cashAmount: 0,
  }, summary);

  assert.equal(result.refundAmount, 0);
  assert.equal(summary.lines[0].remainingEligible, 1);
});

test("inventory failure does not leave a return record behind", async (t) => {
  const writes = installReturnsApi(t, {
    orders: [structuredClone(sampleOrder)],
    returns: [],
    products: [],
  });
  const summary = summarizeReturnableOrder(sampleOrder, []);

  await assert.rejects(() => processWalkInReturn({
    orderId: sampleOrder.id,
    orderItemId: summary.lines[0].id,
    quantity: 1,
    reason: "Size or variant issue",
    damaged: false,
    refundMethod: "Cash",
    settlementStatus: "Completed",
    cashAmount: 900,
    clientRequestId: "fail-inventory",
  }, config), /restocked|inventory|stock/i);

  assert.equal(writes.some((write) => write.kind === "setting" && write.body[0].key === "walk_in_returns"), false);
});

