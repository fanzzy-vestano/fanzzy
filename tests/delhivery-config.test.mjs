import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname, extname } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const nativeRequire = createRequire(import.meta.url);

// Execute the real shipping modules with isolated environment settings and no network.
function loadShipping(overrides = {}, handleFetch) {
  const env = { DELHIVERY_MODE: "production", ...overrides };
  const cache = new Map();
  const requests = [];
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const cjsModule = { exports: {} };
    cache.set(file, cjsModule);
    const source = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, {
      module: cjsModule, exports: cjsModule.exports, process: { env },
      require: (id) => id.startsWith(".") ? load(resolve(dirname(file), extname(id) ? id : `${id}.ts`)) : nativeRequire(id),
      fetch: async (...args) => { requests.push(args); if (handleFetch) return handleFetch(...args); throw new Error("Network forbidden in local shipping tests"); },
      crypto: globalThis.crypto, URL, URLSearchParams, Response, Buffer, AbortSignal, console,
    }, { filename: file });
    return cjsModule.exports;
  }
  return { ...load(resolve(root, "lib/delhivery.ts")), load, requests };
}

const configured = {
  DELHIVERY_API_TOKEN: "test-token-not-real",
  DELHIVERY_CLIENT_NAME: "Test Client",
  DELHIVERY_PICKUP_NAME: "Registered Warehouse",
  DELHIVERY_SELLER_NAME: "Test Seller",
  DELHIVERY_SELLER_ADDRESS: "Test Street",
  DELHIVERY_SELLER_GST_TIN: "test-gst",
  DELHIVERY_ORIGIN_PIN: "560001",
};
const order = {
  id: "LOCAL-DELHIVERY-TEST", total: "589", customerName: "Local Test",
  phone: "9999999999", address: "Test Street, Bengaluru 560001",
  paymentMethod: "online", delhiveryWeightGrams: 650,
  delhiveryPickupLocation: "Registered Warehouse",
  items: [{ name: "Test item", quantity: 1, price: "589" }],
};

test("existing PICKUP_NAME setting supplies the selectable registered warehouse", () => {
  const shipping = loadShipping(configured);
  const options = shipping.getDelhiveryAdminOptions();
  assert.deepEqual(Array.from(options.pickupLocations), ["Registered Warehouse"]);
  assert.equal(options.configurationError, "");
  assert.equal(shipping.isDelhiveryConfigured(), true);
  assert.equal(shipping.isDelhiveryPickupConfigured(), true);
});

const integration = {
  D1_CLIENT_ID: "test-client", D1_CLIENT_SECRET: "private-integration-secret",
  D1_AUTH_URL: "https://auth.example.test", D1_REALM: "test-realm",
  D1_CLIENT_CMS: "cms::client::test", D1_MCP_URL: "https://mcp.example.test/mcp",
};
const facilities = [
  { facility_id: "one", facility_name: "VESTANO", status: "ACTIVE", blocked: false, address: { address_line1: "Test Street 1", city: "Kozhikode", state: "Kerala", pin_code: "673001" } },
  { facility_id: "two", facility_name: "VESTANO RETAIL B2C", status: "ACTIVE", blocked: false, address: { address_line1: "Test Street 2", city: "Kozhikode", state: "Kerala", pin_code: "673002" } },
  { facility_name: "Inactive", status: "ARCHIVED" },
  { facility_name: "Blocked", status: "ACTIVE", blocked: true },
];
const respondLocations = (rows = facilities, format = "sse") => async (url, init) => {
  assert.equal(init.redirect, "manual", "Cloudflare supports manual redirects; redirected credentials must never be forwarded");
  if (url.includes("/token")) {
    assert.equal(init.body.get("grant_type"), "client_credentials");
    return Response.json({ access_token: "private-access-token", expires_in: 300 });
  }
  const request = JSON.parse(init.body);
  assert.equal(request.method, "tools/call");
  assert.equal(request.params.name, "list-pickup-locations");
  assert.equal(init.headers.Authorization, "Bearer private-access-token");
  assert.equal(init.headers["X-HQ-Client-Id"], integration.D1_CLIENT_CMS);
  const rpc = { jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: JSON.stringify({ results: rows }) }] } };
  return format === "sse" ? new Response(`event: message\r\ndata: ${JSON.stringify(rpc)}\r\n\r\n`) : Response.json(rpc);
};

