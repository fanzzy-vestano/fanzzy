import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

function load(path, imports = {}, extras = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const exports = {};
  const sandbox = {
    exports, module: { exports }, Buffer, Request, Response, URL, AbortSignal,
    process: { env: { FANZZY_ENV: "local-test", RAZORPAY_KEY_ID: "rzp_test_fixture", RAZORPAY_KEY_SECRET: "isolated-fixture" } },
    fetch: async () => { throw new Error("Unmocked network access is forbidden"); },
    require: (name) => { if (!(name in imports)) throw new Error(`Unmocked import: ${name}`); return imports[name]; },
    ...extras,
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, sandbox);
  return sandbox.module.exports;
}
const policy = load("lib/payment-policy.ts");
const order = { total: "₹1,499", razorpayOrderId: "order_fixture", paymentMethod: "online" };
const captured = { id: "pay_fixture", order_id: "order_fixture", amount: 149900, currency: "INR", status: "captured", captured: true };

test("live checkout stays disabled until approval and complete production configuration", () => {
  assert.match(policy.paymentConfigurationError({ RAZORPAY_KEY_ID: "rzp_live_fixture", RAZORPAY_KEY_SECRET: "fixture" }), /approval/);
  assert.match(policy.paymentConfigurationError({ FANZZY_LIVE_PAYMENTS_ENABLED: "true", RAZORPAY_KEY_ID: "rzp_test_fixture", RAZORPAY_KEY_SECRET: "fixture" }), /Live Mode/);
  assert.match(policy.paymentConfigurationError({ FANZZY_ENV: "local-test", RAZORPAY_KEY_ID: "rzp_live_fixture", RAZORPAY_KEY_SECRET: "fixture" }), /Test Mode/);
});
test("captured INR payment must match saved amount, provider order and payment attempt", () => {
  assert.doesNotThrow(() => policy.assertCapturedPayment(captured, order));
  for (const change of [{ status: "authorized", captured: false }, { status: "failed" }, { currency: "USD" }, { amount: 100 }, { order_id: "order_other" }]) {
    assert.throws(() => policy.assertCapturedPayment({ ...captured, ...change }, order));
  }
  assert.throws(() => policy.assertCapturedPayment(captured, { ...order, razorpayPaymentId: "pay_other" }));
  assert.throws(() => policy.assertCapturedPayment(captured, { ...order, paymentMethod: "cod" }));
  assert.throws(() => policy.assertCapturedPayment(captured, { total: "₹1,499" }));
});

test("payment verify rejects forged signatures before provider or storage access", async () => {
  const route = load("app/api/razorpay/verify/route.ts", {
    "node:crypto": { createHmac, timingSafeEqual },
    "../../../../lib/payment-policy": policy,
    "../../../../lib/razorpay-payment-sync": { finalizeRazorpayPayment: async () => { throw new Error("Must not write"); } },
  });
  const response = await route.POST(new Request("https://isolated.invalid/verify", { method: "POST", body: JSON.stringify({ razorpayOrderId: captured.order_id, razorpayPaymentId: captured.id, razorpaySignature: "0".repeat(64) }) }));
  assert.equal(response.status, 400);
});

test("order creation uses the owned saved total and persists provider binding before returning", async () => {
  const calls = [];
  let binding;
  class CheckoutError extends Error { constructor(message, status = 409) { super(message); this.status = status; } }
  const transactions = { CheckoutError, claimPaymentAttempt: async () => ({ claimed: true, attempt: { token: "attempt_fixture", receipt: "FZ-FIXTURE", amount: 149900 } }), bindPaymentAttempt: async (...args) => { binding = args; }, markPaymentAttempt: async () => {} };
  const provider = load("lib/razorpay-provider.ts", { "./transactional-checkout": transactions }, { fetch: async (url, init) => { calls.push({ url, init }); return Response.json({ id: "order_fixture", amount: 149900, currency: "INR", receipt: "FZ-FIXTURE" }); } });
  const route = load("app/api/razorpay/order/route.ts", {
    "../../../../lib/razorpay-provider": provider,
    "../../../../lib/transactional-checkout": transactions,
    "../../../../lib/runtime-safety": { assertLocalTestServerSafety: () => {} },
    "../../../../lib/payment-policy": policy,
    "../../../../lib/customer-sms-auth": { getCustomerSession: () => ({ id: "customer_fixture", phone: "+919999999999" }) },
    "../../../../lib/razorpay-payment-sync": {
      pendingPaymentOrder: async () => ({ ...order, id: "#FZ-FIXTURE", razorpayOrderId: undefined }),
      bindRazorpayOrder: async (...args) => { binding = args; },
    },
  }, { fetch: async (url, init) => { calls.push({ url, init }); return Response.json({ id: "order_fixture", amount: 149900, currency: "INR" }); } });
  const response = await route.POST(new Request("https://isolated.invalid/order", { method: "POST", body: JSON.stringify({ fanzzyOrderId: "#FZ-FIXTURE" }) }));
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(calls[0].init.body).amount, 149900);
  assert.deepEqual(binding, ["#FZ-FIXTURE", "attempt_fixture", "order_fixture"]);
});

