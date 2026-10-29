import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../lib/sales-promotions.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { newSalesPromotion, evaluateSalesPromotions: evaluate, salesPromotionStatus, validateSalesPromotion, salesPromotionApplies } = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
const now = new Date(2026, 9, 28, 17, 0);
const offer = (type, fields = {}) => ({ ...newSalesPromotion(type), name: type, value: 10, ...fields });
const line = (productId, price, quantity = 1) => ({ productId, price, quantity });
const amount = (promotion, lines, context = {}) => evaluate([promotion], lines, { now, ...context }).discount;
test("percentage and flat discounts respect scope and cap each unit", () => {
  assert.equal(amount(offer("percentage", { productIds: ["A"] }), [line("A", 100, 2), line("B", 200)]), 20);
  assert.equal(amount(offer("flat", { value: 50 }), [line("A", 20, 2), line("B", 100)]), 90);
});

test("category offers follow category membership, including newly added products", () => {
  const p = offer("category", { categoryNames: ["Anklets"], value: 25 });
  const lines = [{ ...line("A", 100, 2), category: "Anklets" }, { ...line("B", 200), category: "Rings" }];
  assert.equal(amount(p, lines), 50);
  assert.equal(amount(p, [...lines, { ...line("NEW", 80), category: " anklets " }]), 70);
  assert.equal(amount(p, [line("UNKNOWN", 100)]), 0);
  assert.match(validateSalesPromotion({ ...p, categoryNames: [] }), /category/);
  assert.match(validateSalesPromotion({ ...p, value: 101 }), /100/);
});
test("per-product rates handle quantities and never increase prices", () => {
  assert.equal(amount(offer("rates", { productIds: ["A", "B"], rates: { A: 80, B: 150 } }), [line("A", 100, 2), line("B", 100)]), 40);
});
test("spend rewards use the merchandise threshold and do not exceed the bill", () => {
  assert.equal(amount(offer("spend-percent", { minSpend: 200 }), [line("A", 199)]), 0);
  assert.equal(amount(offer("spend-percent", { minSpend: 200 }), [line("A", 100, 2)]), 20);
  assert.equal(amount(offer("spend-amount", { minSpend: 200, value: 500 }), [line("A", 100, 2)]), 200);
});
test("fixed quantities reward the cheapest limited eligible units", () => {
  const p = offer("quantity", { minQty: 3, maxQty: 2, value: 50 });
  assert.equal(amount(p, [line("A", 100), line("B", 40)]), 0);
  assert.equal(amount(p, [line("A", 100), line("B", 40, 2)]), 40);
});
test("same-product BOGO repeats complete sets and rewards the cheapest units", () => {
  const p = offer("bogo", { value: 100, buyQty: 1, rewardQty: 1 });
  assert.equal(amount(p, [line("A", 100)]), 0);
  assert.equal(amount(p, [line("A", 100, 2), line("B", 50, 3)]), 100);
});
test("Buy X get Y requires separate products and complete reward quantities", () => {
  const p = offer("buy-x-y", { productIds: ["A"], rewardProductIds: ["B"], buyQty: 2, rewardQty: 2, value: 100 });
  assert.equal(amount(p, [line("A", 100, 4), line("B", 50)]), 0);
  assert.equal(amount(p, [line("A", 100, 4), line("B", 50, 3)]), 100);
  assert.match(validateSalesPromotion({ ...p, rewardProductIds: ["A"] }), /separate/);
});
test("bundles require each product quantity and repeat flat saving per full set", () => {
  const p = offer("bundle", { productIds: ["A", "B"], bundleQuantities: { A: 2, B: 1 }, value: 50 });
  assert.equal(amount(p, [line("A", 100), line("B", 50)]), 0);
  assert.equal(amount(p, [line("A", 100, 4), line("B", 50, 3)]), 100);
  assert.equal(amount({ ...p, discountMode: "percentage", value: 10 }, [line("A", 100, 4), line("B", 50, 3)]), 50);
});
test("tiers aggregate variants per product and use the highest qualifying break", () => {
  const p = offer("tiers");
  assert.equal(amount(p, [line("A", 100, 3), line("A", 200, 3), line("B", 50, 2)]), 90);
});
test("free delivery excludes delivery line from minimum merchandise spend", () => {
  const p = offer("delivery", { productIds: ["SHIPPING"], minSpend: 200 });
  assert.equal(amount(p, [line("A", 190), line("SHIPPING", 30)]), 0);
  assert.equal(amount(p, [line("A", 200), line("SHIPPING", 30)]), 30);
});
test("first purchase requires a phone and verified available purchase history", () => {
  const p = offer("first");
  assert.equal(amount(p, [line("A", 100)], { customerPhone: "9876543210" }), 0);
  assert.equal(amount(p, [line("A", 100)], { customerPhone: "9876543210", historyAvailable: true, previousCustomerPhones: [] }), 10);
  assert.equal(amount(p, [line("A", 100)], { customerPhone: "+91 9876543210", historyAvailable: true, previousCustomerPhones: ["9876543210"] }), 0);
});
test("happy hour is start-inclusive and end-exclusive", () => {
  const p = offer("happy-hour");
  assert.equal(amount(p, [line("A", 100)], { now: new Date(2026, 9, 28, 16) }), 10);
  assert.equal(amount(p, [line("A", 100)], { now: new Date(2026, 9, 28, 19) }), 0);
});
test("coupon matching is case-insensitive and absent codes do not qualify", () => {
  const p = offer("coupon", { couponCode: "WELCOME" });
  assert.equal(amount(p, [line("A", 100)]), 0);
  assert.equal(amount(p, [line("A", 100)], { couponCode: "welcome" }), 10);
});
test("custom combines product, spend, quantity and reward conditions", () => {
  const p = offer("custom", { productIds: ["A"], minSpend: 250, minQty: 2, value: 20 });
  assert.equal(amount(p, [line("A", 100), line("B", 200)]), 0);
  assert.equal(amount(p, [line("A", 100, 2), line("B", 50)]), 40);
});
test("best offer wins once per bill, with deterministic ties", () => {
  const first = offer("percentage", { value: 20 }), second = offer("flat", { value: 15 });
  const result = evaluate([first, second], [line("A", 100)], { now });
  assert.equal(result.discount, 20); assert.equal(result.promotion.id, first.id);
});
test("draft, paused, future and expired offers do not apply", () => {
  for (const fields of [{ status: "Draft" }, { status: "Paused" }, { startDate: "2027-01-01" }, { endDate: "2026-01-01" }]) assert.equal(amount(offer("percentage", fields), [line("A", 100)]), 0);
  assert.equal(salesPromotionStatus(offer("percentage", { status: "Scheduled", startDate: "2026-10-28", startTime: "16:00", endTime: "19:00" }), now), "Active");
});
test("overnight schedules use the day on which the window started", () => {
  const p = offer("percentage", { startTime: "22:00", endTime: "02:00", days: ["Wed"] });
  assert.equal(salesPromotionApplies(p, new Date(2026, 9, 29, 1)), true);
  assert.equal(salesPromotionApplies(p, new Date(2026, 9, 29, 2)), false);
});
test("invalid rules fail closed without negative or non-finite discounts", () => {
  for (const fields of [{ value: 101 }, { value: NaN }, { days: [] }, { minQty: 1.5 }, { startTime: "12:00" }]) assert.equal(amount(offer("percentage", fields), [line("A", 100)]), 0);
  assert.match(validateSalesPromotion(offer("percentage", { startDate: "2026-99-99" })), /valid schedule/);
});

