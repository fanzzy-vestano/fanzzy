import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { loadSanitizedEnv } from "./dev-test.mjs";

const { env, errors } = loadSanitizedEnv(resolve(".env.local.test"));
if (!env || errors.length) throw new Error(errors.join("\n"));
const base = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
if (new URL(base).hostname !== "xxibqydsluzgezqiyyyx.supabase.co" || env.DELHIVERY_MODE !== "mock") {
  throw new Error("QA fixtures require the approved test database and mock Delhivery.");
}
const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
async function rest(table, query, init = {}) {
  const response = await fetch(`${base}/rest/v1/${table}?${query}`, { ...init, headers: { ...headers, ...init.headers } });
  if (!response.ok) throw new Error(`Test database ${table}: HTTP ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function setting(key, value, merge = false) {
  if (merge) {
    const rows = await rest("store_settings", `key=eq.${key}&select=value`);
    const current = rows[0]?.value ? JSON.parse(rows[0].value) : {};
    value = { ...current, ...value };
  }
  await rest("store_settings", "on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([{ key, value: JSON.stringify(value), updated_at: new Date().toISOString() }]) });
}

const image = "https://fanzzy.in/fanzzy-mark.png";
const products = [
  { sku: "QA-NECKLACE", name: "TEST Everyday Necklace", category: "Necklaces", stock: 50, price: 199, cost: 80 },
  { sku: "QA-RING", name: "TEST Gold and Silver Ring", category: "Rings", stock: 40, price: 299, cost: 100 },
  { sku: "QA-BRACELET", name: "TEST Size Bracelet", category: "Bracelets", stock: 30, price: 349, cost: 150 },
  { sku: "QA-LAST-ONE", name: "TEST Last One Earrings", category: "Earrings", stock: 1, price: 99, cost: 40 },
  { sku: "QA-SOLD-OUT", name: "TEST Sold Out Earrings", category: "Earrings", stock: 0, price: 149, cost: 50 },
];
await rest("products", "on_conflict=sku", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(products.map(product => ({ ...product, status: "Published", vendor_id: null, image, hover_image: image, tag: "TEST DATA", tone: "#f4ede5", low_stock_limit: 2, updated_at: new Date().toISOString() }))) });
await rest("categories", "on_conflict=name", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(["Necklaces", "Rings", "Bracelets", "Earrings"].map((name, index) => ({ name, pieces: products.filter(product => product.category === name).length, image, sort_order: index, section: "normal" }))) });
await setting("product_variants", {
  "QA-NECKLACE": [], "QA-LAST-ONE": [], "QA-SOLD-OUT": [],
  "QA-RING": [{ name: "Gold", stock: 20, image }, { name: "Silver", stock: 20, image }],
  "QA-BRACELET": [{ name: "S", size: "S", stock: 10, image }, { name: "M", size: "M", stock: 10, image }, { name: "L", size: "L", stock: 10, image }],
}, true);
await setting("product_variant_type", Object.fromEntries(products.map(product => [product.sku, product.sku === "QA-BRACELET" ? "size" : "normal"])), true);
await setting("product_sizes", { "QA-BRACELET": ["S", "M", "L"] }, true);
await setting("product_size_stock", { "QA-BRACELET": { S: 10, M: 10, L: 10 } }, true);
await setting("product_weights_grams", Object.fromEntries(products.map(product => [product.sku, 500])), true);
await setting("product_hsn_codes", Object.fromEntries(products.map(product => [product.sku, "7117"])), true);
await setting("product_descriptions", Object.fromEntries(products.map(product => [product.sku, "Sample product for manual app testing. Product image is the Fanzzy logo."])), true);
await setting("payment_methods", { online: true, cod: true, provider: "Razorpay", codCharge: 20 });
await setting("delivery_charge", { enabled: true, amount: 40, freeAboveEnabled: true, freeAbove: 500 });
const hubs = await rest("store_settings", "key=eq.pickup_hubs&select=value");
const existingHubs = hubs[0]?.value ? JSON.parse(hubs[0].value) : [];
await setting("pickup_hubs", [{ id: "qa-pickup", name: "TEST Pickup Hub", place: "Test Street, Kanhangad, Kerala 671209" }, ...existingHubs.filter(hub => hub.id !== "qa-pickup")]);

const guide = `FANZZY MANUAL APP TESTING — 17 OCTOBER 2026

Open Fanzzy Orders Test on the Android emulator. This build uses sample products and the separate test database. Your other Fanzzy app is unchanged.
Keep the local API on port 3000 running. Restart with apk/start-test-api.ps1 if needed.

LOGIN
Customer phone: 9999900001 (or a different valid 10-digit test number).
Customer OTP: ${env.LOCAL_TEST_OTP_CODE}. This is a local test code; no SMS is sent.
Use another phone number to check that accounts cannot see each other's orders.
Sample name: TEST Customer; email: test.customer@example.invalid.
Address: 12 Test Street; landmark: Near Test School; pincode: 671209.

PRODUCTS
TEST Everyday Necklace: Rs199, stock 50.
TEST Gold and Silver Ring: Rs299, Gold/Silver stock 20 each.
TEST Size Bracelet: Rs349, S/M/L stock 10 each.
TEST Last One Earrings: Rs99, stock 1.
TEST Sold Out Earrings: Rs149, stock 0.
TEST Vendor products are available under Vendors.
These products intentionally use the Fanzzy logo as their sample image.

PRICING
Delivery Rs40; free delivery at Rs500. COD surcharge Rs20. Pickup delivery fee Rs0.
Example: one Rs199 necklace: online delivery total Rs239; COD delivery total Rs259.

RAZORPAY
The server has authenticated successfully using Razorpay Test Mode keys.
Choose Online payment > Card. Test Visa: 4100 2800 0000 1007.
CVV: 123; expiry: 12/30. Use the mock bank success/failure controls or a 4-10 digit test OTP for success if prompted.
Payment documentation: https://razorpay.com/docs/payments/payments/test-card-details/
Test success, failure, closing checkout, retrying, and pressing Pay twice.
Confirm a cancelled/failed payment does not become a paid order and releases reserved stock.
Test-mode card payments simulate money; the app must show Razorpay Test Mode.
Do not use a real card or an external UPI app for these tests.

DELHIVERY SIMULATION
Admin: http://localhost:3000/admin
Admin login: ${env.ADMIN_LOGIN_EMAIL}
Admin test password: ${env.ADMIN_LOGIN_PASSWORD}
Vendor login: http://localhost:3000/vendor/login
Vendor: test.vendor@fanzzy.test / TestVendor123!
After a delivery order is paid or confirmed COD, open it in Admin > Orders.
Enter packed weight 500 grams, choose LOCAL TEST WAREHOUSE and create the Delhivery shipment.
An AWB beginning TEST- is a simulated shipment. No physical pickup or courier booking is made.
Courier controls: http://localhost:3000/mobile-qa.html
Paste the TEST- AWB, then Inspect or Advance status. Each advance moves toward Delivered.
In the app open Track order again to fetch the latest status. Refresh the admin order's tracking to update its saved order status.
Keep the API running: mock shipment state is in memory and is cleared when the server restarts.
This is a local Delhivery simulator, not a validation against Delhivery's external staging service.

MANUAL CHECKLIST
[ ] App launch, home, categories, search, sorting, product details and images.
[ ] Gold/Silver variants and S/M/L sizes select the correct stock.
[ ] Sold-out item cannot be purchased; last-one stock cannot be exceeded.
[ ] Saved pieces survive app restart; remove a saved piece.
[ ] Cart quantity, remove item, totals, back navigation and restart persistence.
[ ] Login, wrong OTP, logout, second account and order privacy.
[ ] Delivery address validation, delivery fee and free-delivery threshold.
[ ] Online success, online failure, cancellation and retry.
[ ] COD delivery and pickup orders; verify totals and stock reductions.
[ ] My Orders lists new orders with correct items, quantities and totals.
[ ] A new account with no orders sees the shopping message, logo and products button.
[ ] Tracking through Ready to Ship, pickup, transit, out for delivery and Delivered.
[ ] Offline/network failure messages and retry after reconnecting.
[ ] Admin order inventory, payment and courier status; vendor order access.

LIMITS
There is no refund/cancel-order action in the current native app. Those customer flows cannot be tested there until implemented.
Local-only webhooks are not reachable from Razorpay's public servers. Native success uses the verify API; webhook-delivery/reconciliation needs a separately configured public test webhook endpoint.
Journal/About are current app content, not a CMS test.
This setup does not validate production settlement, real OTP delivery, real courier pickup or Play Store release signing.
Existing test orders are preserved. Re-running the fixture setup resets only the sample-product stocks and test checkout settings.
`;
writeFileSync(resolve("../../../apk/APP-TESTING-GUIDE.txt"), guide);
console.log(JSON.stringify({ project: "Fanzzy Local Test", mainProducts: products.map(({ sku, name, stock, price }) => ({ sku, name, stock, price })), cod: true, online: true, delivery: 40, freeAbove: 500, codCharge: 20, existingOrdersPreserved: true, guide: "apk/APP-TESTING-GUIDE.txt" }, null, 2));
