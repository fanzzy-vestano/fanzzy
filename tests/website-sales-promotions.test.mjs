import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const modules = {};
async function load(name) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const fixtureModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((id) => { const dependency = modules[id.replace("./", "")]; if (!dependency) throw new Error(`Missing dependency ${id}`); return dependency; }, fixtureModule, fixtureModule.exports);
  return modules[name] = fixtureModule.exports;
}
const sales = await load("sales-promotions");
await load("promotional-offers");
const { calculateWebsiteSalesPromotion: calculate, websitePromotionClock, websiteProductOffer } = await load("website-sales-promotions");
const { validateWebsitePricing: validate } = await load("website-checkout-pricing");
const offer = (type, patch = {}) => ({ ...sales.newSalesPromotion(type), name: `Test ${type}`, value: 10, ...patch });
const product = { sku: "A", price: 100 };
test("product previews show free items and respect SKU, time and conditional offers", () => {
  const now = new Date("2026-10-28T09:45:00Z");
  const promotion = offer("percentage", { value: 100, productIds: ["A"], startTime: "15:02", endTime: "16:03" });
  assert.deepEqual(websiteProductOffer([promotion], { productId: "A", price: 100 }, now), { price: 0, discountPercent: 100, name: promotion.name });
  assert.equal(websiteProductOffer([promotion], { productId: "B", price: 100 }, now).price, 100);
  assert.equal(websiteProductOffer([promotion], { productId: "A", price: 100 }, new Date("2026-10-28T11:00:00Z")).price, 100);
  for (const p of [offer("first", { value: 100 }), offer("bogo", { value: 100 }), { ...promotion, minSpend: 200 }, { ...promotion, minQty: 2 }]) {
    assert.equal(websiteProductOffer([p], { productId: "A", price: 100 }, now).price, 100);
  }
});
const delivery = { enabled: true, amount: 30, freeAboveEnabled: false, freeAbove: 500 };
const input = (promotions, patch = {}) => ({ promotions, lines: [{ productId: "A", price: 100, quantity: 2 }], legacyCoupon: 0, legacyPromotion: 0, delivery, pickup: false, ...patch });
function settings(promotions) { return [{ key: "sales_promotions", value: JSON.stringify(promotions) }, { key: "delivery_charge", value: JSON.stringify(delivery) }, { key: "payment_methods", value: JSON.stringify({ online: true, cod: true, codCharge: 20 }) }]; }
const order = (patch = {}) => ({ id: "ORDER", paymentMethod: "online", fulfillmentMethod: "delivery", couponDiscount: 0, promotionDiscount: 20, shippingTotal: 30, codCharge: 0, total: "₹210", items: [{ productId: "A", quantity: 2, price: "₹100" }], ...patch });
test("online percentage discount agrees between cart and server and rejects tampering", () => {
  const p = offer("percentage"); const result = calculate(input([p]));
  assert.equal(result.promotionDiscount, 20); assert.equal(result.shippingTotal, 30);
  assert.equal(validate(order(), [product], settings([p])).salesOfferId, p.id);
  for (const patch of [{ total: "₹1" }, { promotionDiscount: 100 }, { shippingTotal: 0 }, { items: [{ productId: "A", quantity: 2, price: "₹1" }] }]) assert.throws(() => validate(order(patch), [product], settings([p])));
});