test("authenticated fetch returns both active registered addresses without a static pickup setting", async () => {
  const shipping = loadShipping({ ...configured, ...integration, DELHIVERY_PICKUP_NAME: "" }, respondLocations());
  const options = await shipping.loadDelhiveryAdminOptions();
  assert.deepEqual(Array.from(options.pickupLocations), ["VESTANO", "VESTANO RETAIL B2C"]);
  assert.equal(options.pickupLocationDetails[1].address, "Test Street 2");
  assert.equal(options.pickupLocationDetails[1].pincode, "673002");
  assert.equal(options.configurationError, "");
  await shipping.loadDelhiveryAdminOptions();
  assert.equal(shipping.requests.filter(([url]) => url.includes("/token")).length, 1);
  assert.doesNotMatch(JSON.stringify(options), /private-integration-secret|private-access-token/);
});

test("the second fetched warehouse and packed weight are sent unchanged to the shipment API", async () => {
  const respond = respondLocations(facilities, "json");
  const shipping = loadShipping({ ...configured, ...integration, DELHIVERY_PICKUP_NAME: "" }, async (url, init) => {
    if (url.includes("/pin-codes/")) return Response.json({ delivery_codes: [{ postal_code: { pin: "560001", pre_paid: "Y" } }] });
    if (url.includes("/cmu/create")) {
      const payload = JSON.parse(new URLSearchParams(init.body).get("data"));
      assert.equal(payload.pickup_location.name, "VESTANO RETAIL B2C");
      assert.equal(payload.shipments[0].weight, 650);
      return Response.json({ waybill: "TEST-LOCAL-ONLY" });
    }
    return respond(url, init);
  });
  const result = await shipping.manifestDelhiveryShipment({ ...order, delhiveryPickupLocation: "VESTANO RETAIL B2C" });
  assert.equal(result.waybill, "TEST-LOCAL-ONLY");
  await assert.rejects(shipping.manifestDelhiveryShipment({ ...order, delhiveryPickupLocation: "Blocked" }), /no longer active/);
  assert.equal(shipping.requests.filter(([url]) => url.includes("cmu/create")).length, 1);
});

test("upstream failure returns an authenticated no-store error without credentials", async () => {
  const shipping = loadShipping({ ...configured, ...integration, ADMIN_AUTH_SECRET: "local-auth" }, async () => new Response("private-integration-secret", { status: 403 }));
  const route = shipping.load(resolve(root, "app/api/admin/delhivery/config/route.ts"));
  assert.equal((await route.GET(new Request("http://localhost/config"))).status, 401);
  assert.equal(shipping.requests.length, 0);
  const auth = shipping.load(resolve(root, "lib/admin-auth.ts"));
  const response = await route.GET(new Request("http://localhost/config", { headers: { cookie: auth.createAdminSessionCookie().split(";")[0] } }));
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(await response.text(), /private-integration-secret/);
});

test("pickup fetch follows cursor pages, deduplicates names, and retains active warehouses", async () => {
  const firstPage = Array.from({ length: 50 }, (_, index) => ({ ...facilities[0], facility_id: String(index), facility_name: `Warehouse ${index}` }));
  const respond = respondLocations();
  const shipping = loadShipping({ ...configured, ...integration }, async (url, init) => {
    if (url.includes("/token")) return respond(url, init);
    const rpc = JSON.parse(init.body);
    const page = rpc.params.arguments.page;
    assert.equal(rpc.params.arguments.next, page === 1 ? "" : "49");
    return respondLocations(page === 1 ? firstPage : [firstPage[0], facilities[1]])(url, init);
  });
  const result = await shipping.loadDelhiveryAdminOptions();
  assert.equal(result.pickupLocations.length, 51);
  assert.equal(result.pickupLocations.at(-1), "VESTANO RETAIL B2C");
});

