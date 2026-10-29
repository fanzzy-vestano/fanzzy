import { evaluateSalesPromotions, type PromotionBillContext, type PromotionBillLine, type SalesPromotion } from "./sales-promotions";

export type WebsiteOfferInput = {
  promotions: SalesPromotion[]; lines: PromotionBillLine[]; context?: PromotionBillContext;
  legacyCoupon: number; legacyPromotion: number; hasGroupedPromotion?: boolean;
  delivery: { enabled: boolean; amount: number; freeAboveEnabled: boolean; freeAbove: number }; pickup: boolean;
};
export const websitePromotionClock = (date = new Date()) => new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
/** Allocate a new automatic benefit across eligible merchandise for receipts and returns.
 * Split a quantity only when a one-paise remainder cannot be represented per unit.
 * Original product IDs, variants and total inventory quantities remain unchanged.
 */
export function allocateWebsiteOfferPrices(lines: PromotionBillLine[], promotion: SalesPromotion | undefined, discount: number) {
  const original = () => lines.map((line, index) => ({ index, quantity: line.quantity, price: line.price }));
  if (!promotion || discount <= 0) return original();
  const eligible = (line: PromotionBillLine) => promotion.type === "category"
    ? promotion.categoryNames?.some((name) => name.trim().toLowerCase() === line.category?.trim().toLowerCase())
    : promotion.type === "buy-x-y" ? promotion.rewardProductIds.includes(line.productId)
    : !promotion.productIds.length || promotion.productIds.includes(line.productId);
  const amounts = lines.map((line) => eligible(line) ? Math.round(line.price * 100) * line.quantity : 0);
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  const target = Math.round(discount * 100);
  if (target > total || !total) throw new Error("Offer allocation changed. Please review your cart.");
  const shares = amounts.map((amount) => Math.floor(target * amount / total));
  const ranked = amounts.map((amount, index) => ({ index, remainder: target * amount % total }))
    .filter(({ index }) => amounts[index] > 0).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  let remaining = target - shares.reduce((sum, amount) => sum + amount, 0);
  for (const { index } of ranked) { if (!remaining) break; shares[index]++; remaining--; }
  return lines.flatMap((line, index) => {
    const net = Math.round(line.price * 100) * line.quantity - shares[index];
    const unit = Math.floor(net / line.quantity);
    const remainder = net - unit * line.quantity;
    return [
      ...(line.quantity > remainder ? [{ index, quantity: line.quantity - remainder, price: unit / 100 }] : []),
      ...(remainder ? [{ index, quantity: remainder, price: (unit + 1) / 100 }] : []),
    ];
  });
}
/** Compare complete checkout totals without stacking new and legacy offers. */
export function calculateWebsiteSalesPromotion(input: WebsiteOfferInput) {
  const cents = (value: number) => Math.round(value * 100);
  const subtotal = input.lines.reduce((sum, line) => sum + cents(line.price) * line.quantity, 0);
  const shipping = (discount: number) => input.pickup || !input.delivery.enabled || (input.delivery.freeAboveEnabled && Math.max(0, subtotal - discount) >= cents(input.delivery.freeAbove)) ? 0 : cents(input.delivery.amount);
  const legacyCoupon = cents(input.legacyCoupon);
  const legacyPromotion = cents(input.legacyPromotion);
  let best = { couponDiscount: legacyCoupon / 100, promotionDiscount: legacyPromotion / 100, shippingTotal: shipping(legacyCoupon + legacyPromotion) / 100, offerId: "", offerName: "", firstPurchase: false };
  let bestTotal = Math.max(0, subtotal - cents(best.couponDiscount + best.promotionDiscount) + cents(best.shippingTotal));
  if (input.hasGroupedPromotion) return best;
  for (const promotion of input.promotions) {
    const isDelivery = promotion.type === "delivery";
    if (isDelivery && (input.pickup || shipping(0) <= 0)) continue;
    // POS uses a delivery product. Online checkout has a real shipping fee,
    // represented only for evaluation and never added as an inventory item.
    const shippingId = `__online_shipping__:${promotion.id}`;
    const lines = isDelivery ? [...input.lines, { productId: shippingId, price: shipping(0) / 100, quantity: 1 }] : input.lines;
    const result = evaluateSalesPromotions([isDelivery ? { ...promotion, productIds: [shippingId] } : promotion], lines, { ...input.context, now: websitePromotionClock(input.context?.now) });
    if (!result.promotion) continue;
    const merchandiseDiscount = isDelivery ? 0 : result.discount;
    const shippingTotal = isDelivery ? 0 : shipping(cents(merchandiseDiscount)) / 100;
    const total = subtotal - cents(merchandiseDiscount) + cents(shippingTotal);
    if (total >= bestTotal) continue;
    bestTotal = total;
    best = { couponDiscount: promotion.type === "coupon" ? merchandiseDiscount : 0, promotionDiscount: promotion.type === "coupon" ? 0 : merchandiseDiscount, shippingTotal, offerId: promotion.id, offerName: promotion.name, firstPurchase: promotion.type === "first" };
  }
  return best;
}
