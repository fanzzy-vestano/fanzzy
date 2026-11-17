import { evaluateSalesPromotions, type PromotionBillContext, type PromotionBillLine, type SalesPromotion } from "./sales-promotions";

export type WebsiteOfferInput = {
  promotions: SalesPromotion[]; lines: PromotionBillLine[]; context?: PromotionBillContext;
  legacyCoupon: number; legacyPromotion: number; hasGroupedPromotion?: boolean;
  delivery: { enabled: boolean; amount: number; freeAboveEnabled: boolean; freeAbove: number }; pickup: boolean;
};
export const websitePromotionClock = (date = new Date()) => new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
/** Only unconditional item offers can advertise a single product's selling price. */
export function websiteProductOffer(promotions: SalesPromotion[], line: Omit<PromotionBillLine, "quantity">, now = new Date()) {
  const result = evaluateSalesPromotions(promotions.filter((p) => ["percentage", "flat", "rates", "happy-hour", "category"].includes(p.type) && p.minSpend === 0 && p.minQty === 1), [{ ...line, quantity: 1 }], { now: websitePromotionClock(now) });
  return { price: Math.max(0, Math.round((line.price - result.discount) * 100) / 100), discountPercent: line.price > 0 ? Math.round(result.discount / line.price * 100) : 0, name: result.promotion?.name || "" };
}
/** Shared rupee/paise calculation for the storefront and authoritative checkout. */
export function calculateWebsiteSalesPromotion(input: WebsiteOfferInput) {
  const cents = (value: number) => Math.round(value * 100);
  const subtotal = input.lines.reduce((sum, line) => sum + cents(line.price) * line.quantity, 0);
  const shipping = (discount: number) => input.pickup || !input.delivery.enabled || (input.delivery.freeAboveEnabled && Math.max(0, subtotal - discount) >= cents(input.delivery.freeAbove)) ? 0 : cents(input.delivery.amount);
  const legacyCoupon = Math.min(subtotal, Math.max(0, cents(input.legacyCoupon)));
  const legacyPromotion = Math.min(subtotal - legacyCoupon, Math.max(0, cents(input.legacyPromotion)));
  let best = { couponDiscount: legacyCoupon / 100, promotionDiscount: legacyPromotion / 100, shippingTotal: shipping(legacyCoupon + legacyPromotion) / 100, offerId: "", offerName: "", firstPurchase: false };
  let bestTotal = subtotal - cents(best.couponDiscount + best.promotionDiscount) + cents(best.shippingTotal);
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
