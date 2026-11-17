import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";

const root = join(import.meta.dirname, "..");
const policyModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(join(root, "lib", "payment-policy.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { module: policyModule, exports: policyModule.exports });
const source = readFileSync(join(root, "lib", "razorpay-payment-sync.ts"), "utf8")
  .replace('import { isPosOrder, orderNeedsDelivery } from "./order-fulfillment";', 'const isPosOrder = (order) => /^#?FZ-POS-/i.test(order.id); const orderNeedsDelivery = (order) => !isPosOrder(order) && order.fulfillmentMethod !== "pickup";')
  .replace('import { createDelhiveryPickupRequest, delhiveryPickupSchedule, getDelhiveryAdminOptions, loadDelhiveryAdminOptions, manifestDelhiveryShipment, trackDelhiveryShipment } from "./delhivery";', `
const createDelhiveryPickupRequest = async () => ({});
const delhiveryPickupSchedule = () => ({ pickupDate: "2026-10-13", pickupTime: "11:00:00", currentDate: "2026-10-13" });
const getDelhiveryAdminOptions = () => ({ pickupLocations: ["Fanzzy Warehouse"], defaultPickupTime: "11:00" });
const loadDelhiveryAdminOptions = async () => getDelhiveryAdminOptions();
const manifestDelhiveryShipment = async () => ({ waybill: "MOCK123456", status: "Manifested", trackingUrl: "https://example.test/track" });
const trackDelhiveryShipment = async (waybill) => ({ waybill, status: "Manifested", scans: [] });
`)
  .replace('import { syncVendorOrderForPaidOrder } from "./vendor-server";', "const syncVendorOrderForPaidOrder = async () => {};")
  .replace('import { assertLocalTestServerSafety, isLocalTestEnvironment } from "./runtime-safety";', "const assertLocalTestServerSafety = () => {}; const isLocalTestEnvironment = () => true;");

const compiled = ts.transpileModule(`${source}
module.exports = { saveMobilePendingOrder, listCustomerOrders, finalizeRazorpayPayment };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const loadPaymentSync = (responses) => {
  const writes = [];
  const transactions = { exports: {} };
  const fixtureFetch = async (input, init = {}) => {
    assert.match(String(input), /rest\/v1\/rpc\/fanzzy_checkout$/);
    const request = JSON.parse(init.body);
    const { p_action: action, p_order_id: id, p_data: data } = request;
    if (action === "list") return Response.json(responses.orders || []);
    if (action === "lookup_request") return Response.json(null);
    if (action === "save") {
      if (responses.orders?.some((order) => order.id === id && order.paymentStatus !== "pending")) return Response.json({ code: "P0001", message: "Order has already been confirmed." }, { status: 409 });
      writes.push(request);
      responses.orders = [...(responses.orders || []).filter((order) => order.id !== id), data.order];
      return Response.json(data.order);
    }
    if (action === "capture") return Response.json(responses.orders.find((order) => order.id === id));
    throw new Error(`Unexpected checkout action: ${action}`);
  };
  const transactionSandbox = {
    module: transactions, exports: transactions.exports, Buffer, Response, URL, AbortSignal, fetch: fixtureFetch,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://isolated.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-only" } },
    require: (name) => {
      if (name === "node:crypto") return crypto;
      if (name === "./runtime-safety") return { assertLocalTestServerSafety: () => {} };
      throw new Error(`Unexpected transaction import: ${name}`);
    },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(join(root, "lib", "transactional-checkout.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, transactionSandbox);
  const sandbox = {
    require: (name) => {
      if (name === "./payment-policy") return policyModule.exports;
      if (name === "node:crypto") return crypto;
      if (name === "./transactional-checkout") return transactions.exports;
      if (name === "./razorpay-provider") return { recoverCapturedOrderBinding: async () => { throw new Error("Unexpected missing binding"); } };
      if (name === "./mobile-checkout-authority") return { authorizeMobileQuote: async () => ({ prices: { "FZ-1": 149900 }, settings: {}, expiresAt: new Date(Date.now() + 60000).toISOString() }) };
      throw new Error(`Unexpected import: ${name}`);
    },
    module: { exports: {} },
    exports: {},
    process: {
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://xxibqydsluzgezqiyyyx.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      },
    },
    fetch: async (input, init = {}) => {
      const url = String(input);
      const method = String(init.method || "GET").toUpperCase();
      if (method === "GET" && url.includes("/store_settings?key=eq.orders&select=value")) {
        return new Response(JSON.stringify([{ value: JSON.stringify(responses.orders || []) }]), { status: 200 });
      }
      if (method === "POST" && url.includes("/store_settings?on_conflict=key")) {
        const body = JSON.parse(String(init.body || "[]"));
        writes.push(body);
        responses.orders = JSON.parse(body[0].value);
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    },
    Response,
    URL,
    Date,
    Intl,
    Number,
    Math,
    JSON,
    String,
    RegExp,
    Buffer,
    console,
  };
  vm.runInNewContext(compiled, sandbox);
  return { ...sandbox.module.exports, writes };
};

const identity = { id: "phone:919876543210", phone: "+919876543210" };

test("customer history returns every owned order newest first without leaking another account", async () => {
  const base = { date: "2026-10-13", status: "Processing", total: "₹100", phone: identity.phone };
  const api = loadPaymentSync({ orders: [
    { ...base, id: "#FZ-OLD", userId: identity.id, createdAt: "2026-10-12T10:00:00Z", address: "Private address" },
    { ...base, id: "#FZ-OTHER", userId: "another-account" },
    { ...base, id: "#FZ-LEGACY", createdAt: "2026-10-13T10:00:00Z" },
    { ...base, id: "#FZ-UNRELATED", phone: "9999999999" },
  ] });
  const orders = await api.listCustomerOrders(identity);
  assert.deepEqual(Array.from(orders, (order) => order.id), ["#FZ-LEGACY", "#FZ-OLD"]);
  assert.equal(orders[1].address, undefined);
  assert.equal(orders[1].phone, undefined);
});

test("customer history returns an empty list when this account has no orders", async () => {
  const api = loadPaymentSync({ orders: [{ id: "#FZ-OTHER", date: "2026-10-13", userId: "another-account" }] });
  assert.equal((await api.listCustomerOrders(identity)).length, 0);
});
const pendingOrder = {
  id: "#FZ-MOBILE1",
  userId: "phone:919876543210",
  userPhone: "+919876543210",
  userEmail: "asha@example.com",
  date: "2026-10-13",
  createdAt: "2026-10-13T10:30:00.000Z",
  status: "Processing",
  total: "₹1,499",
  customerName: "Asha Customer",
  phone: "+91 98765 43210",
  email: "asha@example.com",
  address: "12 Pearl Street, Landmark: Near metro, 673602",
  fulfillmentMethod: "delivery",
  paymentStatus: "pending",
  paymentMethod: "cod",
  codCharge: 0,
  couponDiscount: 0,
  promotionDiscount: 0,
  shippingTotal: 0,
  items: [{
    productId: "FZ-1",
    productName: "Pearl Drop Earrings",
    name: "Pearl Drop Earrings",
    quantity: 1,
    price: "₹1,499",
    regularPrice: 1499,
  }],
};

test("mobile pending order route requires customer auth and shared saver", () => {
  const route = readFileSync(join(root, "app", "api", "orders", "mobile", "pending", "route.ts"), "utf8");
  const shared = readFileSync(join(root, "lib", "checkout-http.ts"), "utf8");
  assert.match(route, /createPendingCheckout\(request, false\)/);
  assert.match(shared, /getCustomerSession\(request\)/);
  assert.match(shared, /idempotency-key/);
  assert.match(shared, /await saveMobilePendingOrder/);
  assert.match(shared, /Please sign in before placing an order/);
});

test("mobile pending order saver stores a sanitized pending order", async () => {
  const api = loadPaymentSync({ orders: [] });
  const saved = await api.saveMobilePendingOrder(pendingOrder, identity, { requestKey: "fixture-checkout" });

  assert.equal(saved.id, "#FZ-MOBILE1");
  assert.equal(saved.userId, "phone:919876543210");
  assert.equal(api.writes.length, 1);
  assert.equal(api.writes[0].p_action, "save");
  const savedOrder = api.writes[0].p_data.order;
  assert.equal(savedOrder.paymentStatus, "pending");
  assert.equal(savedOrder.items[0].productId, "FZ-1");
});

test("mobile pending order saver rejects another customer's order", async () => {
  const api = loadPaymentSync({ orders: [] });
  await assert.rejects(
    () => api.saveMobilePendingOrder({ ...pendingOrder, userId: "phone:910000000000", userPhone: "+910000000000" }, identity, { requestKey: "fixture-checkout" }),
    /does not belong/,
  );
});

test("mobile pending order saver does not replace confirmed orders", async () => {
  const api = loadPaymentSync({ orders: [{ ...pendingOrder, paymentStatus: "cod_pending" }] });
  await assert.rejects(
    () => api.saveMobilePendingOrder(pendingOrder, identity, { requestKey: "fixture-checkout" }),
    /already been confirmed/,
  );
});

test("repeated captured callbacks keep one order and do not repeat inventory mutation", async () => {
  const saved = { ...pendingOrder, fulfillmentMethod: "pickup", paymentMethod: "online", paymentStatus: "paid", inventoryAdjusted: true, razorpayOrderId: "order_fixture", razorpayPaymentId: "pay_fixture" };
  const state = { orders: [saved] };
  const api = loadPaymentSync(state);
  const payment = { id: "pay_fixture", order_id: "order_fixture", status: "captured", captured: true, amount: 149900, currency: "INR" };
  await api.finalizeRazorpayPayment(payment);
  await api.finalizeRazorpayPayment(payment);
  assert.equal(state.orders.length, 1);
  assert.equal(state.orders[0].inventoryAdjusted, true);
});

test("captured callback with no saved order cannot manufacture an order", async () => {
  const api = loadPaymentSync({ orders: [] });
  await assert.rejects(() => api.finalizeRazorpayPayment({ id: "pay_fixture", order_id: "order_fixture", status: "captured", captured: true, amount: 149900, currency: "INR" }), /Saved order could not be found/);
  assert.equal(api.writes.length, 0);
});
