export const salesPromotionTypes = [
  ["percentage", "% off items", "Take a percentage off selected products.", "Price & basket"],
  ["flat", "Flat amount off items", "Reduce the price of each eligible unit.", "Price & basket"],
  ["rates", "Product-wise offer rates", "Set a different offer selling rate for every selected product.", "Price & basket"],
  ["spend-percent", "Spend & save %", "Reward a minimum basket spend with a percentage.", "Price & basket"],
  ["spend-amount", "Spend & save amount", "Give a fixed saving above a basket threshold.", "Price & basket"],
  ["quantity", "Fixed quantity offer", "Discount a limited quantity after a minimum purchase.", "Buy more, save more"],
  ["bogo", "BOGO · same products", "Buy and reward items from the same selection.", "Buy more, save more"],
  ["buy-x-y", "Buy X, get Y", "Buy one selection and reward a different selection.", "Buy more, save more"],
  ["bundle", "Bundle offer", "Combine specified quantities into a discounted bundle.", "Buy more, save more"],
  ["tiers", "Quantity tiers", "Increase savings as customers buy more of an item.", "Buy more, save more"],
  ["delivery", "Free delivery over X", "Waive a delivery charge item above a minimum spend.", "Customer & checkout"],
  ["first", "First purchase offer", "Welcome a customer on their first recorded purchase.", "Customer & checkout"],
  ["happy-hour", "Happy hour", "Offer savings during a daily time window.", "Customer & checkout"],
  ["coupon", "Coupon code", "Unlock a discount with a code at checkout.", "Customer & checkout"],
  ["custom", "Custom promotion", "Combine product, quantity and spend conditions.", "Customer & checkout"],
  ["category", "Offer by category", "Take a percentage off every product in selected categories.", "Price & basket"],
] as const;
export type SalesPromotionType = typeof salesPromotionTypes[number][0];
export type SalesPromotionStatus = "Draft" | "Active" | "Scheduled" | "Paused";
export const promotionDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export type SalesPromotion = {
  id: string; type: SalesPromotionType; name: string; status: SalesPromotionStatus;
  startDate: string; endDate: string; startTime: string; endTime: string; days: string[];
  discountMode: "percentage" | "amount"; value: number; minSpend: number; minQty: number; maxQty: number; buyQty: number; rewardQty: number;
  productIds: string[]; rewardProductIds: string[]; rates: Record<string, number>; bundleQuantities: Record<string, number>;
  categoryNames?: string[];
  tiers: Array<{ quantity: number; percentage: number }>; couponCode: string; createdAt: string; updatedAt: string;
};
export const newSalesPromotion = (type: SalesPromotionType): SalesPromotion => ({
  id: `promotion-${globalThis.crypto.randomUUID()}`, type, name: "", status: "Active", startDate: "", endDate: "",
  startTime: type === "happy-hour" ? "16:00" : "", endTime: type === "happy-hour" ? "19:00" : "", days: [...promotionDays],
  discountMode: ["flat", "spend-amount", "bundle", "coupon"].includes(type) ? "amount" : "percentage", value: ["bogo", "buy-x-y"].includes(type) ? 100 : 0,
  minSpend: 0, minQty: 1, maxQty: 1, buyQty: 1, rewardQty: 1, productIds: [], rewardProductIds: [], categoryNames: [], rates: {}, bundleQuantities: {},
  tiers: [{ quantity: 3, percentage: 5 }, { quantity: 6, percentage: 10 }], couponCode: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});
