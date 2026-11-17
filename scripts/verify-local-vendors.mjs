import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadSanitizedEnv } from "./dev-test.mjs";
const { env, errors } = loadSanitizedEnv(resolve(".env.local.test"));
if (errors.length || !env.NEXT_PUBLIC_SUPABASE_URL.startsWith("http://127.0.0.1:")) throw Error("Local database required");
const origin = new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin;
const suffix = randomBytes(5).toString("hex"), email = `qa-${suffix}@fanzzy.test`, password = randomBytes(16).toString("hex");
const { default: pg } = await import(pathToFileURL(resolve("../../../payment-audit-2026-10-19/db-test/node_modules/pg/lib/index.js")));
const pool = new pg.Pool({ host: "127.0.0.1", port: 55432, user: "postgres", database: "postgres" });
let vendorId;
const call = async (path, options = {}) => {
  const response = await fetch(origin + path, options), raw = await response.text();
  assert.ok(raw, `${path}: empty response (${response.status})`);
  const body = JSON.parse(raw);
  assert.ok(response.ok, `${path}: ${response.status} ${body.error || body.message || ""}`);
  return { response, body };
};
try {
  const login = await call("/api/admin-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: env.ADMIN_LOGIN_EMAIL, password: env.ADMIN_LOGIN_PASSWORD }) });
  const cookie = login.response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  for (const path of ["/api/admin/vendors", "/api/admin/vendor-commissions", "/api/admin/vendor-payouts", "/api/admin/vendor-reports"]) await call(path, { headers: { cookie } });
  const created = await call("/api/admin/vendors", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ businessName: `QA Vendor ${suffix}`, ownerName: "Local QA", loginEmail: email, initialPassword: password, storeVisibility: "Hidden" }) });
  vendorId = created.body.vendor.id;
  const signedIn = await call("/api/vendor-auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const authorization = `Bearer ${signedIn.body.sessionToken}`;
  for (const path of ["/api/vendor-auth/session", "/api/vendor/dashboard", "/api/vendor/products", "/api/vendor/orders", "/api/vendor/payouts"]) await call(path, { headers: { authorization } });
  const publicVendors = await call("/api/vendors");
  assert.ok(!JSON.stringify(publicVendors.body).includes(email));
  const denied = await fetch(origin + "/local-db/rest/v1/vendor_users?select=*", { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } });
  assert.equal(denied.status, 403);
  console.log("PASS: admin vendor, commission, payout and report APIs; disposable vendor creation/login/session/dashboard/products/orders/payouts; private credential protection");
} finally {
  // Remove only this run's own disposable vendor, including partial creation.
  const ids = (await pool.query("select id from vendors where login_email=$1", [email])).rows.map((row) => row.id);
  for (const id of ids) {
    await pool.query("delete from vendor_audit_logs where vendor_id=$1", [id]);
    await pool.query("delete from vendors where id=$1", [id]);
  }
  await pool.end();
}