const storeSource = await readFile(new URL("../lib/sales-promotions-store.ts", import.meta.url), "utf8");
const storeOutput = ts.transpileModule(storeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const engine = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
function storeFixture({ local = false, remoteValue = null, offline = false, cached = null } = {}) {
  const cache = new Map(cached ? [["fanzzy-sales-promotions", cached]] : []), writes = [], events = [];
  const fixtureModule = { exports: {} };
  const catalog = { fetchStoreSetting: async () => ({ value: remoteValue, error: offline ? new Error("offline") : null }), saveStoreSetting: async (key, value) => { writes.push({ key, value }); return offline ? new Error("offline") : null; } };
  new Function("require", "module", "exports", "window", "process", storeOutput)((name) => name === "./supabase/catalog" ? catalog : name === "./browser-storage" ? { browserLocalStorage: { getItem: (key) => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) } } : engine, fixtureModule, fixtureModule.exports, { localStorage: { getItem: (key) => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) }, dispatchEvent: (event) => events.push(event.type) }, { env: { NEXT_PUBLIC_FANZZY_ENV: local ? "local-test" : "production" } });
  return { ...fixtureModule.exports, cache, writes, events };
}
test("promotion saves use shared store settings and notify the POS", async () => {
  const store = storeFixture(); const p = offer("percentage");
  assert.deepEqual(await store.saveSalesPromotions([p]), { local: false });
  assert.equal(store.writes[0].key, "salesPromotions");
  assert.equal(JSON.parse(store.writes[0].value)[0].id, p.id);
  assert.deepEqual(store.events, ["fanzzy-sales-promotions-updated"]);
});
test("production save failure cannot silently activate a local-only promotion", async () => {
  const store = storeFixture({ offline: true });
  await assert.rejects(store.saveSalesPromotions([offer("percentage")]), /Could not save/);
  assert.equal(store.cache.size, 0); assert.equal(store.events.length, 0);
});
test("local test mode supports saving and reloading promotions offline", async () => {
  const store = storeFixture({ local: true, offline: true }); const p = offer("percentage");
  assert.deepEqual(await store.saveSalesPromotions([p]), { local: true });
  const loaded = await store.loadSalesPromotions();
  assert.equal(loaded.promotions[0].id, p.id); assert.equal(loaded.local, true);
});
test("shared empty list replaces cached offers after deletion on another device", async () => {
  const store = storeFixture({ remoteValue: "[]", cached: JSON.stringify([offer("percentage")]) });
  assert.equal((await store.loadSalesPromotions()).promotions.length, 0);
  assert.equal(store.cache.get("fanzzy-sales-promotions"), "[]");
});
