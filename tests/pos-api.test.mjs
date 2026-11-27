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

test("local-only POS preview uses selected option stock even when catalogue quantities are stored as text", () => {
  const client = load("lib/pos-sale-client.ts", {
    imports: {
      "./browser-storage": { browserLocalStorage: {}, prepareBrowserStorage: async () => {}, flushBrowserStorage: async () => true },
      "./site-api-client": { adminApiFetch: async () => { throw Error("Local preview must not call the admin API"); } },
    },
    env: { NEXT_PUBLIC_LOCAL_POS_ONLY: "true" },
  });
  const order = {
    id: "#FZ-POS-LOCAL-PREVIEW", date: "2026-11-23", total: "₹418", customerName: "Walk-in customer", posPaymentMethod: "External UPI",
    items: [
      { productId: "FZ-GOLD-474", variantName: "Option 1", quantity: 1, price: "₹349" },
      { productId: "FZ-CRYS-237", variantName: "Option 1", quantity: 1, price: "₹69" },
    ],
  };
  const result = client.commitLocalPosSale(order, [
    { sku: "FZ-GOLD-474", stock: 0, status: "Published", variants: [{ name: "", image: "", stock: "1" }], sizeStock: {} },
    { sku: "FZ-CRYS-237", stock: 0, status: "Published", variants: [{ name: "Option 1", image: "", stock: "3" }], sizeStock: {} },
  ], []);
  assert.equal(result.order.id, order.id);
  assert.equal(result.orders.length, 1);
  assert.equal(result.products.find(product => product.sku === "FZ-GOLD-474").variants[0].stock, 0);
  assert.equal(result.products.find(product => product.sku === "FZ-CRYS-237").variants[0].stock, 2);
});

test("local-only catalogue reload reapplies saved preview order stock once", () => {
  const orders = [{
    id: "#FZ-POS-2C99AF", createdAt: "2026-11-27T05:41:00.000Z", localPreview: true, inventoryAdjusted: true,
    items: [
      { productId: "FZ-GOLD-474", variantName: "Option 1", quantity: 1 },
      { productId: "FZ-CRYS-237", variantName: "Option 1", quantity: 1 },
    ],
  }];
  const client = load("lib/pos-sale-client.ts", {
    imports: {
      "./browser-storage": {
        browserLocalStorage: { getItem: key => key === "fanzzy-orders" ? JSON.stringify(orders) : null },
        prepareBrowserStorage: async () => {}, flushBrowserStorage: async () => true,
      },
      "./site-api-client": { adminApiFetch: async () => { throw Error("Local preview must not call the admin API"); } },
    },
    env: { NEXT_PUBLIC_LOCAL_POS_ONLY: "true" },
  });
  const baseCatalog = [
    { sku: "FZ-GOLD-474", stock: 1, status: "Low stock", variants: [{ name: "", image: "", stock: 1 }], sizeStock: {} },
    { sku: "FZ-CRYS-237", stock: 3, status: "Low stock", variants: [{ name: "Option 1", image: "", stock: 3 }], sizeStock: {} },
  ];
  const adjusted = client.applyLocalPreviewInventory(baseCatalog);
  assert.equal(adjusted.find(product => product.sku === "FZ-GOLD-474").stock, 0);
  assert.equal(adjusted.find(product => product.sku === "FZ-GOLD-474").variants[0].stock, 0);
  assert.equal(adjusted.find(product => product.sku === "FZ-CRYS-237").stock, 2);
  assert.equal(adjusted.find(product => product.sku === "FZ-CRYS-237").variants[0].stock, 2);
  assert.deepEqual(client.applyLocalPreviewInventory(baseCatalog), adjusted, "a refresh must not double-deduct a saved local sale");
});

test("local preview repairs the old full-UUID POS identifier without touching other orders", () => {
  const client = load("lib/pos-sale-client.ts", {
    imports: {
      "./browser-storage": { browserLocalStorage: {}, prepareBrowserStorage: async () => {}, flushBrowserStorage: async () => true },
      "./site-api-client": { adminApiFetch: async () => { throw Error("Unexpected admin API call"); } },
    },
  });
  const longToken = "EA5414ADF1484965B7620B4C432C99AF";
  const orders = [
    { id: `#FZ-POS-${longToken}`, invoiceNumber: `POS-${longToken}`, posPaymentMethod: "External UPI" },
    { id: "#FZ-KEEP", posPaymentMethod: "Card" },
  ];
  const migrated = client.migrateLocalPreviewOrderIds(orders);
  assert.equal(migrated[0].id, "#FZ-POS-2C99AF");
  assert.equal(migrated[0].invoiceNumber, "POS-2C99AF");
  assert.equal(migrated[0].localPreview, true);
  assert.equal(migrated[1], orders[1]);
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
