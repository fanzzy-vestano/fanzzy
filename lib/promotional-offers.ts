export type PromotionOfferType =
  | "bogo"
  | "bundle"
  | "cheapest-free";

export type PromotionOfferStatus = "Active" | "Inactive" | "Archived";

export type PromotionSelection = {
  productId: string;
  sku?: string;
  variantName?: string;
  variantId?: string;
  size?: string;
  colour?: string;
  price?: number;
  stock?: number;
};

export type PromotionOffer = {
  id: string;
  name: string;
  description: string;
  type: PromotionOfferType;
  buyQuantity: number;
  freeQuantity: number;
  bundleQuantity: number;
  fixedBundlePrice: number;
  startsAt: string;
  endsAt: string;
  status: PromotionOfferStatus;
  automatic: boolean;
  couponCode?: string;
  allowOtherCoupons: boolean;
  allowOtherDiscounts: boolean;
  allowMultipleQualifyingSets: boolean;
  minCartValue: number;
  perCustomerLimit: number;
  maxTotalUsage: number;
  usageCount: number;
  allowMixVariants: boolean;
  allowDifferentColours: boolean;
  allowDifferentSizes: boolean;
  allowSameVariantMultipleTimes: boolean;
  maxQuantityPerVariant: number;
  requireExactFreeQuantity: boolean;
  allowDifferentProducts: boolean;
  autoSelectOnlyOption: boolean;
  allowMixProducts: boolean;
  allowMultipleBundles: boolean;
  eligiblePaid: PromotionSelection[];
  eligibleFree: PromotionSelection[];
  createdAt: string;
  updatedAt: string;
};

export const promotionStorageKey = "fanzzy-promotional-offers";

export const defaultPromotionForm = () => ({
  name: "",
  description: "",
  type: "bogo" as PromotionOfferType,
  buyQuantity: 1,
  freeQuantity: 1,
  bundleQuantity: 3,
  fixedBundlePrice: 99,
  startsAt: new Date().toISOString().slice(0, 16),
  endsAt: "",
  status: "Inactive" as PromotionOfferStatus,
  automatic: true,
  couponCode: "",
  allowOtherCoupons: false,
  allowOtherDiscounts: false,
  allowMultipleQualifyingSets: true,
  minCartValue: 0,
  perCustomerLimit: 0,
  maxTotalUsage: 0,
  allowMixVariants: true,
  allowDifferentColours: true,
  allowDifferentSizes: true,
  // Buy 1 Get X offers may give several copies of the same product option.
  // The storefront still checks live inventory before adding the offer.
  allowSameVariantMultipleTimes: true,
  maxQuantityPerVariant: 4,
  requireExactFreeQuantity: true,
  allowDifferentProducts: false,
  autoSelectOnlyOption: true,
  allowMixProducts: false,
  allowMultipleBundles: false,
  eligiblePaid: [] as PromotionSelection[],
  eligibleFree: [] as PromotionSelection[],
});

export const offerTypeLabel = (offer: Pick<PromotionOffer, "type" | "buyQuantity" | "freeQuantity" | "bundleQuantity" | "fixedBundlePrice">) => {
  if (offer.type === "bundle") return `Pick Any ${offer.bundleQuantity} for ₹${offer.fixedBundlePrice.toLocaleString("en-IN")}`;
  if (offer.type === "cheapest-free") return `Buy ${offer.buyQuantity} Get ${offer.freeQuantity} · Cheapest free`;
  return `Buy ${offer.buyQuantity} Get ${offer.freeQuantity}`;
};

export const isPromotionLive = (offer: Pick<PromotionOffer, "status" | "startsAt" | "endsAt" | "maxTotalUsage" | "usageCount">, now = new Date()) => {
  if (offer.status !== "Active") return false;
  if (offer.startsAt && new Date(offer.startsAt) > now) return false;
  if (offer.endsAt && new Date(offer.endsAt) < now) return false;
  if (offer.maxTotalUsage > 0 && offer.usageCount >= offer.maxTotalUsage) return false;
  return true;
};