test("order creation rejects tampered totals before contacting Razorpay", async () => {
  class CheckoutError extends Error { constructor(message, status = 409) { super(message); this.status = status; } }
  const transactions = { CheckoutError, checkoutRpc: async () => [{ ...order, id: "#FZ-FIXTURE", userId: "customer_fixture" }] };
  const provider = load("lib/razorpay-provider.ts", { "./transactional-checkout": transactions });
  const route = load("app/api/razorpay/order/route.ts", {
    "../../../../lib/razorpay-provider": provider,
    "../../../../lib/transactional-checkout": transactions,
    "../../../../lib/runtime-safety": { assertLocalTestServerSafety: () => {} },
    "../../../../lib/payment-policy": policy,
    "../../../../lib/customer-sms-auth": { getCustomerSession: () => ({ id: "customer_fixture", phone: "+919999999999" }) },
    "../../../../lib/razorpay-payment-sync": { pendingPaymentOrder: async () => ({ ...order, id: "#FZ-FIXTURE" }) },
  });
  const response = await route.POST(new Request("https://isolated.invalid/order", { method: "POST", body: JSON.stringify({ amount: 100, fanzzyOrderId: "#FZ-FIXTURE" }) }));
  assert.equal(response.status, 409);
});
test("valid signature still requires captured payment and saved order", async () => {
  let finalizations = 0;
  const signature = createHmac("sha256", "isolated-fixture").update(`${captured.order_id}|${captured.id}`).digest("hex");
  for (const payment of [{ ...captured, status: "authorized", captured: false }, captured]) {
    const route = load("app/api/razorpay/verify/route.ts", {
      "node:crypto": { createHmac, timingSafeEqual },
      "../../../../lib/payment-policy": policy,
      "../../../../lib/razorpay-payment-sync": { finalizeRazorpayPayment: async (p) => { policy.assertCapturedPayment(p, order); finalizations++; return { inventoryAdjusted: true }; } },
    }, { fetch: async () => Response.json(payment) });
    const response = await route.POST(new Request("https://isolated.invalid/verify", { method: "POST", body: JSON.stringify({ razorpayOrderId: captured.order_id, razorpayPaymentId: captured.id, razorpaySignature: signature }) }));
    assert.equal(response.status, payment.status === "captured" ? 200 : 502);
  }
  assert.equal(finalizations, 1);
});
test("webhook requires its own secret and rejects forged raw-body signature", async () => {
  const route = load("app/api/razorpay/webhook/route.ts", {
    "node:crypto": { createHmac, timingSafeEqual, createHash },
    "../../../../lib/transactional-checkout": {},
    "../../../../lib/razorpay-payment-sync": { finalizeRazorpayPayment: async () => { throw new Error("Must not write"); } },
  });
  assert.equal((await route.POST(new Request("https://isolated.invalid/webhook", { method: "POST", body: "{}" }))).status, 503);
});

const quote = load("lib/mobile-checkout-authority.ts", { "./catalog/public-catalog-mapper": {}, "./website-checkout-pricing": {}, "./sales-promotions": {} });
const product = { sku: "SKU-1", price: 100, stock: 5, variantType: "normal", variants: [], sizes: [], sizeStock: {} };
const settings = [
  { key: "payment_methods", value: JSON.stringify({ online: true, cod: true, codCharge: 20 }) },
  { key: "delivery_charge", value: JSON.stringify({ enabled: true, amount: 50, freeAboveEnabled: true, freeAbove: 500 }) },
];
const cart = { fulfillmentMethod: "delivery", paymentMethod: "online", total: "₹250", shippingTotal: 50, codCharge: 0, items: [{ productId: "SKU-1", quantity: 2, price: "₹100" }] };
test("server quote validates current price, charges and payment settings", () => {
  assert.doesNotThrow(() => quote.validateMobileQuote(cart, [product], settings));
  for (const invalid of [{ ...cart, total: "₹1" }, { ...cart, shippingTotal: 0 }, { ...cart, couponDiscount: 100 }, { ...cart, items: [{ productId: "SKU-1", quantity: 2, price: "₹1" }] }]) assert.throws(() => quote.validateMobileQuote(invalid, [product], settings));
  assert.throws(() => quote.validateMobileQuote(cart, [product], []));
  assert.throws(() => quote.validateMobileQuote(cart, [], settings));
});
test("server quote rejects invented variants and aggregates duplicate line stock", () => {
  assert.throws(() => quote.validateMobileQuote({ ...cart, items: [{ ...cart.items[0], variantName: "invented" }] }, [product], settings));
  assert.throws(() => quote.validateMobileQuote({ ...cart, items: [cart.items[0], { ...cart.items[0], quantity: 4 }] }, [product], settings), /stock/);
  const sizeProduct = { ...product, variantType: "size", sizes: ["M"], sizeStock: { M: 1 } };
  assert.throws(() => quote.validateMobileQuote({ ...cart, items: [{ ...cart.items[0], size: "M" }] }, [sizeProduct], settings), /stock/);
});
