import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(file, { imports = {}, env = {}, fetch: fakeFetch = () => { throw Error("Unexpected network request"); } } = {}) {
  const code = ts.transpileModule(readFileSync(new URL("../" + file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("exports", "require", "process", "fetch", code)(exports, name => {
    if (name in imports) return imports[name]; throw Error("Unmocked import " + name);
  }, { env }, fakeFetch);
  return exports;
}
const sale = { id: "#FZ-POS-LOCAL001", items: [{ productId: "RING", quantity: 2, price: "₹55" }], total: "₹110" };
const post = body => new Request("https://local.invalid/admin/pos-sales", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("POS endpoint rejects unauthorized callers and missing privileged configuration before any write", async () => {
  for (const authorized of [false, true]) {
    const route = load("app/api/admin/pos-sales/route.ts", { imports: { "../../../../lib/admin-auth": { isAdminSessionValid: () => authorized } } });
    assert.equal((await route.POST(post({ order: sale }))).status, authorized ? 503 : 401);
  }
});

test("POS endpoint makes one privileged RPC and preserves errors without a legacy fallback", async () => {
  for (const error of [null, { code: "P0001", message: "Not enough stock" }, { code: "PGRST202", message: "migration missing" }]) {
    const calls = [];
    const route = load("app/api/admin/pos-sales/route.ts", {
      imports: { "../../../../lib/admin-auth": { isAdminSessionValid: () => true } },
      env: { SUPABASE_URL: "https://db.invalid", SUPABASE_SERVICE_ROLE_KEY: "LOCAL_TEST_ROLE" },
      fetch: async (url, init) => {
        calls.push({ url, init });
        return Response.json(error || { order: sale, orders: [sale], products: [] }, { status: error ? 400 : 200 });
      },
    });
    const response = await route.POST(post({ order: sale }));
    assert.equal(response.status, error ? error.code === "P0001" ? 409 : 502 : 200);
    assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://db.invalid/rest/v1/rpc/commit_pos_sale");
    assert.deepEqual(JSON.parse(calls[0].init.body), { p_order: sale });
    assert.equal(calls[0].init.headers.authorization, "Bearer LOCAL_TEST_ROLE");
    assert.equal(JSON.stringify(await response.json()).includes("LOCAL_TEST_ROLE"), false);
  }
});

test("POS UPI finalizer rejects uncaptured, wrong-method and unconfigured requests before writing", async () => {
  const server = load("lib/pos-sale-server.ts");
  const payment = { id: "pay_LOCAL", order_id: "order_LOCAL", amount: 11000, status: "captured", method: "upi" };
  for (const extra of [{ status: "authorized" }, { method: "card" }, { amount: 1.5 }, { id: "" }]) {
    await assert.rejects(server.finalizeAtomicPosPayment({ ...payment, ...extra }, { supabaseUrl: "https://db.invalid", serviceRoleKey: "LOCAL" }), /captured UPI/);
  }
  await assert.rejects(server.finalizeAtomicPosPayment(payment, { supabaseUrl: "https://db.invalid", serviceRoleKey: "" }), /not configured/);
});

test("worker verifies Razorpay proof then uses only the atomic RPC for POS inventory", async () => {
  const calls = [], pending = { ...sale, razorpayOrderId: "order_LOCAL", posPaymentMethod: "UPI", paymentStatus: "pending" };
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.startsWith("https://api.razorpay.com/")) return Response.json({ id: "pay_LOCAL", order_id: "order_LOCAL", status: "captured", method: "upi", amount: 11000 });
    if (url.includes("store_settings?")) return Response.json([{ value: JSON.stringify([pending]) }]);
    if (url.endsWith("/rpc/finalize_pos_payment")) return Response.json({ order: { ...pending, paymentStatus: "paid", inventoryAdjusted: true } });
    throw Error("Forbidden legacy write " + url);
  };
  const server = load("lib/pos-sale-server.ts", { fetch });
  const worker = load("worker/razorpay-api.ts", { fetch, imports: {
    "../lib/pos-sale-server": server,
    "../lib/inventory-adjustment": { adjustOrderInventory: () => { throw Error("Must not write legacy POS stock"); } },
  } }).default;
  const env = { RAZORPAY_KEY_ID: "LOCAL", RAZORPAY_KEY_SECRET: "LOCAL_SECRET", SUPABASE_URL: "https://db.invalid", SUPABASE_SERVICE_ROLE_KEY: "LOCAL_ROLE" };
  const signature = createHmac("sha256", env.RAZORPAY_KEY_SECRET).update("order_LOCAL|pay_LOCAL").digest("hex");
  const request = new Request("https://local.invalid/verify", { method: "POST", body: JSON.stringify({ razorpayOrderId: "order_LOCAL", razorpayPaymentId: "pay_LOCAL", razorpaySignature: signature }) });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 200); assert.equal((await response.json()).inventoryAdjusted, true);
  const rpc = calls.filter(call => call.url.endsWith("/rpc/finalize_pos_payment"));
  assert.equal(rpc.length, 1);
  assert.deepEqual(JSON.parse(rpc[0].init.body), { p_razorpay_order_id: "order_LOCAL", p_payment_id: "pay_LOCAL", p_amount: 11000 });
  assert.equal(calls.filter(call => call.init.method === "PATCH").length, 0);
});
