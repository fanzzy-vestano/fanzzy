import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { loadSanitizedEnv } from "./dev-test.mjs";
import { newSalesPromotion } from "../lib/sales-promotions.ts";
const { env, errors } = loadSanitizedEnv(resolve(".env.local.test"));
if (errors.length || !env.NEXT_PUBLIC_SUPABASE_URL.startsWith("http://127.0.0.1:")) throw new Error("Verification requires the local test database.");
const origin = new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin;
const token = randomBytes(4).toString("hex").toUpperCase(), sku = `LOCAL-CHECK-${token}`, id = `#FZ-LOCALCHECK-${token}`;
const category = `Local QA ${token}`;
const promotion = { ...newSalesPromotion("category"), name: "Local connection verification", value: 25, categoryNames: [category] };
const runtime = resolve("../../../payment-audit-2026-10-19/db-test/node_modules");
const { default: pg } = await import(pathToFileURL(join(runtime, "pg/lib/index.js")));
const pool = new pg.Pool({ host: "127.0.0.1", port: 55432, user: "postgres", database: "postgres", password: "", ssl: false });
const request = async (path, options = {}) => {
  const response = await fetch(origin + path, options);
  const body = await response.json();
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${body.error || body.message || ""}`);
  return { response, body };
};
try {
  for (const path of ["/", "/admin", "/collections", "/track-order", "/vendor/login", "/vendors", "/vendors/store"]) {
    const page = await fetch(origin + path);
    assert.equal(page.status, 200, `${path} loads`);
    assert.match(await page.text(), /<!doctype html>/i);
  }
  assert.equal((await fetch(origin + "/api/admin/orders")).status, 401);
  assert.equal((await fetch(origin + "/api/orders/pending", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
  const login = await request("/api/admin-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: env.ADMIN_LOGIN_EMAIL || "local-admin@fanzzy.test", password: env.ADMIN_LOGIN_PASSWORD || "local-admin-password" }) });
  const cookie = login.response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  assert.equal(login.body.authenticated, true);
  assert.equal((await request("/api/admin-auth", { headers: { cookie } })).body.authenticated, true);
  assert.ok(Array.isArray((await request("/api/admin/orders", { headers: { cookie } })).body.orders));
  const adminHeaders = { cookie, apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`, "content-type": "application/json", prefer: "resolution=merge-duplicates,return=representation" };
  await request("/local-db/rest/v1/products?on_conflict=sku", { method: "POST", headers: adminHeaders, body: JSON.stringify({ sku, name: "Local verification fixture", category, stock: 2, price: 100, status: "Published", image: "/fanzzy-mark.png" }) });
  const previous = await pool.query("select value from store_settings where key='sales_promotions'");
  await request("/local-db/rest/v1/store_settings?on_conflict=key", { method: "POST", headers: adminHeaders, body: JSON.stringify({ key: "sales_promotions", value: JSON.stringify([...JSON.parse(previous.rows[0]?.value || "[]"), promotion]) }) });
  const offers = (await request("/api/offers")).body;
  assert.ok(offers.promotions.some((item) => item.id === promotion.id));
  const sent = await request("/api/customer-auth/send-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "9000000001" }) });
  const verified = await request("/api/customer-auth/verify-otp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${sent.body.pendingToken}` }, body: JSON.stringify({ code: env.LOCAL_TEST_OTP_CODE }) });
  const customerHeaders = { "content-type": "application/json", authorization: `Bearer ${verified.body.sessionToken}` };
  const order = { id, userId: verified.body.user.id, userPhone: verified.body.user.phone, phone: verified.body.user.phone, customerName: "Local verification", status: "Processing", paymentStatus: "pending", paymentMethod: "cod", fulfillmentMethod: "delivery", address: "Local test address, Chennai 600001", total: "₹105", couponDiscount: 0, promotionDiscount: 25, shippingTotal: 30, codCharge: 0, items: [{ productId: sku, productName: "Local verification fixture", name: "Local verification fixture", quantity: 1, price: "₹100" }] };
  const tampered = await fetch(origin + "/api/orders/pending", { method: "POST", headers: { ...customerHeaders, "idempotency-key": `${id}-BAD` }, body: JSON.stringify({ order: { ...order, total: "₹1" } }) });
  assert.equal(tampered.status, 409, "Tampered checkout total is rejected");
  await request("/api/orders/pending", { method: "POST", headers: { ...customerHeaders, "idempotency-key": id }, body: JSON.stringify({ order }) });
  const confirmed = await request("/api/orders/confirm-cod", { method: "POST", headers: customerHeaders, body: JSON.stringify({ fanzzyOrderId: id }) });
  assert.equal(confirmed.body.order.paymentStatus, "cod_pending");
  assert.equal(confirmed.body.order.promotionDiscount, 25);
  const repeated = await request("/api/orders/confirm-cod", { method: "POST", headers: customerHeaders, body: JSON.stringify({ fanzzyOrderId: id }) });
  assert.equal(repeated.body.order.id, id);
  assert.ok((await request("/api/admin/orders", { headers: { cookie } })).body.orders.some((order) => order.id === id));
  assert.equal(Number((await pool.query("select stock from products where sku=$1", [sku])).rows[0].stock), 1);
  console.log("PASS: seven page routes, unauthorized access guards, admin login/session, protected catalog/category-offer saves, customer OTP, tampered-total rejection, online category discount, repeat-safe COD checkout, admin order visibility and single stock reservation");
} finally {
  const client = await pool.connect();
  try {
    await client.query("begin; select set_config('fanzzy.checkout_rpc','on',true)");
    await client.query("update store_settings set value=(select coalesce(jsonb_agg(item),'[]'::jsonb)::text from jsonb_array_elements(value::jsonb) item where item->>'id'<>$1) where key='sales_promotions'", [promotion.id]);
    await client.query("update store_settings set value=(select coalesce(jsonb_agg(item),'[]'::jsonb)::text from jsonb_array_elements(value::jsonb) item where item->>'id'<>$1) where key='orders'", [id]);
    for (const table of ["checkout_requests", "reservations", "promotion_redemptions", "checkout_outbox"]) await client.query(`delete from fanzzy_private.${table} where order_id=$1`, [id]);
    await client.query("delete from products where sku=$1", [sku]);
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); await pool.end(); }
}