export const selectionKey = (selection: PromotionSelection) => [
  selection.productId,
  selection.variantId || selection.variantName || "",
  selection.colour || "",
  selection.size || "",
].join("::").toLowerCase();

export const normalizePromotionOffer = (value: unknown): PromotionOffer | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PromotionOffer>;
  if (!raw.id || !raw.name) return null;
  const numberOr = (candidate: unknown, fallback = 0) => Number.isFinite(Number(candidate)) ? Number(candidate) : fallback;
  return {
    ...defaultPromotionForm(),
    ...raw,
    id: String(raw.id),
    name: String(raw.name),
    description: String(raw.description || ""),
    type: raw.type === "bundle" || raw.type === "cheapest-free" ? raw.type : "bogo",
    buyQuantity: Math.max(1, Math.floor(numberOr(raw.buyQuantity, 1))),
    freeQuantity: Math.max(1, Math.floor(numberOr(raw.freeQuantity, 1))),
    bundleQuantity: Math.max(2, Math.floor(numberOr(raw.bundleQuantity, 3))),
    fixedBundlePrice: Math.max(0, numberOr(raw.fixedBundlePrice, 99)),
    minCartValue: Math.max(0, numberOr(raw.minCartValue)),
    perCustomerLimit: Math.max(0, Math.floor(numberOr(raw.perCustomerLimit))),
    maxTotalUsage: Math.max(0, Math.floor(numberOr(raw.maxTotalUsage))),
    usageCount: Math.max(0, Math.floor(numberOr(raw.usageCount))),
    maxQuantityPerVariant: Math.max(1, Math.floor(numberOr(raw.maxQuantityPerVariant, 1))),
    eligiblePaid: Array.isArray(raw.eligiblePaid) ? raw.eligiblePaid : [],
    eligibleFree: Array.isArray(raw.eligibleFree) ? raw.eligibleFree : [],
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
  } as PromotionOffer;
};

export const validatePromotionSelection = (offer: PromotionOffer, paid: PromotionSelection[], free: PromotionSelection[]) => {
  const requiredPaid = offer.type === "bundle" ? offer.bundleQuantity : offer.buyQuantity;
  const requiredFree = offer.type === "bundle" ? 0 : offer.freeQuantity;
  if (paid.length !== requiredPaid) return `Select exactly ${requiredPaid} paid item${requiredPaid === 1 ? "" : "s"}.`;
  if (free.length !== requiredFree) return `Select exactly ${requiredFree} free item${requiredFree === 1 ? "" : "s"}.`;
  if (!offer.allowSameVariantMultipleTimes) {
    const keys = [...paid, ...free].map(selectionKey);
    if (new Set(keys).size !== keys.length) return "This offer does not allow the same variant more than once.";
  }
  const quantities = new Map<string, number>();
  [...paid, ...free].forEach((selection) => quantities.set(selectionKey(selection), (quantities.get(selectionKey(selection)) || 0) + 1));
  if (Array.from(quantities.values()).some((quantity) => quantity > offer.maxQuantityPerVariant)) return "The quantity limit for one of the selected variants was exceeded.";
  if (offer.minCartValue > 0 && paid.reduce((sum, item) => sum + (item.price || 0), 0) < offer.minCartValue) return `This offer requires a minimum cart value of ₹${offer.minCartValue.toLocaleString("en-IN")}.`;
  return null;
};

export const allocateBundlePrices = (items: PromotionSelection[], fixedPrice: number) => {
  const regularTotal = items.reduce((sum, item) => sum + Math.max(0, item.price || 0), 0);
  if (!regularTotal) return items.map(() => 0);
  const allocations = items.map((item) => Math.round((fixedPrice * Math.max(0, item.price || 0) / regularTotal) * 100) / 100);
  const drift = Math.round((fixedPrice - allocations.reduce((sum, price) => sum + price, 0)) * 100) / 100;
  if (allocations.length) allocations[allocations.length - 1] = Math.max(0, allocations[allocations.length - 1] + drift);
  return allocations;
};
