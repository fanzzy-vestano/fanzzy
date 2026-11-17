import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import { resolve } from "node:path";

const TEST_PROJECT_REF = "xxibqydsluzgezqiyyyx";
const PRODUCTION_PROJECT_REF = "pdrcrkxeyqxqgpwfxqpu";
const envFile = resolve(".env.local.test");
if (!existsSync(envFile)) throw new Error("Missing .env.local.test.");
process.loadEnvFile(envFile);

const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (process.env.FANZZY_ENV !== "local-test") throw new Error("Seed blocked: FANZZY_ENV must be local-test.");
if (projectRef === PRODUCTION_PROJECT_REF) throw new Error("Seed blocked: production Supabase is forbidden.");
if (projectRef !== TEST_PROJECT_REF) throw new Error(`Seed blocked: expected ${TEST_PROJECT_REF}, received ${projectRef || "none"}.`);
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Seed blocked: the test service-role key is missing.");
if (!String(process.env.RAZORPAY_KEY_ID || "").startsWith("rzp_test_")) throw new Error("Seed blocked: Razorpay must remain in Test Mode.");
if (process.env.DELHIVERY_MODE !== "mock") throw new Error("Seed blocked: Delhivery must remain in mock mode.");

const headers = {
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  "content-type": "application/json",
};

const rest = async (table, query = "", init = {}) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}${query ? `?${query}` : ""}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`${table} fixture request failed (${response.status}): ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
};

const readSetting = async (key, fallback) => {
  const rows = await rest("store_settings", `key=eq.${encodeURIComponent(key)}&select=value`);
  try { return rows?.[0]?.value ? JSON.parse(rows[0].value) : fallback; } catch { return fallback; }
};

const writeSetting = (key, value) => rest("store_settings", "on_conflict=key", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify([{ key, value: JSON.stringify(value), updated_at: new Date().toISOString() }]),
});

const mergeSettingMap = async (key, values) => {
  const current = await readSetting(key, {});
  await writeSetting(key, { ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}), ...values });
};

const scrypt = promisify(nodeScrypt);
const passwordDigest = async (password) => {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString("base64url")}`;
};

const vendorEmail = "test.vendor@fanzzy.test";
const vendorPassword = "TestVendor123!";
let vendors = await rest("vendors", `login_email=eq.${encodeURIComponent(vendorEmail)}&select=id,business_name,slug`);
if (!vendors.length) {
  vendors = await rest("vendors", "", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      slug: "test-vendor-local",
      business_name: "TEST Vendor",
      owner_name: "TEST Owner",
      login_email: vendorEmail,
      phone: "+919999900002",
      whatsapp: "+919999900002",
      description: "LOCAL TEST FIXTURE - NOT A REAL VENDOR",
      address: "TEST Vendor Address",
      city: "TEST City",
      state: "Kerala",
      pin_code: "671209",
      gst_number: "TESTGST000000",
      pan_number: "TESTPAN0000",
      status: "Active",
      store_visibility: "Visible",
      featured: false,
      commission_mode: "percentage",
      commission_rate: 10,
      automatic_approval: true,
    }]),
  });
}
const vendor = vendors[0];
if (!vendor?.id) throw new Error("Test vendor could not be created.");

const existingVendorUsers = await rest("vendor_users", `vendor_id=eq.${encodeURIComponent(vendor.id)}&select=id`);
let vendorUserId = existingVendorUsers[0]?.id;
if (!vendorUserId) {
  const rows = await rest("vendor_users", "", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{ vendor_id: vendor.id, email: vendorEmail, password_hash: await passwordDigest(vendorPassword) }]),
  });
  vendorUserId = rows[0]?.id;
}

await rest("vendor_bank_accounts", "on_conflict=vendor_id", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify([{ vendor_id: vendor.id, account_holder_name: "TEST Vendor", account_number: "", bank_name: "TEST Bank", branch_name: "TEST Branch", ifsc_code: "TEST0000001", upi_id: "test.vendor@example.invalid" }]),
});

