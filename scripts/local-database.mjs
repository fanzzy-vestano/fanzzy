// Persistent, loopback-only PostgreSQL and a small PostgREST-compatible adapter.
// This is exclusively for the local-test launcher; production never imports it.
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const identifier = (name) => { if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error("Invalid database field"); return `"${name}"`; };
const privateVendorTables = ["vendor_users", "vendor_bank_accounts", "vendor_commission_rules", "vendor_sessions", "vendor_orders", "vendor_order_items", "vendor_order_status_history", "vendor_payouts", "vendor_payout_items", "vendor_notifications", "vendor_audit_logs"];
const knownTables = new Set(["products", "categories", "store_settings", "vendors", ...privateVendorTables]);
export async function startLocalDatabase(env) {
  if (env.FANZZY_ENV !== "local-test" || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/local-db$/.test(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error("Local database requires explicit loopback local-test configuration.");
  const root = resolve(import.meta.dirname, "..");
  const snapshotMode = env.FANZZY_DATA_MODE === "production-snapshot";
  if (!new Set(["test-fixtures", "production-snapshot"]).has(env.FANZZY_DATA_MODE || "test-fixtures")) throw new Error("Unsupported local data mode.");
  const snapshotFile = join(root, ".local-real-preview", "snapshot.json");
  let snapshot = null;
  if (snapshotMode) {
    if (!existsSync(snapshotFile)) throw new Error("The local real-data snapshot is missing. Run node scripts/snapshot-production-readonly.mjs first.");
    try { snapshot = JSON.parse(readFileSync(snapshotFile, "utf8")); } catch { throw new Error("The local real-data snapshot is invalid."); }
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.products) || !Array.isArray(snapshot.categories) || !Array.isArray(snapshot.settings) || !Array.isArray(snapshot.vendors)) throw new Error("The local real-data snapshot has an unsupported format.");
  }
  const data = join(root, snapshotMode ? ".local-real-preview" : ".local-test", "postgres");
  const databasePort = snapshotMode ? 55433 : 55432;
  const apiPort = snapshotMode ? 54322 : 54321;
  if (relative(root, data).startsWith("..")) throw new Error("Local database must remain inside this project.");
  const runtime = resolve(process.env.FANZZY_TEST_PG_RUNTIME || join(root, "../../../payment-audit-2026-10-19/db-test/node_modules"));
  const { initdb, pg_ctl } = await import(pathToFileURL(join(runtime, "@embedded-postgres/windows-x64/dist/index.js")));
  const { default: pg } = await import(pathToFileURL(join(runtime, "pg/lib/index.js")));
  mkdirSync(data, { recursive: true });
  if (!existsSync(join(data, "PG_VERSION"))) {
    console.log("Creating persistent local test database…");
    execFileSync(initdb, ["-D", data, "-U", "postgres", "-A", "trust", "--encoding=UTF8", "--locale=C"], { stdio: "pipe", windowsHide: true, timeout: 60000 });
  }
  let started = false;
  try { execFileSync(pg_ctl, ["-D", data, "status"], { stdio: "pipe", windowsHide: true }); }
  catch { execFileSync(pg_ctl, ["-D", data, "-l", join(data, "server.log"), "-o", `-h 127.0.0.1 -p ${databasePort} -c max_connections=64`, "-w", "start"], { stdio: "ignore", windowsHide: true, timeout: 60000 }); started = true; }
  const pool = new pg.Pool({ host: "127.0.0.1", port: databasePort, user: "postgres", database: "postgres", password: "", ssl: false, max: 20, statement_timeout: 15000, connectionTimeoutMillis: 5000 });
  await pool.query(`do $$ begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
    end $$;
    create schema if not exists auth;
    create or replace function auth.jwt() returns jsonb language sql as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to public;`);
  await pool.query(readFileSync(join(root, "supabase/schema.sql"), "utf8").split("insert into public.products")[0]);
  await pool.query(`alter table products add column if not exists vendor_id text;
    alter table products add column if not exists vendor_status text;
    alter table products add column if not exists public_vendor_visible boolean default true;
    create table if not exists vendors(id text primary key,slug text,business_name text,logo_url text,cover_url text,description text,featured boolean default false,status text default 'Active',store_visibility text default 'Visible');
    create table if not exists local_test_meta(key text primary key,value text);`);
  // The original local bootstrap used text vendor IDs. Preserve those IDs and
  // data while installing the marketplace schema used by the server APIs.
  const vendorMigration = readFileSync(join(root, "supabase/migrations/20260822_vendor_marketplace.sql"), "utf8")
    .replace("create extension if not exists pgcrypto;", "")
    .replace(/\buuid\b/g, "text");
  const vendorFields = vendorMigration.match(/create table if not exists public\.vendors \(([\s\S]*?)\n\);/)[1];
  for (const definition of vendorFields.split("\n").map((line) => line.trim().replace(/,$/, "")).filter(Boolean)) {
    await pool.query(`alter table vendors add column if not exists ${definition}`);
  }
  await pool.query(vendorMigration);
  await pool.query("alter table vendors alter column id set default gen_random_uuid()::text; create unique index if not exists local_vendors_slug_unique on vendors(slug); create unique index if not exists local_vendors_email_unique on vendors(login_email)");
  if (snapshotMode && !(await pool.query("select key from local_test_meta where key='production-snapshot-v1'")).rowCount) {
    const client = await pool.connect();
    try {
      await client.query("begin; select set_config('fanzzy.checkout_rpc','on',true)");
      for (const product of snapshot.products) {
        const sku = String(product?.sku || "").trim();
        if (!sku) continue;
        await client.query(
          "insert into products(sku,name,category,stock,price,cost,status,image,hover_image,compare_at,tag,tone,created_at,updated_at,vendor_id,vendor_status,public_vendor_visible) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) on conflict(sku) do update set name=excluded.name,category=excluded.category,stock=excluded.stock,price=excluded.price,cost=excluded.cost,status=excluded.status,image=excluded.image,hover_image=excluded.hover_image,compare_at=excluded.compare_at,tag=excluded.tag,tone=excluded.tone,created_at=excluded.created_at,updated_at=excluded.updated_at,vendor_id=excluded.vendor_id,vendor_status=excluded.vendor_status,public_vendor_visible=excluded.public_vendor_visible",
          [sku, String(product.name || sku), String(product.category || "Uncategorised"), Math.max(0, Math.floor(Number(product.stock) || 0)), Number(product.price) || 0, Number(product.cost) || 0, String(product.status || "Draft"), String(product.image || ""), product.hover_image || null, product.compare_at === null || product.compare_at === undefined ? null : Number(product.compare_at) || 0, product.tag || null, product.tone || null, product.created_at || new Date().toISOString(), product.updated_at || new Date().toISOString(), product.vendor_id || null, product.vendor_status || null, product.public_vendor_visible !== false],
        );
      }
      for (const category of snapshot.categories) {
        const name = String(category?.name || "").trim();
        if (!name) continue;
        await client.query(
          "insert into categories(name,pieces,image,sort_order,section,created_at) values($1,$2,$3,$4,$5,$6) on conflict(name) do update set pieces=excluded.pieces,image=excluded.image,sort_order=excluded.sort_order,section=excluded.section,created_at=excluded.created_at",
          [name, Math.max(0, Math.floor(Number(category.pieces) || 0)), category.image || null, Math.max(0, Math.floor(Number(category.sort_order) || 0)), category.section === "luxury" ? "luxury" : "normal", category.created_at || new Date().toISOString()],
        );
      }
      for (const setting of snapshot.settings) {
        const key = String(setting?.key || "").trim();
        if (!key) continue;
        const value = typeof setting.value === "string" ? setting.value : JSON.stringify(setting.value ?? "");
        await client.query(
          "insert into store_settings(key,value,updated_at) values($1,$2,$3) on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at",
          [key, value, setting.updated_at || new Date().toISOString()],
        );
      }
      for (const vendor of snapshot.vendors) {
        const id = String(vendor?.id || "").trim();
        const slug = String(vendor?.slug || "").trim();
        if (!id || !slug) continue;
        await client.query(
          "insert into vendors(id,slug,business_name,owner_name,login_email,logo_url,cover_url,description,featured,status,store_visibility) values($1,$2,$3,'',$4,$5,$6,$7,$8,$9,$10) on conflict(id) do update set slug=excluded.slug,business_name=excluded.business_name,logo_url=excluded.logo_url,cover_url=excluded.cover_url,description=excluded.description,featured=excluded.featured,status=excluded.status,store_visibility=excluded.store_visibility",
          [id, slug, String(vendor.business_name || slug), `local-preview-${id}@invalid.local`, vendor.logo_url || null, vendor.cover_url || null, vendor.description || "", vendor.featured === true, String(vendor.status || "Active"), String(vendor.store_visibility || "Visible")],
        );
      }
      await client.query("insert into local_test_meta(key,value) values('production-snapshot-v1',$1)", [String(snapshot.capturedAt || "unknown")]);
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }
  if (!snapshotMode && !(await pool.query("select key from local_test_meta where key='seed-v1'")).rowCount) {
    const client = await pool.connect();
    try {
      await client.query("begin; select set_config('fanzzy.checkout_rpc','on',true)");
      const image = "/fanzzy-mark.png";
      for (const [sku, name, category, price, stock] of [["LOCAL-RING", "Local Test Ring", "Rings", 200, 20], ["LOCAL-NECKLACE", "Local Test Necklace", "Necklaces", 300, 20], ["LOCAL-BANGLE", "Local Test Bangle", "Bracelets", 150, 20]]) {
        await client.query("insert into products(sku,name,category,price,cost,stock,status,image,hover_image) values($1,$2,$3,$4,$5,$6,'Published',$7,$7) on conflict(sku) do nothing", [sku, name, category, price, price / 2, stock, image]);
        await client.query("insert into categories(name,pieces,image,section) values($1,1,$2,'normal') on conflict(name) do nothing", [category, image]);
      }
      const settings = {
        orders: [], product_variants: {}, product_variant_type: {}, product_sizes: {}, product_size_stock: {}, product_image_adjustments: {},
        product_barcodes: { "LOCAL-RING": "99001", "LOCAL-NECKLACE": "99002", "LOCAL-BANGLE": "99003" },
        sales_promotions: [], promotional_offers: [], marketing_records: [], agents: [], customers: [], collections: [], refund_requests: [],
        delivery_charge: { enabled: true, amount: 30, freeAboveEnabled: true, freeAbove: 500 },
        payment_methods: { online: true, cod: true, codCharge: 0, provider: "Razorpay" },
        pickup_hubs: [{ id: "local-counter", name: "Local test counter", place: "Local preview", active: true }],
      };
      for (const [key, value] of Object.entries(settings)) await client.query("insert into store_settings(key,value) values($1,$2) on conflict(key) do nothing", [key, JSON.stringify(value)]);
      await client.query("insert into local_test_meta(key,value) values('seed-v1','local-test'); commit");
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }
  if (!snapshotMode && !(await pool.query("select key from local_test_meta where key='seed-v2-partial-return-order'")).rowCount) {
    const fixtureOrder = {
      id: "#FZ-LOCAL-RETURN-001",
      invoiceNumber: "LOCAL-RETURN-001",
      date: "2026-11-14",
      createdAt: "2026-11-14T09:00:00.000Z",
      deliveredAt: "2026-11-14T09:00:00.000Z",
      status: "Delivered",
      total: "₹850",
      customerName: "LOCAL TEST Return Customer",
      phone: "+91 90000 00001",
      address: "Local test address",
      fulfillmentMethod: "pickup",
      pickupHubName: "Local test counter",
      paymentStatus: "paid",
      paymentMethod: "online",
      items: [
        { productId: "LOCAL-RING", productName: "Local Test Ring", name: "Local Test Ring", quantity: 2, price: "₹200" },
        { productId: "LOCAL-NECKLACE", productName: "Local Test Necklace", name: "Local Test Necklace", quantity: 1, price: "₹300" },
        { productId: "LOCAL-BANGLE", productName: "Local Test Bangle", name: "Local Test Bangle", quantity: 1, price: "₹150" },
      ],
    };
    const client = await pool.connect();
    try {
      await client.query("begin; select set_config('fanzzy.checkout_rpc','on',true)");
      const row = (await client.query("select value from store_settings where key='orders' limit 1")).rows[0];
      let orders = [];
      try { orders = JSON.parse(row?.value || "[]"); } catch { orders = []; }
      if (!Array.isArray(orders)) orders = [];
      if (!orders.some((order) => order?.id === fixtureOrder.id)) {
        await client.query(
          "insert into store_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value, updated_at=now()",
          ["orders", JSON.stringify([...orders, fixtureOrder])],
        );
      }
      await client.query("insert into local_test_meta(key,value) values('seed-v2-partial-return-order','local-test'); commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  if (!snapshotMode && !(await pool.query("select key from local_test_meta where key='seed-v3-order-workspace-fixtures'")).rowCount) {
    const fixtureOrders = [
      {
        id: "#FZ-LOCAL-TEST-002", invoiceNumber: "LOCAL-TEST-002", date: "2026-11-13", createdAt: "2026-11-13T10:15:00.000Z",
        status: "Processing", total: "₹500", customerName: "LOCAL TEST Asha", phone: "+91 90000 00002", address: "Local test delivery address", fulfillmentMethod: "delivery", paymentStatus: "paid", paymentMethod: "online", inventoryAdjusted: true,
        items: [
          { productId: "LOCAL-RING", productName: "Local Test Ring", name: "Local Test Ring", quantity: 1, price: "₹200" },
          { productId: "LOCAL-NECKLACE", productName: "Local Test Necklace", name: "Local Test Necklace", quantity: 1, price: "₹300" },
        ],
      },
      {
        id: "#FZ-LOCAL-TEST-003", invoiceNumber: "LOCAL-TEST-003", date: "2026-11-12", createdAt: "2026-11-12T14:30:00.000Z",
        status: "Shipped", total: "₹550", customerName: "LOCAL TEST Bilal", phone: "+91 90000 00003", address: "Local test delivery address", fulfillmentMethod: "delivery", paymentStatus: "paid", paymentMethod: "online", inventoryAdjusted: true,
        items: [
          { productId: "LOCAL-RING", productName: "Local Test Ring", name: "Local Test Ring", quantity: 2, price: "₹200" },
          { productId: "LOCAL-BANGLE", productName: "Local Test Bangle", name: "Local Test Bangle", quantity: 1, price: "₹150" },
        ],
      },
      {
        id: "#FZ-LOCAL-TEST-004", invoiceNumber: "LOCAL-TEST-004", date: "2026-11-11", createdAt: "2026-11-11T11:45:00.000Z",
        status: "Delivered", total: "₹450", customerName: "LOCAL TEST Chitra", phone: "+91 90000 00004", fulfillmentMethod: "pickup", pickupHubName: "Local test counter", paymentStatus: "cod_collected", paymentMethod: "cod", inventoryAdjusted: true,
        items: [
          { productId: "LOCAL-BANGLE", productName: "Local Test Bangle", name: "Local Test Bangle", quantity: 3, price: "₹150" },
        ],
      },
      {
        id: "#FZ-LOCAL-TEST-005", invoiceNumber: "LOCAL-TEST-005", date: "2026-11-10", createdAt: "2026-11-10T16:00:00.000Z",
        status: "Packed", total: "₹700", customerName: "LOCAL TEST Dev", phone: "+91 90000 00005", address: "Local test delivery address", fulfillmentMethod: "delivery", paymentStatus: "paid", paymentMethod: "online", inventoryAdjusted: true,
        items: [
          { productId: "LOCAL-NECKLACE", productName: "Local Test Necklace", name: "Local Test Necklace", quantity: 1, price: "₹300" },
          { productId: "LOCAL-RING", productName: "Local Test Ring", name: "Local Test Ring", quantity: 2, price: "₹200" },
        ],
      },
    ];
    const client = await pool.connect();
    try {
      await client.query("begin; select set_config('fanzzy.checkout_rpc','on',true)");
      const row = (await client.query("select value from store_settings where key='orders' limit 1")).rows[0];
      let orders = [];
      try { orders = JSON.parse(row?.value || "[]"); } catch { orders = []; }
      if (!Array.isArray(orders)) orders = [];
      const ids = new Set(orders.map((order) => order?.id));
      const additions = fixtureOrders.filter((order) => !ids.has(order.id));
      if (additions.length) {
        await client.query(
          "insert into store_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value, updated_at=now()",
          ["orders", JSON.stringify([...orders, ...additions])],
        );
      }
      await client.query("insert into local_test_meta(key,value) values('seed-v3-order-workspace-fixtures','local-test'); commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  if (!snapshotMode && !(await pool.query("select key from local_test_meta where key='seed-v4-test-catalog-fixtures'")).rowCount) {
    const fixtureProducts = [
      ["LOCAL-RING", "Local Test Ring", "Rings", 200, 100, 20],
      ["LOCAL-NECKLACE", "Local Test Necklace", "Necklaces", 300, 150, 20],
      ["LOCAL-BANGLE", "Local Test Bangle", "Bracelets", 150, 75, 20],
    ];
    const client = await pool.connect();
    try {
      await client.query("begin");
      for (const [sku, name, category, price, cost, stock] of fixtureProducts) {
        await client.query(
          "insert into products(sku,name,category,price,cost,stock,status,image,hover_image) values($1,$2,$3,$4,$5,$6,'Published',$7,$7) on conflict(sku) do update set name=excluded.name,category=excluded.category,price=excluded.price,cost=excluded.cost,stock=excluded.stock,status='Published',image=excluded.image,hover_image=excluded.hover_image,updated_at=now()",
          [sku, name, category, price, cost, stock, "/fanzzy-mark.png"],
        );
        await client.query(
          "insert into categories(name,pieces,image,section) values($1,1,$2,'normal') on conflict(name) do update set pieces=excluded.pieces,image=excluded.image,section=excluded.section",
          [category, "/fanzzy-mark.png"],
        );
      }
      await client.query("insert into local_test_meta(key,value) values('seed-v4-test-catalog-fixtures','local-test'); commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  if (!snapshotMode && !(await pool.query("select key from local_test_meta where key='seed-v5-refund-request-fixtures'")).rowCount) {
    const refundRequests = [
      {
        id: "#RF-LOCAL-001",
        orderId: "#FZ-LOCAL-RETURN-001",
        userId: "local-test-customer-001",
        customerName: "LOCAL TEST Return Customer",
        phone: "+91 90000 00001",
        amount: "₹200",
        status: "Requested",
        reason: "Size or variant issue",
        createdAt: "2026-11-14T09:15:00.000Z",
      },
      {
        id: "#RF-LOCAL-002",
        orderId: "#FZ-LOCAL-TEST-004",
        userId: "local-test-customer-004",
        customerName: "LOCAL TEST Chitra",
        phone: "+91 90000 00004",
        amount: "₹450",
        status: "Approved",
        reason: "Product not as expected",
        createdAt: "2026-11-13T11:45:00.000Z",
        updatedAt: "2026-11-13T12:00:00.000Z",
      },
    ];
    await pool.query(
      "insert into store_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value, updated_at=now()",
      ["local_test_refund_requests", JSON.stringify(refundRequests)],
    );
    await pool.query("insert into local_test_meta(key,value) values('seed-v5-refund-request-fixtures','local-test')");
  }
  if (!snapshotMode && !(await pool.query("select key from local_test_meta where key='seed-v6-refund-delivery-dates'")).rowCount) {
    const client = await pool.connect();
    try {
      await client.query("begin; select set_config('fanzzy.checkout_rpc','on',true)");
      const row = (await client.query("select value from store_settings where key='orders' limit 1")).rows[0];
      let orders = [];
      try { orders = JSON.parse(row?.value || "[]"); } catch { orders = []; }
      if (Array.isArray(orders)) {
        const updatedOrders = orders.map((order) => order?.id === "#FZ-LOCAL-RETURN-001" && !order.deliveredAt
          ? { ...order, deliveredAt: "2026-11-14T09:00:00.000Z" }
          : order);
        await client.query(
          "insert into store_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value, updated_at=now()",
          ["orders", JSON.stringify(updatedOrders)],
        );
      }
      await client.query("insert into local_test_meta(key,value) values('seed-v6-refund-delivery-dates','local-test'); commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  await pool.query(readFileSync(join(root, "supabase/migrations/20261019_transactional_checkout.sql"), "utf8"));
  await pool.query(readFileSync(join(root, "supabase/migrations/20261028_online_sales_promotions.sql"), "utf8"));
  const allowedOrigins = new Set([new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin, "http://localhost:3000"]);
  const publicSettings = ["announcement", "hero_image", "hero_slides", "hero_slide_duration", "delivery_charge", "pickup_hubs", "payment_methods", "collections", "agents", "orders", "refund_requests", "walk_in_returns", "local_test_refund_requests", "category_catalog", "product_variants", "product_variant_type", "product_sizes", "product_size_stock", "product_image_adjustments", "promotional_offers", "marketing_records", "product_hsn_codes", "product_bill_names"];
  const isAdmin = (request) => {
    const cookie = (request.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith("fanzzy_admin_session="));
    const signature = cookie?.slice("fanzzy_admin_session=authenticated.".length) || "";
    const expected = createHmac("sha256", env.ADMIN_AUTH_SECRET).update("authenticated").digest("base64url");
    return cookie?.startsWith("fanzzy_admin_session=authenticated.") && signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  };
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) { response.writeHead(403); response.end(); return; }
    const headers = { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": origin || [...allowedOrigins][0], "access-control-allow-credentials": "true", "access-control-allow-headers": "apikey,authorization,content-type,prefer,range,x-client-info,accept,accept-profile,content-profile", "access-control-allow-methods": "GET,HEAD,POST,PATCH,DELETE,OPTIONS", "access-control-expose-headers": "content-range" };
    const send = (body, status = 200, extra = {}) => { response.writeHead(status, { ...headers, ...extra }); response.end(request.method === "HEAD" ? undefined : JSON.stringify(body)); };
    try {
      const url = new URL(request.url, "http://127.0.0.1:54321");
      if (request.method === "OPTIONS") { send(null, 204); return; }
      if (url.pathname === "/health") { await pool.query("select 1"); send({ ready: true, database: "persistent-local-postgresql" }); return; }
      const service = request.headers.apikey === env.SUPABASE_SERVICE_ROLE_KEY && request.headers.authorization === `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`;
      const admin = service || isAdmin(request);
      if (!service && request.headers.apikey !== env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) { send({ message: "Local API key required" }, 401); return; }
      if (url.pathname === "/auth/v1/settings") { send({ external: { google: false } }); return; }
      if (url.pathname === "/auth/v1/logout") { send({}); return; }
      if (!url.pathname.startsWith("/rest/v1/")) { send({ message: "Local endpoint not supported" }, 404); return; }
      let body = null;
      if (!["GET", "HEAD"].includes(request.method)) {
        let raw = ""; for await (const chunk of request) { raw += chunk; if (raw.length > 3_000_000) throw new Error("Request too large"); }
        body = raw ? JSON.parse(raw) : {};
      }
      if (url.pathname === "/rest/v1/rpc/fanzzy_checkout") {
        if (!service) { send({ message: "Server checkout credential required" }, 403); return; }
        const result = await pool.query("select public.fanzzy_checkout($1,$2,$3,$4::jsonb) as result", [body.p_action, body.p_order_id || "", body.p_actor || "", JSON.stringify(body.p_data || {})]);
        send(result.rows[0].result); return;
      }
      const table = url.pathname.slice("/rest/v1/".length);
      if (!knownTables.has(table)) { send({ code: "42P01", message: "This table is not available in the local test database" }, 404); return; }
      if (privateVendorTables.includes(table) && !service) { send({ message: "Server vendor credential required" }, 403); return; }
      if (!["GET", "HEAD"].includes(request.method) && !admin) { send({ message: "Admin sign-in required for local database changes" }, 403); return; }
      const values = [], conditions = [];
      const add = (value) => { values.push(value); return `$${values.length}`; };
      for (const [key, expression] of url.searchParams) {
        if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) continue;
        const column = identifier(key), index = expression.indexOf("."), operator = expression.slice(0, index), value = expression.slice(index + 1);
        if (operator === "in") { const list = value.replace(/^\(/, "").replace(/\)$/, "").split(",").map((item) => item.replace(/^"|"$/g, "")); conditions.push(`${column} = any(${add(list)})`); }
        else if (operator === "is" && value === "null") conditions.push(`${column} is null`);
        else if (operator === "not" && value === "is.null") conditions.push(`${column} is not null`);
        else { const sqlOperator = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike" }[operator]; if (!sqlOperator) throw new Error("Unsupported local filter"); conditions.push(`${column} ${sqlOperator} ${add(value)}`); }
      }
      // Fixture mode exposes only explicit LOCAL-* records. The real-data
      // preview has its own database directory and only serves its snapshot.
      if (!snapshotMode && table === "products") conditions.push("sku like 'LOCAL-%'");
      if (!snapshotMode && table === "categories") conditions.push("name in ('Rings','Necklaces','Bracelets')");
      if (!admin && table === "products") conditions.push("status <> 'Draft'");
      if (!admin && table === "vendors") conditions.push("status = 'Active' and store_visibility = 'Visible'");
      if (!admin && table === "store_settings") conditions.push(`(key = any(${add(publicSettings)}) or key like 'vendor_categories:%')`);
      const where = conditions.length ? ` where ${conditions.join(" and ")}` : "";
      const publicVendorColumns = ["id", "slug", "business_name", "logo_url", "cover_url", "description", "featured", "status", "store_visibility"];
      let selection = url.searchParams.get("select") || "*";
      if (!admin && table === "vendors") {
        if (selection === "*") selection = publicVendorColumns.join(",");
        if (selection.split(",").some((column) => !publicVendorColumns.includes(column))) { send({ message: "Private vendor fields require server authentication" }, 403); return; }
      }
      const selectedColumns = selection === "*" ? "*" : selection.split(",").map(identifier).join(",");
      if (["GET", "HEAD"].includes(request.method)) {
        const total = (await pool.query(`select count(*) from ${identifier(table)}${where}`, values)).rows[0].count;
        let sql = `select ${selectedColumns} from ${identifier(table)}${where}`;
        const order = url.searchParams.get("order");
        if (order) sql += " order by " + order.split(",").map((part) => { const [key, direction] = part.split("."); return `${identifier(key)} ${direction === "desc" ? "desc" : "asc"}`; }).join(",");
        const limit = Math.min(10000, Math.max(0, Number(url.searchParams.get("limit")) || 10000));
        const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
        sql += ` limit ${limit} offset ${offset}`;
        const result = await pool.query(sql, values);
        const object = String(request.headers.accept || "").includes("application/vnd.pgrst.object");
        if (object && result.rows.length !== 1) { send({ code: "PGRST116", details: `${result.rows.length} rows`, message: "Expected one row" }, 406); return; }
        send(object ? result.rows[0] : result.rows, 200, { "content-range": `${offset}-${Math.max(offset, offset + result.rowCount - 1)}/${total}` }); return;
      }
      if (request.method === "POST") {
        const rows = Array.isArray(body) ? body : [body], inserted = [];
        const client = await pool.connect();
        try {
          await client.query("begin");
          for (const row of rows) {
            const keys = Object.keys(row); if (!keys.length) throw new Error("Empty database record");
            const args = keys.map((key) => row[key]);
            let sql = `insert into ${identifier(table)} (${keys.map(identifier).join(",")}) values (${args.map((_, index) => `$${index + 1}`).join(",")})`;
            if (String(request.headers.prefer || "").includes("resolution=merge-duplicates")) {
              const conflicts = (url.searchParams.get("on_conflict") || (table === "products" ? "sku" : table === "categories" ? "name" : table === "store_settings" ? "key" : "id")).split(",");
              const updates = keys.filter((key) => !conflicts.includes(key));
              sql += ` on conflict (${conflicts.map(identifier).join(",")}) ` + (updates.length ? `do update set ${updates.map((key) => `${identifier(key)}=excluded.${identifier(key)}`).join(",")}` : "do nothing");
            }
            inserted.push(...(await client.query(sql + " returning *", args)).rows);
          }
          await client.query("commit");
        } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
        send(inserted, 201); return;
      }
      if (!where) throw new Error("Updates require a record filter");
      if (request.method === "PATCH") {
        const updates = Object.keys(body).map((key) => `${identifier(key)}=${add(body[key])}`);
        const result = await pool.query(`update ${identifier(table)} set ${updates.join(",")}${where} returning *`, values); send(result.rows); return;
      }
      if (request.method === "DELETE") { const result = await pool.query(`delete from ${identifier(table)}${where} returning *`, values); send(result.rows); return; }
      send({ message: "Method unsupported" }, 405);
    } catch (error) { send({ code: error.code || "LOCAL_DATABASE", message: error.message }, 400); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(apiPort, "127.0.0.1", resolve); });
  console.log(`Local PostgreSQL ready · API http://127.0.0.1:${apiPort} · data ${snapshotMode ? ".local-real-preview/postgres (read-only production snapshot)" : ".local-test/postgres"}`);
  let stopping = false;
  return { stop: async () => { if (stopping) return; stopping = true; await new Promise((resolve) => server.close(resolve)); await pool.end(); if (started) execFileSync(pg_ctl, ["-D", data, "-m", "fast", "-w", "stop"], { stdio: "ignore", windowsHide: true, timeout: 30000 }); } };
}
