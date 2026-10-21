import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { createRequire } from "node:module";
import { compileBrowserModule, loadBrowserModule, loadBrowserStorage } from "./helpers/browser-storage-fixture.mjs";

function fakeWindow(mode = "full") {
  const values = new Map();
  const sessionValues = new Map();
  const makeStore = map => ({
    get length() { return map.size; },
    key: i => [...map.keys()][i] ?? null,
    getItem: key => map.get(key) ?? null,
    setItem(key, value) {
      if (mode === "full") throw new DOMException("Storage full", "QuotaExceededError");
      map.set(key, value);
    },
    removeItem: key => map.delete(key),
  });
  const win = {
    localStorage: makeStore(values), sessionStorage: makeStore(sessionValues),
    dispatchEvent() {}, addEventListener() {}, removeEventListener() {}, setTimeout() {}, scrollY: 0,
  };
  if (mode === "blocked") {
    for (const name of ["localStorage", "sessionStorage"]) Object.defineProperty(win, name, {
      get() { throw new DOMException("Storage unavailable", "SecurityError"); },
    });
  }
  return { win, values, sessionValues, setMode: value => { mode = value; } };
}

const sourceCache = new Map();
function extractHandler(file, name, owner) {
  let ast = sourceCache.get(file);
  if (!ast) {
    ast = ts.createSourceFile(file, readFileSync(new URL("../" + file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    sourceCache.set(file, ast);
  }
  const base = owner ? ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === owner) : ast;
  assert(base, owner);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(base);
  assert(initializer, name);
  if (ts.isCallExpression(initializer) && initializer.expression.getText(ast) === "useCallback") initializer = initializer.arguments[0];
  const code = ts.transpileModule("return (" + initializer.getText(ast) + ");", {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return scope => new Function(...Object.keys(scope), code)(...Object.values(scope));
}
const noop = () => {};

test("device-only store settings save and restore after refresh with full localStorage", async () => {
  const { IDBFactory } = createRequire(import.meta.url)("fake-indexeddb"), indexedDB = new IDBFactory();
  const first = fakeWindow("full").win; first.indexedDB = indexedDB;
  const storage = loadBrowserStorage(first);
  let message = "";
  const profile = { storeName: "Local store", email: "local@example.invalid" }, shipping = { freeAbove: "800" };
  await extractHandler("app/admin/page.tsx", "saveSettings", "SettingsWorkspace")({
    window: first, ...storage, profile, shipping, payments: {}, billDesign: {}, roles: [],
    saveStoreSetting: async () => null, onNotify: value => { message = value; },
  })();
  assert.equal(message, "Store settings saved");
  const fresh = fakeWindow("full").win; fresh.indexedDB = indexedDB;
  let restoredProfile, restoredShipping, ready = false;
  await extractHandler("app/admin/page.tsx", "loadSettings", "SettingsWorkspace")({
    window: fresh, ...loadBrowserStorage(fresh), active: true, profile: {}, shipping: {}, defaultAdminRoles: [],
    defaultPaymentSettings: {}, defaultBillDesignSettings: {}, parsePaymentSettings: value => value,
    fetchStoreSetting: async () => ({ value: null, error: null }),
    setProfile: value => { restoredProfile = value; }, setShipping: value => { restoredShipping = value; },
    setPayments: noop, setBillDesign: noop, setRoles: noop, setSettingsReady: value => { ready = value; },
  })();
  assert.deepEqual(restoredProfile, profile); assert.deepEqual(restoredShipping, shipping); assert(ready);
});

test("store settings do not report success when a backend setting fails", async () => {
  const win = fakeWindow("normal").win, storage = loadBrowserStorage(win);
  let message = "";
  await extractHandler("app/admin/page.tsx", "saveSettings", "SettingsWorkspace")({
    window: win, ...storage, profile: {}, shipping: {}, payments: {}, billDesign: {}, roles: [],
    saveStoreSetting: async () => new Error("offline"), onNotify: value => { message = value; },
  })();
  assert.match(message, /could not be saved/);
});

for (const mode of ["normal", "full", "blocked"]) {
  test("storage read/write/remove and session isolation: " + mode, () => {
    const { win } = fakeWindow(mode);
    const { browserLocalStorage: local, browserSessionStorage: session } = loadBrowserStorage(win);
    assert.equal(local.setItem("key", "local"), mode === "normal");
    session.setItem("key", "session");
    assert.equal(local.getItem("key"), "local");
    assert.equal(session.getItem("key"), "session");
    assert.equal(local.length, 1);
    assert.equal(local.key(0), "key");
    local.removeItem("key");
    assert.equal(local.getItem("key"), null);
    assert.equal(session.getItem("key"), "session");
  });
  test("customer OTP and payment requests share a usable in-memory session: " + mode, async () => {
    const { win } = fakeWindow(mode);
    const storage = loadBrowserStorage(win);
    const calls = [];
    const fetch = async (url, init) => { calls.push({ url, init }); return Response.json({}); };
    const auth = loadBrowserModule("lib/customer-auth-client.ts", win, {}, storage, { fetch, process: { env: {} } });
    const api = loadBrowserModule("lib/site-api-client.ts", win, { "./supabase/client": { supabase: null } }, storage, { fetch, process: { env: {} } });
    auth.saveCustomerAuthTokens({ pendingToken: "pending_FIXTURE" });
    await auth.customerAuthRequest("verify-otp");
    assert.equal(calls.at(-1).init.headers.get("authorization"), "Bearer pending_FIXTURE");
    auth.saveCustomerAuthTokens({ sessionToken: "session_FIXTURE" });
    auth.saveCustomerAuthUser({ id: "LOCAL", phone: "9000000000" });
    assert.equal(auth.readStoredCustomerAuthUser()?.id, "LOCAL");
    await api.customerApiFetch("/orders");
    assert.equal(calls.at(-1).init.headers.get("authorization"), "Bearer session_FIXTURE");
    auth.clearCustomerAuthTokens();
    await api.customerApiFetch("/orders");
    assert.equal(calls.at(-1).init.headers.has("authorization"), false);
    api.saveVendorSessionToken("vendor_FIXTURE");
    await api.vendorApiFetch("/vendor/dashboard");
    assert.equal(calls.at(-1).init.headers.get("authorization"), "Bearer vendor_FIXTURE");
    api.clearVendorSessionToken();
    await api.vendorApiFetch("/vendor/dashboard");
    assert.equal(calls.at(-1).init.headers.has("authorization"), false);
  });
}

test("failed writes override stale disk values; recovery resumes persistence", () => {
  const b = fakeWindow("normal");
  b.values.set("token", "old");
  const { browserLocalStorage: store } = loadBrowserStorage(b.win);
  b.setMode("full");
  assert.equal(store.setItem("token", "new"), false);
  assert.equal(store.getItem("token"), "new");
  b.setMode("normal");
  assert.equal(store.setItem("token", "latest"), true);
  assert.equal(b.values.get("token"), "latest");
  b.values.set("token", "another-tab");
  assert.equal(store.getItem("token"), "another-tab");
});

test("fallback is isolated across browser windows and absent during SSR", () => {
  const exports = {};
  const a = fakeWindow("full"), b = fakeWindow("full");
  const create = new Function("exports", "window", compileBrowserModule("lib/browser-storage.ts"));
  create(exports, a.win);
  exports.browserLocalStorage.setItem("token", "window-a");
  assert.equal(loadBrowserStorage(b.win).browserLocalStorage.getItem("token"), null);
  const server = loadBrowserStorage(undefined).browserLocalStorage;
  assert.equal(server.setItem("token", "server"), false);
  assert.equal(server.getItem("token"), null);
});

for (const mode of ["full", "blocked"]) {
  test("OTP success handlers complete sign-in without a quota/network error: " + mode, async () => {
    const { win } = fakeWindow(mode), storage = loadBrowserStorage(win);
    const user = { id: "LOCAL", phone: "9000000000" };
    const fetch = async url => String(url).endsWith("send-otp")
      ? Response.json({ pendingToken: "pending_LOCAL" })
      : Response.json({ user, sessionToken: "session_LOCAL" });
    const auth = loadBrowserModule("lib/customer-auth-client.ts", win, {}, storage, { fetch, process: { env: {} } });
    let message = "", verified = false, signedIn;
    const scope = { window: win, ...storage, ...auth, authPhone: user.phone, authOtp: "123456", otpCooldown: 0,
      setAuthLoading: noop, setAuthMessage: value => { message = value; }, setOtpSent: noop, setOtpCooldown: noop,
      setAuthUser: value => { signedIn = value; }, setCheckoutForm: noop, setAuthOtp: noop,
      setAuthJustVerified: value => { verified = value; } };
    await extractHandler("app/page.tsx", "sendOtp", "Home")(scope)();
    assert.equal(message, "OTP sent successfully by SMS");
    await extractHandler("app/page.tsx", "verifyOtp", "Home")(scope)();
    assert(verified);
    assert.equal(signedIn.id, user.id);
    assert.equal(message, "Verification successful");
    assert.equal(storage.browserLocalStorage.getItem("fanzzy-customer-session-token"), "session_LOCAL");
  });
  test("signed-out checkout/orders and vendor cart work with " + mode + " storage", async () => {
    const { win } = fakeWindow(mode), storage = loadBrowserStorage(win);
    let authOpened = false, cartUpdated = false;
    const scope = { window: win, ...storage, authUser: null, cartItems: [{}], cartStockIssues: [],
      checkoutAfterAuthKey: "checkout", ordersAfterAuthKey: "orders", setCartOpen: noop, setQuickProduct: noop,
      setAuthMessage: noop, setAuthOpen: value => { authOpened = value; } };
    await extractHandler("app/page.tsx", "openCheckout", "Home")(scope)();
    assert(authOpened);
    assert.equal(storage.browserLocalStorage.getItem("checkout"), "1");
    authOpened = false;
    extractHandler("app/page.tsx", "openOrders", "Home")(scope)();
    assert(authOpened);
    await extractHandler("app/vendors/[slug]/vendor-store-page.tsx", "addToCart", "VendorStorePage")({
      window: win, ...storage, hasValidSellingPrice: () => true,
      setCartActionsVisible: () => { cartUpdated = true; }, setAddedProducts: noop,
    })({ sku: "LOCAL", stock: 1, price: 10 });
    assert(cartUpdated);
    assert.deepEqual(JSON.parse(storage.browserLocalStorage.getItem("fanzzy-cart:guest")), { local: 1 });
  });
  test("refund success and image zoom survive " + mode + " storage", async () => {
    const { win } = fakeWindow(mode), storage = loadBrowserStorage(win);
    let saved = false, updated = false, toast = "", zoomed = false;
    await extractHandler("app/page.tsx", "requestRefund", "Home")({
      window: win, ...storage, authUser: { id: "LOCAL" }, refundRequestForOrder: () => null,
      setRefundSubmittingId: noop, fetchStoreSetting: async () => ({ value: "[]" }),
      saveStoreSetting: async () => { saved = true; return null; },
      setRefundRequests: () => { updated = true; }, announce: value => { toast = value; },
    })({ id: "#LOCAL", status: "Delivered", total: "₹10" });
    assert(saved && updated);
    assert.match(toast, /Refund request sent/);
    extractHandler("app/page.tsx", "openZoomedImage", "Home")({
      window: win, ...storage, zoomedImage: null, overlayScrollY: { current: null },
      overlayReturnScrollStorageKey: "scroll", setZoomedImage: () => { zoomed = true; },
    })({ src: "/fixture" });
    assert(zoomed);
  });
}

for (const owner of ["CollectionsWorkspace", "CustomersWorkspace", "AgentsWorkspace", "MarketingWorkspace", "PromotionOffersWorkspace"]) {
  test(owner + " still reaches backend saving when storage is full", async () => {
    const { win } = fakeWindow();
    const storage = loadBrowserStorage(win);
    let backendSaved = false, notified = false;
    await extractHandler("app/admin/page.tsx", "persist", owner)({
      window: win, ...storage, setRecords: noop, setCustomers: noop, setAgents: noop, setOffers: noop,
      promotionStorageKey: "promos", saveStoreSetting: async () => { backendSaved = true; return null; },
      onNotify: () => { notified = true; },
    })([], "Saved");
    assert(backendSaved && notified);
  });
}

test("admin initialization, settings, suppliers and order edits survive rejected storage", async () => {
  const { win } = fakeWindow("blocked"), storage = loadBrowserStorage(win);
  extractHandler("app/admin/page.tsx", "syncRoles", "AdminDashboard")({
    window: win, ...storage, defaultAdminRoles: [], setAdminRoles: noop, setActiveRoleId: noop,
  })();
  let count = 0, message = "";
  await extractHandler("app/admin/page.tsx", "saveSettings", "SettingsWorkspace")({
    window: win, ...storage, profile: {}, shipping: {}, payments: {}, billDesign: {}, roles: [],
    saveStoreSetting: async () => { count++; return null; }, onNotify: value => { message = value; },
  })();
  assert.equal(count, 2);
  assert.match(message, /for this visit/);
  let busy = false;
  const persistSuppliers = extractHandler("app/admin/page.tsx", "persistSuppliers")({ window: win, ...storage, localSuppliersKey: "suppliers" });
  await extractHandler("app/admin/page.tsx", "save", "SuppliersWorkspace")({
    window: win, ...storage, supplierName: "Fixture", suppliers: [], editingId: null,
    setSaving: value => { busy = value; }, saveStoreSetting: async () => null, persistSuppliers,
    setSuppliers: noop, setDefaultSupplierId: noop, resetForm: noop, onNotify: noop,
  })();
  assert.equal(busy, false);
  let ordersSaved = false;
  await extractHandler("app/admin/page.tsx", "persistOrders", "OrdersWorkspace")({
    window: win, ...storage, filterVisibleOrders: value => value, setOrders: noop,
    fetchStoreOrders: async () => ({ data: [] }), saveStoreOrders: async () => { ordersSaved = true; return null; },
  })([]);
  assert(ordersSaved);
});

for (const [owner, name, extras, args] of [
  ["AnnouncementPanel", "saveAnnouncement", { text: "Fixture" }, []],
  ["HubWorkspace", "persistHubs", {}, [[]]],
  ["DeliveryChargeWorkspace", "saveDeliveryCharge", { amount: "30", freeAbove: "500", enabled: true, freeAboveEnabled: true }, []],
  ["HomepageWorkspace", "saveHeroImage", { pendingImages: ["/fixture.webp"], pendingFiles: [null], slideDuration: "5", defaultHeroSlideDuration: 5,
    setHeroImages: noop, setPendingImages: noop, setPendingFiles: noop, setSlideDuration: noop }, []],
]) {
  test(owner + " completes server-backed saving with full storage", async () => {
    const { win } = fakeWindow(), storage = loadBrowserStorage(win);
    let saved = 0, notified = false;
    await extractHandler("app/admin/page.tsx", name, owner)({
      window: win, ...storage, ...extras, saveStoreSetting: async () => { saved++; return null; },
      onNotify: () => { notified = true; },
    })(...args);
    assert(saved > 0 && notified);
  });
}

test("admin refund status updates show success after backend saving", async () => {
  const { win } = fakeWindow(), storage = loadBrowserStorage(win);
  let updated = false, notice = "";
  await extractHandler("app/admin/page.tsx", "updateStatus", "RefundRequestsWorkspace")({
    window: win, ...storage, busyId: null, setBusyId: noop,
    fetchStoreSetting: async () => ({ value: '[{"id":"LOCAL"}]' }),
    parseRefundRequests: JSON.parse, saveStoreSetting: async () => null,
    setRequests: () => { updated = true; }, onNotify: value => { notice = value; },
  })({ id: "LOCAL" }, "Approved");
  assert(updated);
  assert.match(notice, /marked approved/);
});

test("vendor guest cart survives a document navigation with storage blocked", () => {
  const from = fakeWindow("blocked"), firstStorage = loadBrowserStorage(from.win);
  firstStorage.browserLocalStorage.setItem("fanzzy-cart:guest", '{"fixture-product":2}');
  const first = loadBrowserModule("lib/cart-navigation.ts", from.win, {}, firstStorage);
  const target = first.storefrontCartUrl("buy");
  assert.match(target, /^\/\?fanzzy-cart-action=buy#fanzzy-cart-transfer=/);
  const to = fakeWindow("blocked"), secondStorage = loadBrowserStorage(to.win);
  let replaced = "";
  to.win.location = { href: "https://local.invalid" + target };
  to.win.history = { state: {}, replaceState: (_state, _title, href) => { replaced = href; to.win.location.href = href; } };
  const second = loadBrowserModule("lib/cart-navigation.ts", to.win, {}, secondStorage);
  second.receiveTransferredGuestCart();
  assert.deepEqual(JSON.parse(secondStorage.browserLocalStorage.getItem("fanzzy-cart:guest")), { "fixture-product": 2 });
  assert.equal(new URL(replaced).hash, "");
  assert.equal(new URL(replaced).searchParams.get("fanzzy-cart-action"), "buy");
  second.receiveTransferredGuestCart();
  assert.equal(JSON.parse(secondStorage.browserLocalStorage.getItem("fanzzy-cart:guest"))["fixture-product"], 2);
});

test("cart transfer preserves large carts without truncating items", () => {
  const b = fakeWindow("blocked"), storage = loadBrowserStorage(b.win);
  const cart = Object.fromEntries(Array.from({ length: 150 }, (_, i) => ["product-" + String(i).padStart(3, "0") + "x".repeat(110), 2]));
  storage.browserLocalStorage.setItem("fanzzy-cart:guest", JSON.stringify(cart));
  const api = loadBrowserModule("lib/cart-navigation.ts", b.win, {}, storage);
  const url = new URL(api.storefrontCartUrl("view"), "https://local.invalid");
  assert.deepEqual(JSON.parse(new URLSearchParams(url.hash.slice(1)).get("fanzzy-cart-transfer")), cart);
});

test("catalog retries compact persistence when full image cache cannot fit", () => {
  const b = fakeWindow("normal"), storage = loadBrowserStorage(b.win);
  const nativeSet = b.win.localStorage.setItem;
  let attempts = 0;
  b.win.localStorage.setItem = (key, value) => {
    attempts++;
    if (value.includes("data:")) throw new DOMException("Storage full", "QuotaExceededError");
    nativeSet(key, value);
  };
  extractHandler("app/page.tsx", "persistStorefrontProductCache")({ window: b.win, ...storage, storefrontProductCacheKey: "catalog" })([
    { id: "product", image: "data:image/png;base64,fixture", variants: [] },
  ]);
  assert.equal(attempts, 2);
  assert.equal(JSON.parse(b.values.get("catalog"))[0].image, "");
  assert.equal(storage.browserLocalStorage.isPersistent("catalog"), true);
});

test("cart transfer rejects arbitrary values and never transfers tokens or prices", () => {
  const b = fakeWindow("blocked"), storage = loadBrowserStorage(b.win);
  storage.browserLocalStorage.setItem("fanzzy-cart:guest", '{"product":1,"token":"secret","price":-5,"bad/key":1,"huge":1000000}');
  const api = loadBrowserModule("lib/cart-navigation.ts", b.win, {}, storage);
  const url = new URL(api.storefrontCartUrl("view"), "https://local.invalid");
  const payload = JSON.parse(new URLSearchParams(url.hash.slice(1)).get("fanzzy-cart-transfer"));
  assert.deepEqual(payload, { product: 1 });
  assert.equal(url.search.includes("secret"), false);
});

test("application storage access cannot bypass the resilient adapter", () => {
  const failures = [];
  function scan(dir) {
    for (const entry of readdirSync(new URL("../" + dir, import.meta.url), { withFileTypes: true })) {
      const file = dir + "/" + entry.name;
      if (entry.isDirectory()) scan(file);
      else if (/\.(ts|tsx)$/.test(file) && file !== "lib/browser-storage.ts") {
        const text = readFileSync(new URL("../" + file, import.meta.url), "utf8");
        if (/window\.(localStorage|sessionStorage)/.test(text)) failures.push(file);
      }
    }
  }
  scan("app"); scan("lib");
  assert.deepEqual(failures, []);
});