const products = [
  { sku: "TEST-NECKLACE-BASE", name: "TEST Necklace", category: "Necklaces", stock: 10, price: 100, cost: 50 },
  { sku: "TEST-RING-VARIANT", name: "TEST Ring", category: "Rings", stock: 12, price: 200, cost: 100 },
  { sku: "TEST-BRACELET-SIZE", name: "TEST Bracelet", category: "Bracelets", stock: 15, price: 300, cost: 150 },
];
await rest("products", "on_conflict=sku", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  body: JSON.stringify(products.map((product) => ({
    ...product,
    status: "Published",
    image: "",
    hover_image: "",
    tag: "LOCAL TEST",
    tone: "#cccccc",
    vendor_id: vendor.id,
    vendor_status: "Approved",
    vendor_rejection_reason: null,
    public_vendor_visible: true,
    low_stock_limit: 2,
    updated_at: new Date().toISOString(),
  }))),
});

await mergeSettingMap("product_variant_type", {
  "TEST-NECKLACE-BASE": "normal",
  "TEST-RING-VARIANT": "normal",
  "TEST-BRACELET-SIZE": "size",
});
await mergeSettingMap("product_variants", {
  "TEST-NECKLACE-BASE": [],
  "TEST-RING-VARIANT": [{ name: "Gold", image: "", stock: 6 }, { name: "Silver", image: "", stock: 6 }],
  "TEST-BRACELET-SIZE": [{ name: "S", size: "S", image: "", stock: 5 }, { name: "M", size: "M", image: "", stock: 5 }, { name: "L", size: "L", image: "", stock: 5 }],
});
await mergeSettingMap("product_sizes", { "TEST-BRACELET-SIZE": ["S", "M", "L"] });
await mergeSettingMap("product_size_stock", { "TEST-BRACELET-SIZE": { S: 5, M: 5, L: 5 } });
await mergeSettingMap("product_hsn_codes", { "TEST-NECKLACE-BASE": "7117", "TEST-RING-VARIANT": "7117", "TEST-BRACELET-SIZE": "7117" });
await mergeSettingMap("product_bill_names", { "TEST-NECKLACE-BASE": "TEST Necklace", "TEST-RING-VARIANT": "TEST Ring", "TEST-BRACELET-SIZE": "TEST Bracelet" });
await mergeSettingMap("product_descriptions", {
  "TEST-NECKLACE-BASE": "LOCAL TEST base-stock product",
  "TEST-RING-VARIANT": "LOCAL TEST variant product",
  "TEST-BRACELET-SIZE": "LOCAL TEST size-based product",
});
await mergeSettingMap("product_weights_grams", { "TEST-NECKLACE-BASE": 500, "TEST-RING-VARIANT": 750, "TEST-BRACELET-SIZE": 1000 });

const customer = {
  id: "customer-local-test-001",
  name: "TEST Customer",
  phone: "+919999900001",
  email: "test.customer@example.invalid",
  address: "TEST Customer Address, Landmark: TEST Landmark, 671209",
  orders: 0,
  totalSpent: "₹0",
  lastOrder: "No orders yet",
  joined: "Local test fixture",
};
const customers = await readSetting("customers", []);
const nextCustomers = [customer, ...(Array.isArray(customers) ? customers.filter((item) => item?.id !== customer.id) : [])];
await writeSetting("customers", nextCustomers);

const [savedProducts, vendorOrders, ordersSetting] = await Promise.all([
  rest("products", `sku=in.(${products.map((product) => product.sku).join(",")})&select=sku,name,stock,price,vendor_id&order=sku.asc`),
  rest("vendor_orders", `vendor_id=eq.${encodeURIComponent(vendor.id)}&select=id`),
  rest("store_settings", "key=eq.orders&select=value"),
]);
const orders = (() => { try { return JSON.parse(ordersSetting?.[0]?.value || "[]"); } catch { return []; } })();

console.log(JSON.stringify({
  target: { projectRef, projectName: "Fanzzy Local Test" },
  vendor: { id: vendor.id, name: "TEST Vendor", vendorUserId, email: vendorEmail },
  products: savedProducts.map((product) => ({ ...product, weightGrams: { "TEST-NECKLACE-BASE": 500, "TEST-RING-VARIANT": 750, "TEST-BRACELET-SIZE": 1000 }[product.sku] })),
  customer: { ...customer, authUserId: "phone:919999900001" },
  forbiddenRecords: { mainOrders: Array.isArray(orders) ? orders.length : 0, vendorOrders: vendorOrders.length, payments: 0, shipments: 0, awbs: 0 },
}, null, 2));