test("explicit location wins; whitespace-only location falls back to pickup name", () => {
  assert.equal(loadShipping({ ...configured, DELHIVERY_PICKUP_LOCATION: " Primary Warehouse " }).getDelhiveryAdminOptions().pickupLocations[0], "Primary Warehouse");
  assert.equal(loadShipping({ ...configured, DELHIVERY_PICKUP_LOCATION: "   " }).getDelhiveryAdminOptions().pickupLocations[0], "Registered Warehouse");
});

test("missing setup returns actionable diagnostics without leaking credentials", () => {
  const shipping = loadShipping({ DELHIVERY_API_TOKEN: "private-test-token" });
  const options = shipping.getDelhiveryAdminOptions();
  assert.equal(options.pickupLocations.length, 0);
  assert.match(options.configurationError, /pickup warehouse/);
  assert.match(options.configurationError, /client name/);
  assert.match(options.configurationError, /valid origin pincode/);
  assert.doesNotMatch(options.configurationError, /private-test-token/);
  assert.equal(shipping.isDelhiveryConfigured(), false);
});

test("incomplete production setup stops shipment creation before any external request", async () => {
  const shipping = loadShipping({ DELHIVERY_PICKUP_NAME: "Registered Warehouse" });
  await assert.rejects(shipping.manifestDelhiveryShipment(order), /Missing: API token, client name/);
  assert.equal(shipping.requests.length, 0);
});

