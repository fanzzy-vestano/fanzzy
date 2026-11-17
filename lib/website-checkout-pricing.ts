import { allocateBundlePrices, isPromotionLive, normalizePromotionOffer, validatePromotionSelection, type PromotionSelection } from "./promotional-offers";
import type { PublicCatalogProduct } from "./catalog/public-catalog-mapper";
import type { StoredOrder } from "./razorpay-payment-sync";
import { evaluateSalesPromotions, parseSalesPromotions, type PromotionBillContext } from "./sales-promotions";
import { calculateWebsiteSalesPromotion, websitePromotionClock } from "./website-sales-promotions";

type Setting = { key: string; value: string };
const normalize = (v: unknown) => String(v || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
const cents = (v: unknown) => Math.round(Number(String(v ?? "").replace(/[^0-9.-]/g, "")) * 100);

/** Uses the storefront's shared promotion allocation/selection rules. */
export function validateWebsitePricing(order: StoredOrder, products: PublicCatalogProduct[], settings: Setting[], customerContext: PromotionBillContext = {}) {
  const setting = (key: string, fallback: unknown = []) => {
    const value = settings.find((row) => row.key === key)?.value;
    return value === undefined ? fallback : JSON.parse(value);
  };
  const items = order.items || [];
  if (!items.length || items.length > 100) throw new Error("Valid checkout items are required.");
  const offers = (setting("promotional_offers") as unknown[]).map(normalizePromotionOffer).filter((offer) => offer !== null);
  const salesPromotions = parseSalesPromotions(settings.find((row) => row.key === "sales_promotions")?.value || null);
  const groups = new Map<string, NonNullable<StoredOrder["items"]>>();
  let subtotal = 0;
  for (const item of items) {
    const product = products.find((row) => normalize(row.sku) === normalize(item.productId));
    if (!product || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) throw new Error("Checkout product is unavailable.");
    item.productId = product.sku;
    if (!item.promotion && cents(item.price) !== Math.round(product.price * 100)) throw new Error("Checkout price changed.");
    if (item.promotion) {
      if (!item.promotion.groupId || !item.promotion.offerId || !["paid", "free", "bundle"].includes(item.promotion.role)) throw new Error("Promotion selection is invalid.");
      const list = groups.get(item.promotion.groupId) || [];
      list.push(item); groups.set(item.promotion.groupId, list);
    }
    if (!Number.isFinite(cents(item.price)) || cents(item.price) < 0) throw new Error("Checkout price is invalid.");
    subtotal += cents(item.price) * item.quantity;
    if (item.promotion) item.promotion = { ...item.promotion, regularPrice: product.price, linePrice: cents(item.price) / 100 };
  }
  const redemptions: Array<{ id: string; sets: number; maxTotalUsage: number; perCustomerLimit: number; usageCount: number }> = [];
  let expiresAt = Date.now() + 15 * 60 * 1000;
  for (const [groupId, group] of groups) {
    const offer = offers.find((row) => row.id === group[0].promotion?.offerId);
    if (!offer || !isPromotionLive(offer)) throw new Error("Promotion is no longer active.");
    if (group.some((item) => item.promotion?.offerId !== offer.id)) throw new Error("Promotion group is invalid.");
    if (offer.couponCode && order.coupon?.toUpperCase() !== offer.couponCode.toUpperCase()) throw new Error("Promotion coupon is required.");
    if (order.coupon && !offer.allowOtherCoupons && order.coupon.toUpperCase() !== offer.couponCode?.toUpperCase()) throw new Error("Promotion cannot be combined with this coupon.");
    const expanded = group.flatMap((item) => Array.from({ length: item.quantity }, () => item));
    const selection = (item: typeof group[number]): PromotionSelection => ({ productId: item.productId!, variantName: item.variantName, size: item.size,
      price: products.find((row) => row.sku === item.productId)!.price });
    const paid = expanded.filter((item) => item.promotion?.role === (offer.type === "bundle" ? "bundle" : "paid"));
    const free = expanded.filter((item) => item.promotion?.role === "free");
    const problem = validatePromotionSelection(offer, paid.map(selection), free.map(selection));
    if (problem) throw new Error(problem);
    for (const item of expanded) {
      const scope = item.promotion?.role === "free" ? offer.eligibleFree : offer.eligiblePaid;
      if (scope.length && !scope.some((allowed) => normalize(allowed.productId || allowed.sku) === normalize(item.productId)
        && (!allowed.variantName || allowed.variantName === item.variantName) && (!allowed.size || allowed.size === item.size))) throw new Error("Product is not eligible for this promotion.");
    }
    const allocated = offer.type === "bundle" ? allocateBundlePrices(paid.map(selection), offer.fixedBundlePrice).map((price) => Math.round(price * 100)) : paid.map((item) => Math.round(selection(item).price! * 100));
    for (let i = 0; i < paid.length; i++) if (cents(paid[i].price) !== allocated[i]) throw new Error("Promotion price allocation changed.");
    if (free.some((item) => cents(item.price) !== 0)) throw new Error("Promotion free-item price is invalid.");
    if (offer.endsAt) expiresAt = Math.min(expiresAt, Date.parse(offer.endsAt));
    redemptions.push({ id: offer.id, sets: 1, maxTotalUsage: offer.maxTotalUsage, perCustomerLimit: offer.perCustomerLimit, usageCount: offer.usageCount });
    void groupId;
  }
  const marketing = setting("marketing_records") as Array<Record<string, unknown>>;
  const agents = setting("agents") as Array<Record<string, unknown>>;
  let coupon = 0;
  if (order.coupon) {
    const code = normalize(order.coupon);
    const agent = agents.find((row) => row.status === "Active" && normalize(row.couponCode) === code);
    const record = marketing.find((row) => String(row.kind).toLowerCase() === "coupon" && row.status === "Active" && normalize(row.code) === code);
    const discount = agent ? `${Number(agent.discountPercent)}%` : String(record?.discount || "");
    const salesCoupon = salesPromotions.some((promotion) => promotion.type === "coupon" && promotion.couponCode.toUpperCase() === order.coupon?.trim().toUpperCase());
    if (!discount && !salesCoupon) throw new Error("Coupon is not active.");
    if (salesCoupon && !discount && !evaluateSalesPromotions(salesPromotions.filter((promotion) => promotion.type === "coupon"), items.map((item) => ({ productId: item.productId!, category: products.find((product) => product.sku === item.productId)?.category, price: cents(item.price) / 100, quantity: item.quantity })), { ...customerContext, now: websitePromotionClock(customerContext.now), couponCode: order.coupon }).promotion) throw new Error("This coupon is not eligible for this cart.");
    const percent = discount.match(/(\d+(?:\.\d+)?)\s*%/);
    const number = discount.replace(/,/g, "").match(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)|\b(\d+(?:\.\d+)?)\s*(?:₹|rs\.?|inr)\b/i) || discount.match(/^\s*(?:flat\s+)?(\d+(?:\.\d+)?)(?:\s*(?:off|discount))?\s*$/i);
    coupon = Math.min(subtotal, percent ? Math.round(subtotal * Math.min(100, Number(percent[1])) / 100) : Math.round(Number(number?.[1] || number?.[2] || 0) * 100));
  }
  const campaign = marketing.find((row) => row.status === "Active" && row.name);
  let promotionDiscount = 0;
  if (campaign && (campaign.offerType === "bogo" || /buy\s*(?:one|\d+)\s*(?:get|&)\s*(?:one|\d+)|bogo/i.test(`${campaign.name} ${campaign.detail} ${campaign.discount || ""}`))) {
    if (offers.some((offer) => redemptions.some((r) => r.id === offer.id) && !offer.allowOtherDiscounts)) throw new Error("These promotions cannot be combined.");
    const ids = Array.isArray(campaign.eligibleProductIds) ? new Set(campaign.eligibleProductIds.map(normalize)) : null;
    const eligible = items.flatMap((item) => ids?.size && !ids.has(normalize(item.productId)) ? [] : Array(item.quantity).fill(Math.round(products.find((row) => row.sku === item.productId)!.price * 100))).sort((a, b) => a - b);
    const buy = Math.min(3, Math.max(1, Number(campaign.buyQuantity) || 1));
    const get = Math.min(3, Math.max(1, Number(campaign.getQuantity) || 1));
    promotionDiscount = eligible.slice(0, Math.floor(eligible.length / (buy + get)) * get).reduce((sum, price) => sum + price, 0);
  }
  const payment = setting("payment_methods", null) as Record<string, unknown>;
  const delivery = setting("delivery_charge", null) as Record<string, unknown>;
  if (!payment || !delivery || !["cod", "online"].includes(order.paymentMethod || "") || payment[order.paymentMethod!] !== true) throw new Error("Selected payment method is unavailable.");
  const discounted = Math.max(0, subtotal - coupon - promotionDiscount);
  let shipping = 0;
  if (order.fulfillmentMethod === "pickup") {
    const hubs = setting("pickup_hubs") as Array<Record<string, unknown>>;
    if (!hubs.some((hub) => hub.id === order.pickupHubId && hub.active !== false)) throw new Error("Pickup hub is unavailable.");
  } else if (delivery.enabled === true && !(delivery.freeAboveEnabled === true && discounted >= cents(delivery.freeAbove))) shipping = cents(delivery.amount);
  const cod = order.paymentMethod === "cod" ? cents(payment.codCharge) : 0;
  const onlineOffer = calculateWebsiteSalesPromotion({ promotions: salesPromotions, lines: items.map((item) => ({ productId: item.productId!, category: products.find((product) => product.sku === item.productId)?.category, price: cents(item.price) / 100, quantity: item.quantity })), context: { ...customerContext, couponCode: order.coupon }, legacyCoupon: coupon / 100, legacyPromotion: promotionDiscount / 100, hasGroupedPromotion: groups.size > 0,
    delivery: { enabled: delivery.enabled === true, amount: cents(delivery.amount) / 100, freeAboveEnabled: delivery.freeAboveEnabled === true, freeAbove: cents(delivery.freeAbove) / 100 }, pickup: order.fulfillmentMethod === "pickup" });
  coupon = cents(onlineOffer.couponDiscount);
  promotionDiscount = cents(onlineOffer.promotionDiscount);
  shipping = cents(onlineOffer.shippingTotal);
  const finalDiscounted = Math.max(0, subtotal - coupon - promotionDiscount);
  if (cents(order.couponDiscount || 0) !== coupon || cents(order.promotionDiscount || 0) !== promotionDiscount
    || cents(order.shippingTotal || 0) !== shipping || cents(order.codCharge || 0) !== cod || cents(order.total) !== finalDiscounted + shipping + cod) throw new Error("Checkout total changed; refresh your cart.");
  if (onlineOffer.offerId) expiresAt = Math.min(expiresAt, Date.now() + 30_000);
  return { redemptions, expiresAt: new Date(expiresAt).toISOString(), firstPurchase: onlineOffer.firstPurchase, salesOfferId: onlineOffer.offerId };
}