export const promotionDefinition = (type: string) => salesPromotionTypes.find((item) => item[0] === type)!;
const money = (amount: number) => Math.round(amount * 100);
const cash = (amount: number) => `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export function salesPromotionBenefit(p: SalesPromotion) {
  if (p.type === "category") return `${p.value}% off ${(p.categoryNames || []).join(", ") || "selected categories"}`;
  const benefit = p.discountMode === "percentage" ? `${p.value}% off` : `${cash(p.value)} off`;
  if (p.type === "flat") return `${cash(p.value)} off per unit`;
  if (p.type === "rates") return `${p.productIds.length} products with individual offer rates`;
  if (p.type === "bogo" || p.type === "buy-x-y") return `Buy ${p.buyQty}, get ${p.rewardQty} at ${p.value}% off`;
  if (p.type === "quantity") return `Buy ${p.minQty}+; ${benefit} on up to ${p.maxQty} units`;
  if (p.type === "tiers") return p.tiers.map((tier) => `${tier.quantity}+ units: ${tier.percentage}% off`).join(" · ");
  if (p.type === "delivery") return `Free delivery on merchandise of ${cash(p.minSpend)} or more`;
  if (p.type === "first") return `${benefit} on first purchase`;
  if (p.type === "coupon") return `${p.couponCode || "Coupon"} · ${benefit}`;
  if (p.type === "bundle") return `${benefit} per bundle`;
  return benefit;
}
export function validateSalesPromotion(p: SalesPromotion): string {
  if (!p.name.trim()) return "Enter an offer name.";
  if (![p.productIds, p.rewardProductIds, p.days, p.tiers].every(Array.isArray) || !p.rates || typeof p.rates !== "object" || !p.bundleQuantities || typeof p.bundleQuantities !== "object") return "Promotion selections are invalid.";
  if ([p.productIds, p.rewardProductIds].some((ids) => ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length)) return "Choose unique products with valid IDs.";
  if (!salesPromotionTypes.some(([type]) => type === p.type)) return "Choose a valid promotion type.";
  if (p.type === "category" && (p.discountMode !== "percentage" || !Array.isArray(p.categoryNames) || !p.categoryNames.length || p.categoryNames.some((name) => typeof name !== "string" || !name.trim()) || new Set(p.categoryNames.map((name) => name.trim().toLowerCase())).size !== p.categoryNames.length)) return "Choose at least one category for the percentage offer.";
  if (!["Draft", "Active", "Scheduled", "Paused"].includes(p.status)) return "Choose a valid status.";
  const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
  if ((p.startDate && !validDate(p.startDate)) || (p.endDate && !validDate(p.endDate))) return "Enter valid schedule dates.";
  if (p.startDate && p.endDate && p.endDate < p.startDate) return "End date must be on or after start date.";
  if (Boolean(p.startTime) !== Boolean(p.endTime)) return "Choose both start and end times, or leave both empty.";
  if ([p.startTime, p.endTime].some((time) => time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) return "Enter valid schedule times.";
  if (p.startTime && p.startTime === p.endTime) return "Start and end times must differ.";
  if (!p.days.length || p.days.some((day) => !promotionDays.includes(day))) return "Select at least one valid active day.";
  if (p.status === "Scheduled" && !p.startDate) return "Choose a start date for a scheduled offer.";
  if (!Number.isFinite(p.minSpend) || p.minSpend < 0) return "Minimum spend cannot be negative.";
  if (!["rates", "tiers", "delivery"].includes(p.type) && (!Number.isFinite(p.value) || p.value <= 0 || ((p.discountMode === "percentage" || ["bogo", "buy-x-y"].includes(p.type)) && p.value > 100))) return "Enter a positive discount; percentages cannot exceed 100.";
  if ([p.minQty, p.maxQty, p.buyQty, p.rewardQty].some((value) => !Number.isSafeInteger(value) || value < 1)) return "Quantities must be positive whole numbers.";
  if (p.type === "happy-hour" && !p.startTime) return "Choose a daily start and end time.";
  if (p.type === "coupon" && !/^[A-Z0-9_-]{2,40}$/i.test(p.couponCode)) return "Enter a coupon code of 2–40 letters, numbers, hyphens or underscores.";
  if (p.type === "rates" && (!p.productIds.length || p.productIds.some((id) => !Number.isFinite(p.rates[id]) || p.rates[id] < 0))) return "Select products and enter a non-negative offer rate for each.";
  if (p.type === "bundle" && (p.productIds.length < 2 || p.productIds.some((id) => !Number.isSafeInteger(p.bundleQuantities[id]) || p.bundleQuantities[id] < 1))) return "Choose at least two bundle products and their quantities.";
  if (p.type === "buy-x-y" && (!p.productIds.length || !p.rewardProductIds.length || p.productIds.some((id) => p.rewardProductIds.includes(id)))) return "Choose separate qualifying and reward product selections.";
  if (p.type === "delivery" && p.productIds.length !== 1) return "Choose one delivery charge product.";
  if (p.type === "tiers" && (!p.tiers.length || p.tiers.some((tier) => !Number.isSafeInteger(tier.quantity) || tier.quantity < 1 || !Number.isFinite(tier.percentage) || tier.percentage <= 0 || tier.percentage > 100) || new Set(p.tiers.map((tier) => tier.quantity)).size !== p.tiers.length)) return "Tiers need unique positive quantities and discounts up to 100%.";
  return "";
}
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export function salesPromotionStatus(p: SalesPromotion, now = new Date()): SalesPromotionStatus {
  if (p.status === "Draft" || p.status === "Paused") return p.status;
  const date = localDate(now);
  if (p.startDate && date < p.startDate) return "Scheduled";
  if (p.endDate && date > p.endDate) return "Paused";
  if (p.status === "Scheduled" && date === p.startDate && p.startTime && `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` < p.startTime) return "Scheduled";
  return "Active";
}
export function salesPromotionApplies(p: SalesPromotion, now: Date) {
  if (salesPromotionStatus(p, now) !== "Active") return false;
  const current = now.getHours() * 60 + now.getMinutes();
  const time = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  let day = now.getDay();
  if (p.startTime && p.endTime) {
    const start = time(p.startTime), end = time(p.endTime);
    if (end > start) { if (current < start || current >= end) return false; }
    else { if (current >= end && current < start) return false; if (current < end) day = (day + 6) % 7; }
  }
  return p.days.includes(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]);
}
export type PromotionBillLine = { productId: string; category?: string; price: number; quantity: number };
export type PromotionBillContext = { couponCode?: string; customerPhone?: string; previousCustomerPhones?: string[]; now?: Date; historyAvailable?: boolean };
export function evaluateSalesPromotions(promotions: SalesPromotion[], lines: PromotionBillLine[], context: PromotionBillContext = {}) {
  let best: { promotion: SalesPromotion | null; discount: number } = { promotion: null, discount: 0 };
  const bill = lines.filter((line) => Number.isFinite(line.price) && line.price >= 0 && Number.isSafeInteger(line.quantity) && line.quantity > 0);
  const total = bill.reduce((sum, line) => sum + money(line.price) * line.quantity, 0);
  const phone = (value: string) => value.replace(/\D/g, "").slice(-10);
  for (const p of promotions) {
    if (validateSalesPromotion(p) || !salesPromotionApplies(p, context.now || new Date())) continue;
    if (p.type === "coupon" && p.couponCode.toUpperCase() !== context.couponCode?.trim().toUpperCase()) continue;
    if (p.type === "first" && (!context.historyAvailable || phone(context.customerPhone || "").length < 10 || context.previousCustomerPhones?.some((value) => phone(value) === phone(context.customerPhone!)))) continue;
    const eligible = bill.filter((line) => p.type === "category" ? p.categoryNames?.some((name) => name.trim().toLowerCase() === line.category?.trim().toLowerCase()) : !p.productIds.length || p.productIds.includes(line.productId));
    const base = eligible.reduce((sum, line) => sum + money(line.price) * line.quantity, 0);
    const quantity = eligible.reduce((sum, line) => sum + line.quantity, 0);
    const merchandise = p.type === "delivery" ? total - base : total;
    if (merchandise < money(p.minSpend) || quantity < p.minQty) continue;
    const reward = (amount: number, count = 1) => p.discountMode === "percentage" ? Math.round(amount * p.value / 100) : Math.min(amount, money(p.value) * count);
    const cheapest = (items: PromotionBillLine[], count: number) => [...items].sort((a, b) => a.price - b.price).reduce((sum, line) => { const used = Math.min(count, line.quantity); count -= used; return sum + money(line.price) * used; }, 0);
    let discount = 0;
    switch (p.type) {
      case "category": case "percentage": case "happy-hour": discount = Math.round(base * p.value / 100); break;
      case "flat": discount = eligible.reduce((sum, line) => sum + Math.min(money(line.price), money(p.value)) * line.quantity, 0); break;
      case "rates": discount = eligible.reduce((sum, line) => sum + Math.max(0, money(line.price) - money(p.rates[line.productId])) * line.quantity, 0); break;
      case "quantity": { const count = Math.min(quantity, p.maxQty); const units = [...eligible].sort((a, b) => a.price - b.price); let remaining = count; discount = units.reduce((sum, line) => { const used = Math.min(remaining, line.quantity); remaining -= used; return sum + reward(money(line.price), 1) * used; }, 0); break; }
      case "bogo": discount = Math.round(cheapest(eligible, Math.floor(quantity / (p.buyQty + p.rewardQty)) * p.rewardQty) * p.value / 100); break;
      case "buy-x-y": { const free = bill.filter((line) => p.rewardProductIds.includes(line.productId)); const sets = Math.min(Math.floor(quantity / p.buyQty), Math.floor(free.reduce((sum, line) => sum + line.quantity, 0) / p.rewardQty)); discount = Math.round(cheapest(free, sets * p.rewardQty) * p.value / 100); break; }
      case "bundle": { const sets = Math.min(...p.productIds.map((id) => Math.floor(bill.filter((line) => line.productId === id).reduce((sum, line) => sum + line.quantity, 0) / p.bundleQuantities[id]))); if (sets > 0) { const amount = p.productIds.reduce((sum, id) => sum + cheapest(bill.filter((line) => line.productId === id), p.bundleQuantities[id] * sets), 0); discount = reward(amount, sets); } break; }
      case "tiers": { const grouped = new Map<string, { quantity: number; amount: number }>(); for (const line of eligible) { const group = grouped.get(line.productId) || { quantity: 0, amount: 0 }; group.quantity += line.quantity; group.amount += money(line.price) * line.quantity; grouped.set(line.productId, group); } for (const group of grouped.values()) { const tier = [...p.tiers].sort((a, b) => b.quantity - a.quantity).find((tier) => group.quantity >= tier.quantity); if (tier) discount += Math.round(group.amount * tier.percentage / 100); } break; }
      case "delivery": discount = base; break;
      default: discount = reward(base);
    }
    discount = Math.min(total, Math.max(0, discount));
    if (discount > money(best.discount)) best = { promotion: p, discount: discount / 100 };
  }
  return best;
}
export function parseSalesPromotions(raw: string | null): SalesPromotion[] {
  try { const list: unknown = JSON.parse(raw || "[]"); return Array.isArray(list) ? list.filter((item): item is SalesPromotion => { try { return Boolean(item?.id && typeof item.name === "string" && !validateSalesPromotion(item)); } catch { return false; } }) : []; } catch { return []; }
}