test("category discounts agree on product cards, cart and trusted checkout categories", () => {
  const p = offer("category", { categoryNames: ["Anklets"], value: 25 });
  const now = new Date("2026-10-28T09:45:00Z");
  assert.equal(websiteProductOffer([p], { productId: "A", category: "Anklets", price: 100 }, now).price, 75);
  assert.equal(calculate(input([p], { lines: [{ productId: "A", category: "Anklets", price: 100, quantity: 2 }] })).promotionDiscount, 50);
  assert.equal(validate(order({ promotionDiscount: 50, total: "₹180" }), [{ ...product, category: "Anklets" }], settings([p])).salesOfferId, p.id);
  assert.throws(() => validate(order({ promotionDiscount: 50, total: "₹180" }), [{ ...product, category: "Rings" }], settings([p])), /total changed/);
});
test("all merchandise offer families use their shared POS rules online", () => {
  const examples = [
    [offer("flat"), 20], [offer("rates", { productIds: ["A"], rates: { A: 75 } }), 50],
    [offer("spend-percent", { minSpend: 200 }), 20], [offer("spend-amount", { minSpend: 200 }), 10],
    [offer("quantity", { minQty: 2, maxQty: 1 }), 10], [offer("bogo", { value: 100 }), 100],
    [offer("tiers", { tiers: [{ quantity: 2, percentage: 15 }] }), 30],
    [offer("custom", { minQty: 2, minSpend: 200 }), 20],
  ];
  for (const [p, expected] of examples) assert.equal(calculate(input([p])).promotionDiscount, expected, p.type);
});
test("online bundle and buy/get require reward items to be in the cart", () => {
  const lines = [{ productId: "A", price: 100, quantity: 2 }, { productId: "B", price: 50, quantity: 1 }];
  const bundle = offer("bundle", { productIds: ["A", "B"], bundleQuantities: { A: 2, B: 1 }, value: 25 });
  assert.equal(calculate(input([bundle], { lines })).promotionDiscount, 25);
  const xy = offer("buy-x-y", { productIds: ["A"], rewardProductIds: ["B"], value: 100 });
  assert.equal(calculate(input([xy])).promotionDiscount, 0);
  assert.equal(calculate(input([xy], { lines })).promotionDiscount, 50);
});
test("free delivery waives the real shipping fee without adding inventory items", () => {
  const p = offer("delivery", { productIds: ["POS-DELIVERY"], minSpend: 200 });
  const result = calculate(input([p])); assert.equal(result.shippingTotal, 0); assert.equal(result.promotionDiscount, 0); assert.equal(result.offerId, p.id);
  assert.doesNotThrow(() => validate(order({ promotionDiscount: 0, shippingTotal: 0, total: "₹200" }), [product], settings([p])));
  assert.equal(calculate(input([p], { pickup: true })).offerId, "");
  assert.equal(calculate(input([p], { lines: [{ productId: "A", price: 100, quantity: 1 }] })).shippingTotal, 30);
});
test("best delivered total wins and offers never stack with existing discounts", () => {
  const percent = offer("percentage", { value: 20 }), freeDelivery = offer("delivery", { productIds: ["DELIVERY"] });
  const result = calculate(input([percent, freeDelivery])); assert.equal(result.offerId, percent.id); assert.equal(result.promotionDiscount, 40); assert.equal(result.shippingTotal, 30);
  assert.equal(calculate(input([percent], { legacyCoupon: 60 })).offerId, "");
  assert.equal(calculate(input([percent], { hasGroupedPromotion: true })).promotionDiscount, 0);
});
test("shipping free-above threshold is recomputed after discount", () => {
  const p = offer("percentage", { value: 10 });
  const result = calculate(input([p], { delivery: { ...delivery, freeAboveEnabled: true, freeAbove: 200 } }));
  // Losing ₹30 free delivery for a ₹20 discount is not the best offer.
  assert.equal(result.offerId, ""); assert.equal(result.shippingTotal, 0);
});
test("new coupon codes are validated by the server and inactive codes are rejected", () => {
  const p = offer("coupon", { couponCode: "SAVE_10", value: 10 });
  assert.doesNotThrow(() => validate(order({ coupon: "SAVE_10", couponDiscount: 10, promotionDiscount: 0, total: "₹220" }), [product], settings([p])));
  assert.throws(() => validate(order({ coupon: "FAKE" }), [product], settings([p])), /Coupon/);
  assert.throws(() => validate(order({ coupon: "SAVE_10" }), [product], settings([{ ...p, status: "Paused" }])), /coupon/i);
});
test("first purchase is denied without verified history or for returning customers", () => {
  const p = offer("first");
  assert.throws(() => validate(order(), [product], settings([p])), /total changed/);
  const context = { customerPhone: "9876543210", historyAvailable: true, previousCustomerPhones: [] };
  assert.equal(validate(order(), [product], settings([p]), context).firstPurchase, true);
  assert.throws(() => validate(order(), [product], settings([p]), { ...context, previousCustomerPhones: ["9876543210"] }), /total changed/);
});
test("happy-hour schedules use the same India store clock on client and server", () => {
  const p = offer("happy-hour"); const now = new Date("2026-10-28T11:30:00Z");
  assert.equal(websitePromotionClock(now).getHours(), 17);
  assert.equal(calculate(input([p], { context: { now } })).promotionDiscount, 20);
  assert.equal(calculate(input([p], { context: { now: new Date("2026-10-28T14:00:00Z") } })).promotionDiscount, 0);
});
test("legacy discounts cannot push merchandise below zero", () => {
  const result = calculate(input([], { legacyCoupon: 150, legacyPromotion: 100 }));
  assert.equal(result.couponDiscount + result.promotionDiscount, 200);
});
test("online delivery discounts do not confuse a merchandise SKU with the POS fee product", () => {
  const p = offer("delivery", { productIds: ["A"], minSpend: 200 });
  assert.equal(calculate(input([p])).shippingTotal, 0);
});

async function loadOffersRoute(identity, history, promotions, failure = false) {
  const source = await readFile(new URL("../app/api/offers/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const fixtureModule = { exports: {} };
  const imports = { "../../../lib/customer-sms-auth": { getCustomerSession: () => identity }, "../../../lib/razorpay-payment-sync": { websitePromotionCustomerContext: async () => history }, "../../../lib/sales-promotions": sales };
  new Function("require", "module", "exports", "process", "fetch", compiled)((id) => imports[id], fixtureModule, fixtureModule.exports, { env: { SUPABASE_URL: "https://isolated.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture" } }, async () => failure ? new Response("unavailable", { status: 503 }) : Response.json([{ value: JSON.stringify(promotions) }]));
  return fixtureModule.exports;
}
test("public offers exclude drafts and paused rules and never expose customer history", async () => {
  const route = await loadOffersRoute(null, null, [offer("percentage"), offer("percentage", { status: "Draft" }), offer("percentage", { status: "Paused" }), offer("coupon", { couponCode: "PRIVATE10" })]);
  const response = await route.GET(new Request("https://isolated.invalid/offers"));
  const body = await response.json(); assert.equal(body.promotions.length, 1); assert.equal(body.firstPurchaseEligible, false);
  assert.match(response.headers.get("cache-control"), /private, no-store/); assert.equal(body.previousCustomerPhones, undefined);
});
test("first-purchase preview uses only authenticated authoritative eligibility", async () => {
  for (const prior of [[], ["9876543210"]]) {
    const route = await loadOffersRoute({ id: "customer", phone: "9876543210" }, { historyAvailable: true, previousCustomerPhones: prior }, [offer("first")]);
    const body = await (await route.GET(new Request("https://isolated.invalid/offers"))).json();
    assert.equal(body.firstPurchaseEligible, prior.length === 0);
  }
});
test("public offers report storage failures instead of serving stale discounts", async () => {
  const route = await loadOffersRoute(null, null, [], true);
  assert.equal((await route.GET(new Request("https://isolated.invalid/offers"))).status, 503);
});
