import { readFileSync } from "node:fs";
import ts from "typescript";

const root = new URL("../../", import.meta.url);
const page = readFileSync(new URL("app/page.tsx", root), "utf8");
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set([
  "isDemoOrder", "isPaidOrder", "normalizePhone", "belongsToCustomer", "isCustomerOrder", "ordersHaveSameData",
  "formatINR", "readRazorpayResponse", "decrementLocalInventory", "decrementLocalInventoryOnce",
  "persistConfirmedOrder", "persistPendingOrder", "submitCheckout",
]);
const declarations = [];
const effects = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.has(node.name.text)) {
    declarations.push("const " + node.getText(ast) + ";");
    names.delete(node.name.text);
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]) {
    const text = node.arguments[0].getText(ast);
    if (text.includes("const syncOrders =")) effects.history = text;
    if (text.includes("writeOptionalBrowserCache(cartStorageKey(ownerId)")) effects.cart = text;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (names.size || !effects.history || !effects.cart) throw Error("Missing checkout fixture source: " + [...names]);
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const modules = Object.fromEntries(["browser-storage", "order-history", "optional-browser-cache", "sales-promotions", "website-sales-promotions"].map(name => [name,
  compile(readFileSync(new URL("lib/" + name + ".ts", root), "utf8")),
]));
const checkoutCode = compile(declarations.join("\n") + "\nconst historyEffect = " + effects.history + ";\nconst cartEffect = " + effects.cart + ";");

// Executes the real page functions/effects and real order/cache modules.
// Only services and React setters are mocked. Shared by Node and browser tests.
function runtime(window, options = {}, modules, checkoutCode) {
  const state = { calls: [], toasts: [], opened: false, confirmation: null, orders: [], productUpdates: 0 };
  const customer = { id: "LOCAL-CUSTOMER", phone: "9000000000" };
  let saved = options.initialOrders ? structuredClone(options.initialOrders) : [];
  const mockFetch = async (url, init = {}) => {
    const route = String(url);
    const body = init.body ? JSON.parse(init.body) : {};
    state.calls.push({ route, method: init.method || "GET", body, headers: init.headers, cache: init.cache });
    if (route === "/orders/pending") {
      if (options.pendingNetworkError) throw Error("Backend connection failed");
      if (options.pendingStatus) return Response.json({ error: "Backend save rejected" }, { status: options.pendingStatus });
      if (options.pendingMalformed) return new Response("invalid JSON", { status: 200 });
      if (options.pendingReply) return Response.json(options.pendingReply);
      saved = [structuredClone(body.order), ...(body.preservedOrders || [])];
      return Response.json({ saved: true, order: saved[0] });
    }
    if (route === "/orders") {
      if (options.historyStatus && (options.failInitialHistory || saved.some(order => order.paymentStatus === "paid"))) return Response.json({ error: "History unavailable" }, { status: options.historyStatus });
      return Response.json({ orders: options.omitConfirmation ? [] : saved });
    }
    if (route === "/mock/reserve-stock") return Response.json({ reserved: true });
    if (route === "/mock/order") return Response.json({ id: "order_LOCAL", keyId: "LOCAL_FAKE_KEY", amount: 3900, currency: "INR" });
    if (route === "/mock/verify") {
      if (options.verifyFailure) return Response.json({ error: "Verification rejected" }, { status: 400 });
      saved = saved.map((order, index) => index === 0 ? { ...order, paymentStatus: "paid", razorpayPaymentId: body.razorpayPaymentId, inventoryAdjusted: true } : order);
      return Response.json({ verified: true, inventoryAdjusted: true });
    }
    if (route === "/orders/confirm-cod") {
      saved = saved.map((order, index) => index === 0 ? { ...order, paymentStatus: "cod_pending", inventoryAdjusted: true } : order);
      return Response.json({ confirmed: true, order: saved[0] });
    }
    if (route === "/mock/release-stock") return Response.json({ released: true });
    if (route === "/razorpay/sync-payments") return Response.json({ captured: 0 });
    throw Error("Unmocked network endpoint is forbidden: " + route);
  };
  const storage = {};
  new Function("exports", "window", modules["browser-storage"])(storage, window);
  function loadModule(code) {
    const exports = {};
    new Function("require", "exports", "window", code)(name => {
      if (name === "./site-api-client") return { customerApiFetch: mockFetch };
      if (name === "./browser-storage") return storage;
      if (name === "./sales-promotions") return salesPromotions;
      throw Error("Unmocked import: " + name);
    }, exports, window);
    return exports;
  }
  const customerOrders = loadModule(modules["order-history"]);
  const cache = loadModule(modules["optional-browser-cache"]);
  const salesPromotions = loadModule(modules["sales-promotions"]);
  const websitePromotions = loadModule(modules["website-sales-promotions"]);
  const product = { id: "LOCAL-PRODUCT", name: "Local product", price: 9, stock: 5, quantity: 1, image: "/fixture.png" };
  const websiteOfferInput = { lines: [{ productId: product.id, price: product.price, quantity: 1 }], legacyCoupon: 0, legacyPromotion: 0, delivery: { enabled: true, amount: 30, freeAboveEnabled: false, freeAbove: 500 }, pickup: false };
  const scope = {
    window, Event, ...storage, ...customerOrders, ...cache,
    ...websitePromotions, websiteOfferInput, websiteOffers: { promotions: [], context: {} },
    onlineOffer: websitePromotions.calculateWebsiteSalesPromotion({ ...websiteOfferInput, promotions: [] }),
    loadWebsiteOffers: async () => ({ promotions: [], context: {} }), salesCouponCode: "", checkingOffersRef: { current: false },
    setWebsiteOffers: () => {}, setOfferTime: () => {}, setCheckingOffers: () => {}, setSalesCouponCode: () => {},
    persistStorefrontProductCache: value => cache.writeOptionalBrowserCache("fanzzy-storefront-products-v2", value),
    fetchStoreOrders: async () => {
      const response = await mockFetch("/orders");
      const body = await response.json();
      return response.ok ? { data: body.orders, error: null } : { data: null, error: new Error(body.error) };
    },
    saveStoreOrders: async orders => {
      const response = await mockFetch("/orders/pending", { method: "POST", body: JSON.stringify({ order: orders[0], preservedOrders: orders.slice(1) }) });
      const body = await response.json();
      return response.ok ? null : new Error(body.error);
    },
    authUser: customer, orderRecoveryUser: { current: null }, ordersOpen: true, isPaying: false, cartStockIssues: [], cartHasSoldOutItems: false,
    paymentSettings: { online: true, cod: true }, paymentMethod: options.paymentMethod || "online",
    checkoutForm: { name: "Local Test", phone: customer.phone, email: "local@example.invalid", address: "Fixture", landmark: "Fixture", pincode: "600001" },
    fulfillmentMethod: "delivery", selectedPickupHub: null, orderTotal: 39, appliedCoupon: null,
    couponDiscount: 0, bogoDiscount: 0, deliveryTotal: 30, codTotal: 0, cartItems: [product], catalogProducts: [product],
    getCartLinePrice: p => p.price, getCustomerPrice: p => p.price,
    fetch: mockFetch, customerApiFetch: mockFetch, customerAuthorizedFetch: mockFetch, siteApiFetch: mockFetch,
    razorpayApiUrl: path => "/mock/" + path,
    loadRazorpayCheckout: async () => class {
      constructor(config) { state.providerOptions = config; }
      open() { state.opened = true; }
    },
    announce: text => state.toasts.push(text),
    setIsPaying: value => { scope.isPaying = value; state.paying = value; },
    setOrders: value => { state.orders = typeof value === "function" ? value(state.orders) : value; },
    setOrderConfirmation: value => { state.confirmation = value; },
    setCart: value => { state.cart = value; scope.cart = value; },
    setCartVariants: () => {}, setCartPromotionLines: () => {}, setCheckoutOpen: () => {},
    setFulfillmentMethod: () => {}, setSelectedPickupHubId: () => {}, setCheckoutForm: () => {},
    setCouponInput: () => {}, setAppliedCoupon: () => {}, setAuthMessage: () => {}, setAuthOpen: () => {}, setCheckoutErrors: () => {},
    setProducts: value => { state.productUpdates++; scope.catalogProducts = value; },
    localProductVariantsKey: "fanzzy-product-variants", localInventoryAdjustments: { current: new Set() },
    cartReadyOwner: customer.id, cartOwnerId: { current: customer.id }, cart: { "LOCAL-PRODUCT": 1 }, cartVariants: {}, cartSizes: {}, cartPromotionLines: {},
    cartStorageKey: owner => "fanzzy-cart:" + owner, cartVariantsStorageKey: owner => "fanzzy-cart-variants:" + owner,
    subscribeToStoreSetting: () => () => {},
  };
  const api = new Function("scope", "with (scope) { " + checkoutCode + "; return { submitCheckout, persistPendingOrder, persistConfirmedOrder, historyEffect, cartEffect, decrementLocalInventoryOnce }; }")(scope);
  return {
    ...api, ...customerOrders, ...cache, state, scope,
    savedOrders: () => structuredClone(saved),
    async completePayment() {
      state.providerOptions.handler({ razorpay_order_id: "order_LOCAL", razorpay_payment_id: "pay_LOCAL", razorpay_signature: "LOCAL_SIGNATURE" });
      for (let i = 0; i < 100 && !state.confirmation && !state.toasts.length; i++) await new Promise(resolve => setTimeout(resolve, 0));
    },
    async refreshOrders() {
      const cleanup = api.historyEffect();
      for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));
      cleanup();
    },
  };
}

export const createFixture = (window, options) => runtime(window, options, modules, checkoutCode);
export const fixtureFactorySource = "return function(window, options) { return (" + runtime.toString() + ")(window, options, " + JSON.stringify(modules) + ", " + JSON.stringify(checkoutCode) + "); };";