test("admin configuration endpoint requires authentication and returns the resolved warehouse", async () => {
  const shipping = loadShipping({ ...configured, ADMIN_AUTH_SECRET: "local-only-auth-secret" });
  const route = shipping.load(resolve(root, "app/api/admin/delhivery/config/route.ts"));
  assert.equal((await route.GET(new Request("http://localhost/api/admin/delhivery/config"))).status, 401);
  const auth = shipping.load(resolve(root, "lib/admin-auth.ts"));
  const response = await route.GET(new Request("http://localhost/api/admin/delhivery/config", {
    headers: { cookie: auth.createAdminSessionCookie().split(";")[0] },
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.pickupLocations, ["Registered Warehouse"]);
  assert.equal(body.configurationError, "");
  assert.doesNotMatch(JSON.stringify(body), /test-token-not-real|local-only-auth-secret/);
});

test("manual pickup dates use India time, reject invalid/past slots, and allow only seven days ahead", () => {
  const shipping = loadShipping();
  const dates = shipping.load(resolve(root, "lib/delhivery-pickup-date.ts"));
  const now = new Date("2026-10-16T18:45:00Z"); // 17 October, 00:15 in India.
  const range = dates.pickupDateRange(now);
  assert.equal(range.min, "2026-10-17");
  assert.equal(range.max, "2026-10-24");
  assert.throws(() => dates.selectedPickupSchedule("2026-02-30", "14:30", now), /valid pickup date/);
  assert.throws(() => dates.selectedPickupSchedule("2026-10-16", "14:30", now), /next 7 days/);
  assert.throws(() => dates.selectedPickupSchedule("2026-10-25", "14:30", now), /next 7 days/);
  assert.throws(() => dates.selectedPickupSchedule("2026-10-17", "00:10", now), /future pickup time/);
  assert.equal(dates.selectedPickupSchedule("2026-10-17", "00:30", now).pickupTime, "00:30:00");
  assert.equal(dates.selectedPickupSchedule("2026-10-24", "14:30", now).pickupDate, "2026-10-24");
});

test("admin create route preserves the exact selected date/time through storage and pickup wire payload", async () => {
  let saved = [{ ...order, id: "#FZ-DATE-FLOW", status: "Processing", paymentStatus: "paid", fulfillmentMethod: "delivery", createdAt: new Date().toISOString() }];
  const pickups = [];
  const shipping = loadShipping({ ...configured, ...integration, ADMIN_AUTH_SECRET: "local-auth", NEXT_PUBLIC_SUPABASE_URL: "https://db.example.test", SUPABASE_SERVICE_ROLE_KEY: "local-only" }, async (url, init = {}) => {
    if (url.includes("/store_settings")) {
      if (init.method === "POST") { saved = JSON.parse(JSON.parse(init.body)[0].value); return new Response(null, { status: 204 }); }
      return Response.json([{ value: JSON.stringify(saved) }]);
    }
    if (url.includes("/pin-codes/")) return Response.json({ delivery_codes: [{ postal_code: { pin: "560001", pre_paid: "Y" } }] });
    if (url.includes("/cmu/create")) return Response.json({ waybill: "TEST-DATE-FLOW" });
    if (url.includes("/fm/request/new/")) { pickups.push(JSON.parse(init.body)); return Response.json({ pickup_id: "TEST-DATE-PICKUP", status: "Scheduled" }); }
    return respondLocations()(url, init);
  });
  const dates = shipping.load(resolve(root, "lib/delhivery-pickup-date.ts"));
  const date = dates.pickupDateRange().max;
  const previousDate = new Date(`${date}T00:00:00Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  saved.push({ ...saved[0], id: "#FZ-OTHER-DATE", delhiveryAwb: "TEST-OLDER-SLOT", delhiveryPickupLocation: "VESTANO RETAIL B2C", delhiveryShipmentStatus: "created", delhiveryPickupRequestStatus: "created", delhiveryPickupRequestDate: previousDate.toISOString().slice(0, 10), delhiveryPickupRequestTime: "14:30:00" });
  const auth = shipping.load(resolve(root, "lib/admin-auth.ts"));
  const route = shipping.load(resolve(root, "app/api/admin/delhivery/create/route.ts"));
  const request = () => new Request("http://localhost/api/admin/delhivery/create", { method: "POST", headers: { cookie: auth.createAdminSessionCookie().split(";")[0], "Content-Type": "application/json" }, body: JSON.stringify({ orderId: "#FZ-DATE-FLOW", weightGrams: 875, pickupLocation: "VESTANO RETAIL B2C", pickupDate: date, pickupTime: "14:30" }) });
  const response = await route.POST(request());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.created, true);
  assert.equal(data.order.delhiveryRequestedPickupDate, date);
  assert.equal(data.order.delhiveryPickupRequestDate, date);
  assert.equal(data.order.delhiveryPickupRequestTime, "14:30:00");
  assert.equal(saved[0].delhiveryWeightGrams, 875);
  assert.equal(saved[0].delhiveryPickupLocation, "VESTANO RETAIL B2C");
  assert.equal(pickups.length, 1);
  assert.equal(pickups[0].pickup_date, date);
  assert.equal(pickups[0].pickup_time, "14:30:00");
  assert.equal(pickups[0].pickup_location, "VESTANO RETAIL B2C");
  assert.equal(pickups[0].expected_package_count, 1, "A pickup on a different date must neither cover nor count toward this slot");
  assert.equal((await route.POST(request())).status, 200);
  assert.equal(pickups.length, 1);
});

test("admin create rejects missing/invalid pickup dates before any database or carrier call", async () => {
  const shipping = loadShipping({ ...configured, ADMIN_AUTH_SECRET: "local-auth" });
  const auth = shipping.load(resolve(root, "lib/admin-auth.ts"));
  const route = shipping.load(resolve(root, "app/api/admin/delhivery/create/route.ts"));
  for (const date of ["", "2000-01-01", "2999-01-01", "2026-02-30"]) {
    const response = await route.POST(new Request("http://localhost/create", { method: "POST", headers: { cookie: auth.createAdminSessionCookie().split(";")[0], "Content-Type": "application/json" }, body: JSON.stringify({ orderId: "#FZ-DATE-FLOW", weightGrams: 650, pickupLocation: "Registered Warehouse", pickupDate: date, pickupTime: "14:30" }) }));
    assert.equal(response.status, 400);
  }
  assert.equal(shipping.requests.length, 0);
});

test("a rejected explicitly selected slot is reported without falling back to another date or time", async () => {
  let attempts = 0;
  const shipping = loadShipping({ ...configured, ...integration }, async (url, init) => {
    if (url.includes("/fm/request/new/")) { attempts++; return Response.json({ error: "Selected slot unavailable" }, { status: 400 }); }
    return respondLocations()(url, init);
  });
  const date = shipping.load(resolve(root, "lib/delhivery-pickup-date.ts")).pickupDateRange().max;
  await assert.rejects(shipping.createDelhiveryPickupRequest(1, "VESTANO", "14:30:00", date), /Selected slot unavailable/);
  assert.equal(attempts, 1);
});
