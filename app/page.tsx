"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCatalogCategories,
  fetchCatalogProducts,
  fetchStoreOrders,
  fetchStoreSetting,
  saveStoreOrders,
  saveStoreSetting,
  subscribeToStoreSetting,
  type ProductVariantType,
} from "../lib/supabase/catalog";
import { printOrderBill } from "../lib/order-bill";
import {
  clearCustomerAuthTokens,
  clearPendingCustomerAuthToken,
  customerAuthRequest,
  readStoredCustomerAuthUser,
  saveCustomerAuthTokens,
} from "../lib/customer-auth-client";
import {
  allocateBundlePrices,
  isPromotionLive,
  normalizePromotionOffer,
  offerTypeLabel,
  promotionStorageKey,
  selectionKey,
  validatePromotionSelection,
  type PromotionOffer,
  type PromotionSelection,
} from "../lib/promotional-offers";

type CustomerAuthUser = { id: string; phone: string };

type Product = {
  id: string;
  sku?: string;
  name: string;
  category: string;
  stock: number;
  price: number;
  compareAt?: number;
  image: string;
  hoverImage: string;
  tag?: string;
  tone: string;
  variants?: ProductVariant[];
  sizes?: string[];
  sizeStock?: Record<string, number>;
  variantType?: ProductVariantType;
  billName?: string;
  imageAdjustments?: ImageAdjustments;
  hoverImageAdjustments?: ImageAdjustments;
};
type ImageAdjustments = { zoom: number; x: number; y: number; rotate: number };
type ProductVariant = { name: string; size?: string; image: string; stock?: number; adjustments?: ImageAdjustments };
type ProductImageAdjustments = {
  image?: ImageAdjustments;
  hoverImage?: ImageAdjustments;
  variants?: ImageAdjustments[];
};
type StorefrontPageHistoryState = {
  activeCategory: string;
  search: string;
  scrollY: number;
};
type DeliveryCharge = { enabled: boolean; amount: number; freeAboveEnabled: boolean; freeAbove: number };
type PickupHub = { id: string; name: string; place: string };
type FulfillmentMethod = "delivery" | "pickup";
type MarketingRecord = { kind: "Campaign" | "Coupon" | "Newsletter"; name: string; detail: string; status: "Active" | "Scheduled" | "Draft"; code?: string; discount?: string; offerType?: "bogo"; buyQuantity?: number; getQuantity?: number; eligibleProductIds?: string[] };
type PromotionCartLine = { groupId: string; offerId: string; role: "paid" | "free" | "bundle"; label: string; regularPrice: number; linePrice: number };
type OrderStatus = "Processing" | "Packed" | "Shipped" | "Delivered" | "Cancelled";
type CustomerOrder = {
  id: string;
  userId: string;
  userPhone?: string;
  userEmail?: string;
  date: string;
  status: OrderStatus;
  total: string;
  customerName: string;
  phone: string;
  email?: string;
  address?: string;
  fulfillmentMethod?: FulfillmentMethod;
  pickupHubId?: string;
  pickupHubName?: string;
  pickupHubPlace?: string;
  coupon?: string;
  paymentStatus?: "pending" | "paid";
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  inventoryAdjusted?: boolean;
  items?: Array<{ name: string; quantity: number; price: string; productId?: string; image?: string; variantName?: string; variantImage?: string; size?: string; promotion?: PromotionCartLine }>;
};
type AssistantMessage = { role: "user" | "assistant"; text: string; productIds?: string[] };
type RazorpayCheckoutResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};
type RazorpayCheckoutOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name: string; contact: string; email?: string };
  notes: { address: string; fanzzy_order_id: string };
  theme: { color: string };
  handler: (response: RazorpayCheckoutResponse) => void;
  modal: { ondismiss: () => void };
};
type RazorpayCheckout = { open: () => void };

const readOverlayProduct = (): Product | null => {
  if (typeof window === "undefined" || !new URLSearchParams(window.location.search).get("fanzzy-product")) return null;
  try {
    const stored = window.sessionStorage.getItem("fanzzy-overlay-product");
    return stored ? JSON.parse(stored) as Product : null;
  } catch {
    return null;
  }
};

const defaultProducts: Product[] = [];
const defaultCategories: Array<{ name: string; count: string; image: string }> = [];
const demoProductNames = new Set([
  "aurora drop earrings",
  "solstice tennis necklace",
  "muse sculpted cuff",
  "orbital pearl ring",
]);
const isDemoProduct = (product: { name?: string; sku?: string }) =>
  demoProductNames.has(String(product.name ?? "").trim().toLowerCase()) ||
  /^LST-(AUR|SOL|MUS|ORB)-\d+$/i.test(String(product.sku ?? ""));
const isDemoOrder = (order: { id?: string }) => /^#FZ-104[4-8]$/.test(String(order.id ?? ""));
const isPaidOrder = (order: Pick<CustomerOrder, "paymentStatus" | "razorpayPaymentId">) => order.paymentStatus === "paid" || Boolean(order.razorpayPaymentId);
const normalizePhone = (value?: string) => String(value || "").replace(/\D/g, "").replace(/^0+/, "");
const belongsToCustomer = (order: Pick<CustomerOrder, "userId" | "userPhone" | "phone">, customer: CustomerAuthUser) => {
  if (order.userId === customer.id) return true;
  const orderPhone = normalizePhone(order.userPhone) || normalizePhone(order.phone);
  return Boolean(orderPhone && orderPhone === normalizePhone(customer.phone));
};
const isCustomerOrder = (order: CustomerOrder, customer: CustomerAuthUser) =>
  belongsToCustomer(order, customer) && !isDemoOrder(order) && (isPaidOrder(order) || order.paymentStatus == null);

const formatINR = (value: number) => `₹${(Number.isFinite(value) ? value : 0).toLocaleString("en-IN")}`;
const CUSTOMER_PRICE_MULTIPLIER = 2.2;
const normalizeProductKey = (value?: string) => String(value || "").trim().replace(/[^a-z0-9]/gi, "").toLowerCase();
const matchesProductKey = (product: Pick<Product, "id" | "sku">, value?: string) => {
  const normalizedValue = normalizeProductKey(value);
  return Boolean(normalizedValue) && (normalizedValue === normalizeProductKey(product.id) || normalizedValue === normalizeProductKey(product.sku));
};
const getProductSetting = <T,>(settings: Record<string, T>, ...keys: Array<string | undefined>) => {
  for (const key of keys) {
    if (key && settings[key] !== undefined) return settings[key];
  }
  const normalizedKeys = new Set(keys.map(normalizeProductKey).filter(Boolean));
  return Object.entries(settings).find(([key]) => normalizedKeys.has(normalizeProductKey(key)))?.[1];
};
const getCustomerPrice = (product: Pick<Product, "price">) => product.price;
const getComparePrice = (product: Pick<Product, "price">) => Math.round(product.price * CUSTOMER_PRICE_MULTIPLIER);
const getProductVariantType = (product: Pick<Product, "variantType" | "sizes" | "sizeStock" | "variants">): ProductVariantType =>
  product.sizes?.length || Object.keys(product.sizeStock || {}).length || product.variants?.some((variant) => Boolean(variant.size))
    ? "size"
    : product.variantType || "normal";
const getProductSizes = (product: Pick<Product, "variantType" | "sizes" | "variants">) =>
  getProductVariantType(product) === "size" && product.variants?.length
    ? product.variants.map((variant) => variant.size || variant.name).filter(Boolean)
    : product.sizes || [];
const getSizeVariant = (product: Pick<Product, "variantType" | "sizes" | "variants">, size?: string | null) =>
  size ? product.variants?.find((variant) => getProductVariantType(product) === "size" && (variant.size || variant.name) === size) : undefined;
type StockProduct = Pick<Product, "stock"> & Partial<Pick<Product, "sizeStock" | "variantType" | "sizes" | "variants">> & { size?: string | null };
const getSizeStock = (product: StockProduct, size?: string | null) => {
  if (!size) return product.stock;
  const normalizedSize = String(size).trim().replace(/^size\s+/i, "").toLowerCase();
  const sizeStockKey = Object.keys(product.sizeStock || {}).find((key) => key.trim().replace(/^size\s+/i, "").toLowerCase() === normalizedSize);
  const savedSizeStock = sizeStockKey ? product.sizeStock?.[sizeStockKey] : undefined;
  // The dedicated size-stock record is shared inventory and therefore takes
  // priority over any cached variant value from an older browser session.
  if (savedSizeStock !== undefined) return Math.max(0, Math.floor(Number(savedSizeStock) || 0));
  const sizeVariant = product.variants?.find((variant) => String(variant.size || variant.name).trim().replace(/^size\s+/i, "").toLowerCase() === normalizedSize);
  if (sizeVariant?.stock !== undefined && sizeVariant.stock !== null) {
    const variantStock = Number(sizeVariant.stock);
    if (Number.isFinite(variantStock)) return Math.max(0, Math.floor(variantStock));
  }
  return product.stock;
};
const getVariantStock = (product: StockProduct, variant?: ProductVariant | null) => {
  if (getProductVariantType(product) === "size" && product.size) return getSizeStock(product, product.size);
  if (variant?.stock === undefined || variant.stock === null) return product.stock;
  const stock = Number(variant.stock);
  return Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : product.stock;
};
const getSelectionStock = (product: Pick<Product, "stock" | "sizeStock" | "variantType" | "sizes" | "variants">, variant?: ProductVariant | null, size?: string | null) => {
  if (getProductVariantType(product) === "size") return getSizeStock(product, size);
  return variant ? getVariantStock(product, variant) : product.stock;
};
const loadRazorpayCheckout = () => new Promise<new (options: RazorpayCheckoutOptions) => RazorpayCheckout>((resolve, reject) => {
  const existing = (window as Window & { Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckout }).Razorpay;
  if (existing) return resolve(existing);
  const script = document.createElement("script");
  script.src = "https://checkout.razorpay.com/v1/checkout.js";
  script.async = true;
  script.onload = () => {
    const razorpay = (window as Window & { Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckout }).Razorpay;
    if (razorpay) resolve(razorpay);
    else reject(new Error("Razorpay checkout did not load"));
  };
  script.onerror = () => reject(new Error("Razorpay checkout could not load"));
  document.body.appendChild(script);
});

const razorpayApiBaseUrl = (process.env.NEXT_PUBLIC_RAZORPAY_API_URL ?? "").replace(/\/$/, "");
const razorpayApiUrl = (path: "order" | "verify") => razorpayApiBaseUrl
  ? `${razorpayApiBaseUrl}/${path}`
  : `/api/razorpay/${path}`;

const readRazorpayResponse = async <T extends Record<string, unknown>>(response: Response) => {
  const body = await response.text();
  try {
    return JSON.parse(body || "{}") as T;
  } catch {
    throw new Error("Payment service is temporarily unavailable. Please try again.");
  }
};
const overlayHistoryUrl = (layers: string[], productId?: string) => {
  const url = new URL(window.location.href);
  if (layers.length) url.searchParams.set("fanzzy-overlay", layers.join(","));
  else url.searchParams.delete("fanzzy-overlay");
  if (productId) url.searchParams.set("fanzzy-product", productId);
  else url.searchParams.delete("fanzzy-product");
  return url.href;
};
const blockedHeroImage = "photo-1599643478518-a784e5dc4c8f";
const initialHeroSlides: string[] = [];
const defaultHeroSlideDuration = 5.2;
const defaultDeliveryCharge: DeliveryCharge = { enabled: false, amount: 99, freeAboveEnabled: false, freeAbove: 999 };
const defaultPickupHubs: PickupHub[] = [];
const parseDeliveryCharge = (value: string | null | undefined): DeliveryCharge => {
  if (!value) return defaultDeliveryCharge;
  try {
    const parsed = JSON.parse(value) as Partial<DeliveryCharge>;
    return {
      enabled: parsed.enabled === true,
      amount: Math.max(0, Number.isFinite(parsed.amount) ? Number(parsed.amount) : defaultDeliveryCharge.amount),
      freeAboveEnabled: parsed.freeAboveEnabled === true,
      freeAbove: Math.max(0, Number.isFinite(parsed.freeAbove) ? Number(parsed.freeAbove) : defaultDeliveryCharge.freeAbove),
    };
  } catch {
    return defaultDeliveryCharge;
  }
};
const parsePickupHubs = (value: string | null | undefined): PickupHub[] => {
  if (!value) return defaultPickupHubs;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return defaultPickupHubs;
    return parsed
      .filter((hub): hub is Partial<PickupHub> => Boolean(hub && typeof hub === "object"))
      .map((hub, index) => ({
        id: typeof hub.id === "string" && hub.id ? hub.id : `hub-${index + 1}`,
        name: typeof hub.name === "string" ? hub.name.trim() : "",
        place: typeof hub.place === "string" ? hub.place.trim() : "",
      }))
      .filter((hub) => hub.name && hub.place);
  } catch {
    return defaultPickupHubs;
  }
};
const siteBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const siteAsset = (name: string) => `${siteBasePath}/${name}`;
const productTones = ["#d9c4bc", "#dad7ce", "#d0c2b0", "#e5ddd1"];
const formatOrderDate = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
const normalizeCouponCode = (value?: string) => String(value || "").trim().replace(/\s+/g, "").toUpperCase();
const getCouponDiscount = (coupon: MarketingRecord, subtotal: number) => {
  const base = Math.max(0, Number.isFinite(subtotal) ? subtotal : 0);
  const discount = String(coupon.discount || "").replace(/,/g, "").trim();
  const roundCurrency = (value: number) => Math.round(value * 100) / 100;
  if (!base || !discount) return 0;

  const percent = discount.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percent) {
    const rate = Math.min(100, Math.max(0, Number(percent[1])));
    return roundCurrency(Math.min(base, (base * rate) / 100));
  }

  const currencyAmount = discount.match(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)|\b(\d+(?:\.\d+)?)\s*(?:₹|rs\.?|inr)\b/i);
  const plainAmount = discount.match(/^\s*(?:flat\s+)?(\d+(?:\.\d+)?)(?:\s*(?:off|discount))?\s*$/i);
  const amount = Number(currencyAmount?.[1] || currencyAmount?.[2] || plainAmount?.[1] || 0);
  if (Number.isFinite(amount) && amount > 0) return roundCurrency(Math.min(base, amount));
  return 0;
};
const isBogoCampaign = (campaign: MarketingRecord | null) => {
  if (!campaign || campaign.status !== "Active") return false;
  if (campaign.offerType === "bogo") return true;
  return /buy\s*(?:one|\d+)\s*(?:get|&)\s*(?:one|\d+)|bogo/i.test(
    `${campaign.name} ${campaign.detail} ${campaign.discount ?? ""}`,
  );
};
const getBogoQuantities = (campaign: MarketingRecord | null) => ({
  buy: Math.min(3, Math.max(1, Number(campaign?.buyQuantity) || 1)),
  get: Math.min(3, Math.max(1, Number(campaign?.getQuantity) || 1)),
});
const getBogoOfferLabel = (campaign: MarketingRecord | null) => {
  const { buy, get } = getBogoQuantities(campaign);
  return `Buy ${buy} Get ${get}`;
};
const localProductVariantsKey = "fanzzy-product-variants";
const checkoutAfterAuthKey = "fanzzy-checkout-after-auth";
const ordersAfterAuthKey = "fanzzy-orders-after-auth";
const cartStorageKey = (userId: string) => `fanzzy-cart:${userId}`;
const cartVariantsStorageKey = (userId: string) => `fanzzy-cart-variants:${userId}`;
const defaultImageAdjustments: ImageAdjustments = { zoom: 1, x: 0, y: 0, rotate: 0 };
const normalizeImageAdjustments = (value: unknown): ImageAdjustments => {
  const source = value && typeof value === "object" ? value as Partial<ImageAdjustments> : {};
  const numberOr = (candidate: unknown, fallback: number) =>
    typeof candidate === "number" && Number.isFinite(candidate) ? candidate : fallback;
  return {
    zoom: Math.min(2, Math.max(1, numberOr(source.zoom, 1))),
    x: Math.min(50, Math.max(-50, numberOr(source.x, 0))),
    y: Math.min(50, Math.max(-50, numberOr(source.y, 0))),
    rotate: Math.min(180, Math.max(-180, numberOr(source.rotate, 0))),
  };
};
const imageAdjustmentStyle = (value?: ImageAdjustments) => {
  const adjustments = normalizeImageAdjustments(value);
  const translation = adjustments.zoom - 1;
  return {
    objectPosition: "50% 50%",
    transform: `translate(${adjustments.x * translation}%, ${adjustments.y * translation}%) scale(${adjustments.zoom}) rotate(${adjustments.rotate}deg)`,
  };
};

function normalizeStoredProduct(value: unknown, index: number): Product | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  const rawPrice = raw.price;
  const price = typeof rawPrice === "number" ? rawPrice : Number(String(rawPrice ?? "").replace(/[^0-9.]/g, ""));
  const stock = typeof raw.stock === "number" ? raw.stock : Number(raw.stock ?? 0);
  const image = typeof raw.image === "string" ? raw.image : "";
  const sizes = Array.isArray(raw.sizes) ? raw.sizes.filter((size): size is string => typeof size === "string") : [];
  const variants = Array.isArray(raw.variants)
    ? raw.variants
        .filter((variant): variant is Record<string, unknown> => Boolean(variant && typeof variant === "object"))
        .map((variant) => ({
          name: typeof variant.name === "string" ? variant.name.trim() : "",
          size: typeof variant.size === "string" ? variant.size.trim() : undefined,
          image: typeof variant.image === "string" ? variant.image : "",
          stock: variant.stock === undefined || variant.stock === null || variant.stock === "" ? undefined : Number.isFinite(Number(variant.stock)) ? Math.max(0, Math.floor(Number(variant.stock))) : undefined,
          adjustments: normalizeImageAdjustments(variant.adjustments),
        }))
        .filter((variant) => variant.name || variant.size || variant.image)
    : [];
  const inferredSizes = sizes.length
    ? sizes
    : Array.from(new Set(variants.map((variant) => variant.size).filter((size): size is string => Boolean(size))));
  const storedSizeStock = raw.sizeStock && typeof raw.sizeStock === "object" ? raw.sizeStock as Record<string, number> : {};
  const inferredSizeStock = Object.keys(storedSizeStock).length
    ? storedSizeStock
    : Object.fromEntries(variants.filter((variant) => variant.size && variant.stock !== undefined).map((variant) => [variant.size!, variant.stock!]));
  const idValue = typeof raw.id === "string" ? raw.id : typeof raw.sku === "string" ? raw.sku : `${name}-${index}`;
  return {
    id: idValue.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `product-${index}`,
    sku: typeof raw.sku === "string" && raw.sku ? raw.sku : idValue,
    name,
    category: typeof raw.category === "string" && raw.category ? raw.category : "Uncategorised",
    stock: Number.isFinite(stock) ? stock : 0,
    price: Number.isFinite(price) ? price : 0,
    compareAt: typeof raw.compareAt === "number" ? raw.compareAt : undefined,
    image,
    hoverImage: typeof raw.hoverImage === "string" && raw.hoverImage ? raw.hoverImage : image,
    tag: typeof raw.tag === "string" ? raw.tag : undefined,
    tone: typeof raw.tone === "string" && raw.tone ? raw.tone : productTones[index % productTones.length],
    variants,
    sizes: inferredSizes,
    sizeStock: inferredSizeStock,
    variantType: raw.variantType === "size" || raw.variantType === "normal" ? raw.variantType : (inferredSizes.length ? "size" : "normal"),
    billName: typeof raw.billName === "string" ? raw.billName.trim() : "",
    imageAdjustments: normalizeImageAdjustments(raw.imageAdjustments),
    hoverImageAdjustments: normalizeImageAdjustments(raw.hoverImageAdjustments),
  };
}

const isProductOutOfStock = (product: Product) => getProductVariantType(product) === "normal" && product.variants?.length
  ? product.variants.every((variant) => getVariantStock(product, variant) <= 0)
  : getProductVariantType(product) === "size" && getProductSizes(product).length
    ? getProductSizes(product).every((size) => getSizeStock(product, size) <= 0)
    : product.stock <= 0;

function ProductCard({ product, wished, promotions, onWishlist, onAdd, onQuickView, onImageZoom }: { product: Product; wished: boolean; promotions: PromotionOffer[]; onWishlist: () => void; onAdd: () => void; onQuickView: () => void; onImageZoom: () => void }) {
  const isOutOfStock = isProductOutOfStock(product);
  return (
    <article className="product-card">
      <div className="product-media" style={{ backgroundColor: product.tone }}>
        <img className={`product-image product-image-zoom primary-image ${isOutOfStock ? "stock-out-image" : ""}`} src={product.image} alt={product.name} style={imageAdjustmentStyle(product.imageAdjustments)} onClick={onImageZoom} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onImageZoom(); }} role="button" tabIndex={0} title="Click to zoom" />
        <img className={`product-image product-image-zoom hover-image ${isOutOfStock ? "stock-out-image" : ""}`} src={product.hoverImage} alt="" aria-hidden="true" style={imageAdjustmentStyle(product.hoverImageAdjustments)} onClick={onImageZoom} />
        {product.tag && <span className="product-tag">{product.tag}</span>}
        {promotions.slice(0, 1).map((offer) => <span className="promotion-badge" key={offer.id}>{offerTypeLabel(offer)}</span>)}
        {product.stock === 1 && <span className={`low-stock-badge ${product.tag ? "with-tag" : ""}`}>Only 1 available</span>}
        {isOutOfStock && <span className="stock-out-overlay">Sold out</span>}
        <button className={`wishlist-button ${wished ? "is-wished" : ""}`} onClick={onWishlist} aria-label={wished ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}>{wished ? "♥" : "♡"}</button>
        <button className="quick-view" onClick={onQuickView}>Quick view <span>↗</span></button>
      </div>
      <div className="product-meta">
        <div>
          <p className="eyebrow">{product.category}</p>
          <h3>{product.name}</h3>
        </div>
        <button className="add-to-cart-button" type="button" onClick={onAdd} disabled={isOutOfStock} aria-label={isOutOfStock ? `${product.name} is sold out` : `Add ${product.name} to cart`}>Add to cart</button>
      </div>
      {getProductVariantType(product) === "normal" && product.variants?.length ? <button className="product-variants-preview" onClick={onQuickView} aria-label={`View ${product.name} variants`}><span>{product.variants.length} colour / model option{product.variants.length === 1 ? "" : "s"}</span><span className="product-variant-thumbs">{product.variants.slice(0, 4).map((variant) => <img key={`${product.id}-${variant.name}`} src={variant.image || product.image} alt={variant.name} style={imageAdjustmentStyle(variant.adjustments)} />)}</span><b>View ↗</b></button> : null}
      <div className="price-row"><span>{formatINR(getCustomerPrice(product))}</span><del>{formatINR(getComparePrice(product))}</del></div>
    </article>
  );
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>(defaultProducts);
  const [categories, setCategories] = useState(defaultCategories);
  const [activeCategory, setActiveCategory] = useState("All pieces");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartVariants, setCartVariants] = useState<Record<string, ProductVariant | null>>({});
  const [cartSizes, setCartSizes] = useState<Record<string, string | null>>({});
  const [cartPromotionLines, setCartPromotionLines] = useState<Record<string, PromotionCartLine>>({});
  const cartOwnerId = useRef<string | null>(null);
  const [cartReadyOwner, setCartReadyOwner] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [orderConfirmation, setOrderConfirmation] = useState<CustomerOrder | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([
    { role: "assistant", text: "Hi, I’m Fanzzy Assistant. I can help you find a piece, choose a gift, check an order, or answer care questions." },
  ]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authPhone, setAuthPhone] = useState("");
  const [authOtp, setAuthOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [authJustVerified, setAuthJustVerified] = useState(false);
  // Browser storage is restored after hydration so the server and the first
  // client render produce identical markup.
  const [authUser, setAuthUser] = useState<CustomerAuthUser | null>(null);
  const [checkoutForm, setCheckoutForm] = useState({ name: "", phone: "", email: "", address: "" });
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<MarketingRecord | null>(null);
  const [marketingRecords, setMarketingRecords] = useState<MarketingRecord[]>([]);
  const [promotionalOffers, setPromotionalOffers] = useState<PromotionOffer[]>([]);
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  const overlayHistoryStack = useRef<string[]>([]);
  const overlayPageState = useRef<StorefrontPageHistoryState>({ activeCategory: "All pieces", search: "", scrollY: 0 });
  const overlayScrollY = useRef<number | null>(null);
  const overlayHistoryCleanup = useRef(false);
  const overlayClosedFromBack = useRef(false);
  const overlayLastBackUrl = useRef<string | null>(null);
  const quickProductCloseRequested = useRef(false);
  const overlayRestoredFromUrl = useRef(Boolean(typeof window !== "undefined" && new URLSearchParams(window.location.search).get("fanzzy-product")));
  const [zoomedImage, setZoomedImage] = useState<{ src: string; alt: string; adjustments?: ImageAdjustments } | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedPromotion, setSelectedPromotion] = useState<PromotionOffer | null>(null);
  const [selectedFreeSelections, setSelectedFreeSelections] = useState<PromotionSelection[]>([]);
  const [selectedBundleSelections, setSelectedBundleSelections] = useState<PromotionSelection[]>([]);
  const [toast, setToast] = useState("");
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [newsletterMessage, setNewsletterMessage] = useState("");
  const [termsOpen, setTermsOpen] = useState(false);
  const [returnPolicyOpen, setReturnPolicyOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [announcementText, setAnnouncementText] = useState("Complimentary shipping on orders above ₹500");
  const [deliveryCharge, setDeliveryCharge] = useState<DeliveryCharge>(defaultDeliveryCharge);
  const [pickupHubs, setPickupHubs] = useState<PickupHub[]>(defaultPickupHubs);
  const [fulfillmentMethod, setFulfillmentMethod] = useState<FulfillmentMethod>("delivery");
  const [selectedPickupHubId, setSelectedPickupHubId] = useState("");
  const [activeCampaign, setActiveCampaign] = useState<MarketingRecord | null>(null);
  const [heroSlides, setHeroSlides] = useState(initialHeroSlides);
  const [heroSlideIndex, setHeroSlideIndex] = useState(0);
  const [heroSlideDuration, setHeroSlideDuration] = useState(defaultHeroSlideDuration);
  const profileName = authUser?.phone || "Fanzzy customer";
  const openQuickProduct = useCallback((product: Product) => {
    // Quick view replaces a temporary source drawer (search, saved pieces,
    // orders, or the assistant). This leaves exactly one Back step: product
    // view → the actual page underneath, without briefly showing that drawer.
    quickProductCloseRequested.current = false;
    setSearchOpen(false);
    setAssistantOpen(false);
    setSavedOpen(false);
    setOrdersOpen(false);
    setQuickProduct(product);
  }, []);
  const closeQuickProduct = useCallback(() => {
    quickProductCloseRequested.current = true;
    setQuickProduct(null);
  }, []);
  const selectCategory = useCallback((category: string) => {
    setActiveCategory(category);
    overlayPageState.current = {
      ...overlayPageState.current,
      activeCategory: category,
      scrollY: Math.round(window.scrollY),
    };
  }, []);

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const timer = window.setInterval(() => setOtpCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [otpCooldown]);

  useEffect(() => {
    let active = true;
    const loadDeliveryCharge = async () => {
      const remote = await fetchStoreSetting("deliveryCharge");
      const stored = remote.value || window.localStorage.getItem("fanzzy-delivery-charge");
      if (active) setDeliveryCharge(parseDeliveryCharge(stored));
    };
    const refreshDeliveryCharge = () => {
      setDeliveryCharge(parseDeliveryCharge(window.localStorage.getItem("fanzzy-delivery-charge")));
      void loadDeliveryCharge();
    };
    void loadDeliveryCharge();
    window.addEventListener("fanzzy-delivery-charge-updated", refreshDeliveryCharge);
    window.addEventListener("storage", refreshDeliveryCharge);
    return () => {
      active = false;
      window.removeEventListener("fanzzy-delivery-charge-updated", refreshDeliveryCharge);
      window.removeEventListener("storage", refreshDeliveryCharge);
    };
  }, []);

  useEffect(() => {
    const productId = new URLSearchParams(window.location.search).get("fanzzy-product");
    if (!productId) {
      quickProductCloseRequested.current = false;
      return;
    }
    if (quickProduct || quickProductCloseRequested.current) return;
    const storedProduct = readOverlayProduct();
    const product = products.find((candidate) => matchesProductKey(candidate, productId))
      || (storedProduct && matchesProductKey(storedProduct, productId) ? storedProduct : null);
    if (product) {
      overlayRestoredFromUrl.current = true;
      setQuickProduct(product);
    }
  }, [products, quickProduct]);

  useEffect(() => {
    if (!quickProduct) return;
    const latestProduct = products.find((product) => matchesProductKey(product, quickProduct.id) || matchesProductKey(product, quickProduct.sku));
    if (latestProduct && latestProduct !== quickProduct) setQuickProduct(latestProduct);
  }, [products, quickProduct]);

  useEffect(() => {
    let active = true;
    const loadPickupHubs = async () => {
      const remote = await fetchStoreSetting("pickupHubs");
      const remoteHubs = parsePickupHubs(remote.value);
      const localHubs = parsePickupHubs(window.localStorage.getItem("fanzzy-pickup-hubs"));
      if (active) setPickupHubs(remoteHubs.length ? remoteHubs : localHubs);
    };
    const refreshPickupHubs = () => {
      setPickupHubs(parsePickupHubs(window.localStorage.getItem("fanzzy-pickup-hubs")));
      void loadPickupHubs();
    };
    void loadPickupHubs();
    window.addEventListener("fanzzy-pickup-hubs-updated", refreshPickupHubs);
    window.addEventListener("storage", refreshPickupHubs);
    return () => {
      active = false;
      window.removeEventListener("fanzzy-pickup-hubs-updated", refreshPickupHubs);
      window.removeEventListener("storage", refreshPickupHubs);
    };
  }, []);

  useEffect(() => {
    const syncProducts = async () => {
      const remote = await fetchCatalogProducts();
      const variantsRemote = await fetchStoreSetting("productVariants");
      const variantTypeRemote = await fetchStoreSetting("productVariantType");
      const sizesRemote = await fetchStoreSetting("productSizes");
      const sizeStockRemote = await fetchStoreSetting("productSizeStock");
      const imageAdjustmentsRemote = await fetchStoreSetting("productImageAdjustments");
      const billNameRemote = await fetchStoreSetting("productBillNames");
      let variantsMap: Record<string, ProductVariant[]> = {};
      let variantTypeMap: Record<string, ProductVariantType> = {};
      let sizesMap: Record<string, string[]> = {};
      let sizeStockMap: Record<string, Record<string, number>> = {};
      let imageAdjustmentsMap: Record<string, ProductImageAdjustments> = {};
      let billNameMap: Record<string, string> = {};
      if (variantsRemote.value) {
        try {
          const parsed = JSON.parse(variantsRemote.value) as Record<string, ProductVariant[]>;
          if (parsed && typeof parsed === "object") variantsMap = parsed;
        } catch {
          variantsMap = {};
        }
      }
      if (variantTypeRemote.value) {
        try {
          const parsed = JSON.parse(variantTypeRemote.value) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") {
            variantTypeMap = Object.fromEntries(
              Object.entries(parsed).filter((entry): entry is [string, ProductVariantType] => entry[1] === "normal" || entry[1] === "size"),
            );
          }
        } catch {
          variantTypeMap = {};
        }
      }
      if (sizesRemote.value) {
        try { const parsed = JSON.parse(sizesRemote.value) as Record<string, string[]>; if (parsed && typeof parsed === "object") sizesMap = parsed; } catch { sizesMap = {}; }
      }
      if (sizeStockRemote.value) {
        try { const parsed = JSON.parse(sizeStockRemote.value) as Record<string, Record<string, number>>; if (parsed && typeof parsed === "object") sizeStockMap = parsed; } catch { sizeStockMap = {}; }
      }
      if (imageAdjustmentsRemote.value) {
        try {
          const parsed = JSON.parse(imageAdjustmentsRemote.value) as Record<string, ProductImageAdjustments>;
          if (parsed && typeof parsed === "object") imageAdjustmentsMap = parsed;
        } catch {
          imageAdjustmentsMap = {};
        }
      }
      if (billNameRemote.value) {
        try {
          const parsed = JSON.parse(billNameRemote.value) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") {
            billNameMap = Object.fromEntries(
              Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
            );
          }
        } catch {
          billNameMap = {};
        }
      }
      const localVariantsMap: Record<string, ProductVariant[]> = {};
      const storedVariantCache = window.localStorage.getItem(localProductVariantsKey);
      if (storedVariantCache) {
        try {
          const parsed = JSON.parse(storedVariantCache) as Record<string, ProductVariant[]>;
          if (parsed && typeof parsed === "object") {
            Object.entries(parsed).forEach(([key, variants]) => {
              if (Array.isArray(variants) && variants.length) localVariantsMap[key] = variants;
            });
          }
        } catch {
          // Ignore malformed local variant cache.
        }
      }
      const stored = window.localStorage.getItem("fanzzy-products");
      let localProducts: Product[] = [];
      if (stored) {
        try {
          const parsed: unknown = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            localProducts = parsed.filter((product) => !isDemoProduct(product as { name?: string; sku?: string })).map(normalizeStoredProduct).filter((product): product is Product => product !== null).map((product) => {
              const savedVariants = getProductSetting(variantsMap, product.sku, product.id);
              const savedSizes = getProductSetting(sizesMap, product.sku, product.id);
              const savedSizeStock = getProductSetting(sizeStockMap, product.sku, product.id);
              const savedVariantType = getProductSetting(variantTypeMap, product.sku, product.id);
              return {
                ...product,
                variants: savedVariants?.length ? savedVariants : product.variants?.length ? product.variants : getProductSetting(localVariantsMap, product.sku, product.id) || [],
                sizes: savedSizes?.length ? savedSizes : product.sizes?.length ? product.sizes : [],
                sizeStock: savedSizeStock && Object.keys(savedSizeStock).length ? savedSizeStock : product.sizeStock || {},
                variantType: savedVariantType || (savedSizes?.length ? "size" : product.variantType || (product.sizes?.length ? "size" : "normal")),
              };
            });
          }
        } catch {
          window.localStorage.removeItem("fanzzy-products");
        }
      }
      if (!remote.error && remote.data !== null) {
        const remoteProducts = remote.data.filter((product) => !isDemoProduct(product)).map((product, index) => {
          const savedAdjustments = getProductSetting(imageAdjustmentsMap, product.sku);
          const savedVariants = getProductSetting(variantsMap, product.sku);
          const variants = (savedVariants?.length ? savedVariants : getProductSetting(localVariantsMap, product.sku) || product.variants) as ProductVariant[] | undefined;
          const savedSizes = getProductSetting(sizesMap, product.sku);
          const inferredSizes = savedSizes?.length
            ? savedSizes
            : Array.from(new Set((variants || []).map((variant) => variant.size).filter((size): size is string => Boolean(size))));
          const savedSizeStock = getProductSetting(sizeStockMap, product.sku) || {};
          const inferredSizeStock = Object.keys(savedSizeStock).length
            ? savedSizeStock
            : Object.fromEntries((variants || []).filter((variant) => variant.size && variant.stock !== undefined).map((variant) => [variant.size!, variant.stock!]));
          return normalizeStoredProduct({
          id: product.sku,
          sku: product.sku,
          name: product.name,
          category: product.category,
          stock: product.stock,
          price: product.price,
          image: product.image,
          hoverImage: product.hoverImage || product.image,
          tag: product.tag,
          tone: product.tone,
          compareAt: product.compareAt,
          variants: variants?.map((variant, variantIndex) => ({
            ...variant,
            name: variant.name || `Option ${variantIndex + 1}`,
            adjustments: normalizeImageAdjustments(savedAdjustments?.variants?.[variantIndex] || variant.adjustments),
          })),
          sizes: inferredSizes,
          sizeStock: inferredSizeStock,
          variantType: getProductSetting(variantTypeMap, product.sku) || (inferredSizes.length ? "size" : "normal"),
          imageAdjustments: savedAdjustments?.image,
          hoverImageAdjustments: savedAdjustments?.hoverImage,
          billName: getProductSetting(billNameMap, product.sku) || "",
        }, index);
        }).filter((product): product is Product => product !== null);
        const remoteWithLocalVariants = remoteProducts.map((product) => ({
          ...product,
          variants: product.variants?.length
            ? product.variants
            : localProducts.find((localProduct) => localProduct.id === product.id)?.variants || localVariantsMap[product.id] || [],
        }));
        // Supabase is the shared catalog. Local storage is only a fallback for
        // devices that are offline or when Supabase has not been configured.
        setProducts(remoteWithLocalVariants);
        return;
      }
      if (localProducts.length) setProducts(localProducts);
    };
    void syncProducts();
    const onProductsStorage = () => { void syncProducts(); };
    const onProductsUpdated = () => { void syncProducts(); };
    const unsubscribeFromProductSettings = (['productVariants', 'productVariantType', 'productSizes', 'productSizeStock'] as const)
      .map((key) => subscribeToStoreSetting(key, () => { void syncProducts(); }));
    window.addEventListener("storage", onProductsStorage);
    window.addEventListener("fanzzy-products-updated", onProductsUpdated);
    return () => {
      unsubscribeFromProductSettings.forEach((unsubscribe) => unsubscribe());
      window.removeEventListener("storage", onProductsStorage);
      window.removeEventListener("fanzzy-products-updated", onProductsUpdated);
    };
  }, []);

  useEffect(() => {
    const availableVariant = quickProduct && getProductVariantType(quickProduct) === "normal"
      ? quickProduct.variants?.find((variant) => getVariantStock(quickProduct, variant) > 0)
      : undefined;
    setSelectedVariant(availableVariant ?? (quickProduct && getProductVariantType(quickProduct) === "normal" ? quickProduct.variants?.[0] : null) ?? null);
    const availableSize = quickProduct && getProductVariantType(quickProduct) === "size"
      ? getProductSizes(quickProduct).find((size) => getSelectionStock(quickProduct, null, size) > 0)
      : undefined;
    setSelectedSize(availableSize ?? quickProduct?.sizes?.[0] ?? null);
    setSelectedPromotion(null);
    setSelectedFreeSelections([]);
    setSelectedBundleSelections([]);
  }, [quickProduct]);

  useEffect(() => {
    let active = true;
    const syncCategories = async () => {
      const remote = await fetchCatalogCategories();
      if (active && !remote.error && remote.data && remote.data.length) {
        setCategories(remote.data.map((category, index) => ({
          name: category.name,
          count: `${category.pieces} pieces`,
          image: category.image || "",
        })));
        return;
      }
      const stored = window.localStorage.getItem("fanzzy-categories");
      if (!active || !stored) return;
      try {
        const parsed = JSON.parse(stored) as Array<{ name?: string; pieces?: number; image?: string }>;
        setCategories(parsed.filter((category) => category.name).map((category, index) => ({
          name: category.name!,
          count: `${category.pieces ?? 0} pieces`,
          image: category.image || "",
        })));
      } catch {
        window.localStorage.removeItem("fanzzy-categories");
      }
    };
    void syncCategories();
    window.addEventListener("storage", syncCategories);
    window.addEventListener("fanzzy-categories-updated", syncCategories);
    return () => {
      active = false;
      window.removeEventListener("storage", syncCategories);
      window.removeEventListener("fanzzy-categories-updated", syncCategories);
    };
  }, []);

  useEffect(() => {
    let syncInFlight = false;
    const syncOrders = async (recoverCapturedPayments = false) => {
      if (syncInFlight) return;
      syncInFlight = true;
      // Recover captured payments on the initial load only. Live order updates
      // should read the shared order record directly without waiting on the
      // payment provider.
      if (recoverCapturedPayments) {
        await fetch("/api/razorpay/sync-payments", { method: "POST" }).catch(() => undefined);
      }
      const userId = authUser?.id;
      if (!userId) {
        setOrders([]);
        syncInFlight = false;
        return;
      }
      try {
        const remote = await fetchStoreOrders<CustomerOrder>();
        const merged = new Map<string, CustomerOrder>();
        remote.data?.forEach((order) => {
          if (order?.id && isCustomerOrder(order, authUser)) {
            merged.set(order.id, order);
          }
        });
        try {
          const stored = window.localStorage.getItem(`fanzzy-orders:${userId}`);
          const parsed = stored ? JSON.parse(stored) : [];
          if (Array.isArray(parsed)) {
            parsed.forEach((order) => {
              if (order?.id && isCustomerOrder(order as CustomerOrder, authUser) && !merged.has(order.id)) {
                merged.set(order.id, order as CustomerOrder);
              }
            });
          }
          const sharedStored = window.localStorage.getItem("fanzzy-orders");
          const sharedParsed = sharedStored ? JSON.parse(sharedStored) : [];
          if (Array.isArray(sharedParsed)) sharedParsed.forEach((order) => {
            if (order?.id && isCustomerOrder(order as CustomerOrder, authUser) && !merged.has(order.id)) merged.set(order.id, order as CustomerOrder);
          });
        } catch {
          window.localStorage.removeItem(`fanzzy-orders:${userId}`);
        }
        setOrders(Array.from(merged.values()));
      } finally {
        syncInFlight = false;
      }
    };
    void syncOrders(true);
    const liveOrderTimer = window.setInterval(() => { void syncOrders(false); }, 3000);
    const unsubscribeFromLiveOrders = subscribeToStoreSetting("orders", () => { void syncOrders(false); });
    const onStorageOrdersUpdated = () => { void syncOrders(false); };
    const onLocalOrdersUpdated = () => { void syncOrders(false); };
    window.addEventListener("storage", onStorageOrdersUpdated);
    window.addEventListener("fanzzy-orders-updated", onLocalOrdersUpdated);
    return () => {
      window.clearInterval(liveOrderTimer);
      unsubscribeFromLiveOrders();
      window.removeEventListener("storage", onStorageOrdersUpdated);
      window.removeEventListener("fanzzy-orders-updated", onLocalOrdersUpdated);
    };
  }, [authUser?.id]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const categoryMatch = activeCategory === "All pieces" || product.category === activeCategory;
      const searchMatch = !query || `${product.name} ${product.category}`.toLowerCase().includes(query);
      return categoryMatch && searchMatch;
    }).sort((left, right) => Number(isProductOutOfStock(left)) - Number(isProductOutOfStock(right)));
  }, [activeCategory, products, search]);

  const offersForProduct = (product: Product) => promotionalOffers.filter((offer) => {
    const paidScope = offer.eligiblePaid;
    if (!paidScope.length) return true;
    return paidScope.some((selection) => selection.productId === product.id || selection.productId === product.sku || selection.productId === product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  });
  const makePromotionSelection = (product: Product, variant?: ProductVariant | null, size?: string | null): PromotionSelection => ({
    productId: product.id,
    sku: product.sku,
    variantName: variant?.name,
    size: size || undefined,
    price: getCustomerPrice(product),
    stock: getSelectionStock(product, variant, size),
  });

  const cartItems = Object.entries(cart).flatMap(([cartKey, quantity]) => {
    const productId = cartKey.split("::", 1)[0];
    const product = products.find((item) => matchesProductKey(item, productId));
    return product ? [{ ...product, cartKey, quantity, variant: cartVariants[cartKey] ?? null, size: cartSizes[cartKey] ?? null, promotion: cartPromotionLines[cartKey] ?? null }] : [];
  });
  const cartStockIssues = cartItems.filter((product) => {
    const availableStock = getSelectionStock(product, product.variant, product.size);
    return availableStock <= 0 || product.quantity > availableStock;
  });
  const cartHasSoldOutItems = cartStockIssues.some((product) => getSelectionStock(product, product.variant, product.size) <= 0);
  const cartCount = Object.values(cart).reduce((sum, count) => sum + count, 0);
  const getCartLinePrice = (product: (typeof cartItems)[number]) => product.promotion?.linePrice ?? getCustomerPrice(product);
  const subtotal = cartItems.reduce((sum, product) => sum + getCartLinePrice(product) * product.quantity, 0);
  const selectedVariantStock = quickProduct ? getSelectionStock(quickProduct, selectedVariant, selectedSize) : 0;
  const couponDiscount = appliedCoupon ? getCouponDiscount(appliedCoupon, subtotal) : 0;
  const bogoCampaign = isBogoCampaign(activeCampaign) ? activeCampaign : null;
  const bogoQuantities = getBogoQuantities(bogoCampaign);
  const bogoOfferLabel = getBogoOfferLabel(bogoCampaign);
  const bogoEligibleIds = bogoCampaign?.eligibleProductIds?.length
    ? new Set(bogoCampaign.eligibleProductIds.map((id) => id.toLowerCase()))
    : null;
  const bogoPrices = bogoCampaign
    ? cartItems.flatMap((product) => {
        if (bogoEligibleIds && !bogoEligibleIds.has(product.id.toLowerCase())) return [];
        return Array.from({ length: product.quantity }, () => getCustomerPrice(product));
      }).sort((a, b) => a - b)
    : [];
  const bogoFreeCount = Math.floor(bogoPrices.length / (bogoQuantities.buy + bogoQuantities.get)) * bogoQuantities.get;
  const bogoDiscount = bogoPrices
    .slice(0, bogoFreeCount)
    .reduce((sum, price) => sum + price, 0);
  const discountedSubtotal = Math.max(0, subtotal - couponDiscount - bogoDiscount);
  const thresholdReached = deliveryCharge.freeAboveEnabled && discountedSubtotal >= deliveryCharge.freeAbove;
  const selectedPickupHub = pickupHubs.find((hub) => hub.id === selectedPickupHubId) || null;
  const deliveryTotal = fulfillmentMethod === "pickup" ? 0 : deliveryCharge.enabled && !thresholdReached ? deliveryCharge.amount : 0;
  const orderTotal = Math.max(0, subtotal - couponDiscount - bogoDiscount + deliveryTotal);

  useEffect(() => {
    const userId = authUser?.id;
    const ownerId = userId || "guest";
    const readCart = <T,>(key: string): T => {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) || "{}");
        return parsed && typeof parsed === "object" ? parsed as T : {} as T;
      } catch {
        return {} as T;
      }
    };

    setCartReadyOwner(null);
    if (!userId) {
      setCart(readCart<Record<string, number>>(cartStorageKey(ownerId)));
      setCartVariants(readCart<Record<string, ProductVariant | null>>(cartVariantsStorageKey(ownerId)));
      setCartSizes(readCart<Record<string, string | null>>(`fanzzy-cart-sizes:${ownerId}`));
      cartOwnerId.current = ownerId;
      setCartReadyOwner(ownerId);
      return;
    }

    const guestCart = readCart<Record<string, number>>(cartStorageKey("guest"));
    const userCart = readCart<Record<string, number>>(cartStorageKey(userId));
    const guestVariants = readCart<Record<string, ProductVariant | null>>(cartVariantsStorageKey("guest"));
    const userVariants = readCart<Record<string, ProductVariant | null>>(cartVariantsStorageKey(userId));
    const guestSizes = readCart<Record<string, string | null>>(`fanzzy-cart-sizes:guest`);
    const userSizes = readCart<Record<string, string | null>>(`fanzzy-cart-sizes:${userId}`);
    const mergedCart = { ...userCart };
    Object.entries(guestCart).forEach(([cartKey, quantity]) => {
      mergedCart[cartKey] = (mergedCart[cartKey] ?? 0) + quantity;
    });
    setCart(mergedCart);
    setCartVariants({ ...guestVariants, ...userVariants });
    setCartSizes({ ...guestSizes, ...userSizes });
    window.localStorage.removeItem(cartStorageKey("guest"));
    window.localStorage.removeItem(cartVariantsStorageKey("guest"));
    window.localStorage.removeItem("fanzzy-cart-sizes:guest");
    cartOwnerId.current = ownerId;
    setCartReadyOwner(ownerId);
  }, [authUser?.id]);

  useEffect(() => {
    const ownerId = authUser?.id || "guest";
    if (cartReadyOwner !== ownerId || cartOwnerId.current !== ownerId) return;
    window.localStorage.setItem(cartStorageKey(ownerId), JSON.stringify(cart));
    window.localStorage.setItem(cartVariantsStorageKey(ownerId), JSON.stringify(cartVariants));
    window.localStorage.setItem(`fanzzy-cart-sizes:${ownerId}`, JSON.stringify(cartSizes));
  }, [authUser?.id, cartReadyOwner, cart, cartVariants, cartSizes]);

  useEffect(() => {
    let active = true;
    const storedUser = readStoredCustomerAuthUser();
    const loadCustomerSession = async () => {
      try {
        const response = await customerAuthRequest("session", { cache: "no-store" });
        if (!response.ok) {
          if ([401, 403, 410].includes(response.status)) {
            clearCustomerAuthTokens();
            if (active) setAuthUser(null);
          }
          return;
        }
        const result = await response.json() as { user?: CustomerAuthUser | null };
        if (!active) return;
        const user = result.user || null;
        if (!user) {
          // A valid browser token is the last known authenticated state. Do not
          // erase it when the external session endpoint briefly returns an
          // empty response during checkout or another network transition.
          if (storedUser) {
            setAuthUser(storedUser);
            setCheckoutForm((current) => ({ ...current, phone: current.phone || storedUser.phone }));
            return;
          }
          clearCustomerAuthTokens();
          setAuthUser(null);
          return;
        }
        setAuthUser(user);
        if (user) setCheckoutForm((current) => ({ ...current, phone: current.phone || user.phone }));
      } catch {
        // Keep a locally restorable session through temporary network/CORS failures.
        // The next successful session check will still validate the token server-side.
        if (active && !storedUser) setAuthUser(null);
      }
    };
    void loadCustomerSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const timeout = window.setTimeout(() => {
      if (authJustVerified) setAuthJustVerified(false);
      if (window.localStorage.getItem(checkoutAfterAuthKey) === "1" && cartItems.length) {
        window.localStorage.removeItem(checkoutAfterAuthKey);
        setAuthOpen(false);
        setCheckoutOpen(true);
      }
      if (window.localStorage.getItem(ordersAfterAuthKey) === "1") {
        window.localStorage.removeItem(ordersAfterAuthKey);
        setAuthOpen(false);
        setOrdersOpen(true);
      }
    }, authJustVerified ? 1400 : 0);
    return () => window.clearTimeout(timeout);
  }, [authUser, authJustVerified, cartItems.length]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const syncAnnouncement = async () => {
      const remote = await fetchStoreSetting("announcement");
      if (!remote.error && remote.value !== null) {
        setAnnouncementText(remote.value);
        window.localStorage.setItem("fanzzy-announcement", remote.value);
        return;
      }
      const stored = window.localStorage.getItem("fanzzy-announcement");
      if (stored !== null) setAnnouncementText(stored);
    };
    void syncAnnouncement();
    window.addEventListener("storage", syncAnnouncement);
    window.addEventListener("fanzzy-announcement-updated", syncAnnouncement);
    return () => {
      window.removeEventListener("storage", syncAnnouncement);
      window.removeEventListener("fanzzy-announcement-updated", syncAnnouncement);
    };
  }, []);

  useEffect(() => {
    const syncMarketing = async () => {
      const remote = await fetchStoreSetting("marketingRecords");
      const stored = remote.value || window.localStorage.getItem("fanzzy-marketing-records");
      if (!stored) {
        setMarketingRecords([]);
        setActiveCampaign(null);
        return;
      }
      try {
        const parsed = JSON.parse(stored) as MarketingRecord[];
        const valid = Array.isArray(parsed) ? parsed.filter((record) => record?.name) : [];
        setMarketingRecords(valid);
        const active = valid.find((record) => record?.status === "Active" && record?.name);
        setActiveCampaign(active ?? null);
      } catch {
        setMarketingRecords([]);
        setActiveCampaign(null);
      }
    };
    void syncMarketing();
    window.addEventListener("storage", syncMarketing);
    window.addEventListener("fanzzy-marketing-updated", syncMarketing);
    return () => {
      window.removeEventListener("storage", syncMarketing);
      window.removeEventListener("fanzzy-marketing-updated", syncMarketing);
    };
  }, []);

  useEffect(() => {
    const syncPromotions = async () => {
      const remote = await fetchStoreSetting("promotionalOffers");
      const stored = remote.value || window.localStorage.getItem(promotionStorageKey);
      if (!stored) { setPromotionalOffers([]); return; }
      try {
        const parsed = JSON.parse(stored) as unknown[];
        setPromotionalOffers(parsed.map(normalizePromotionOffer).filter((offer): offer is PromotionOffer => Boolean(offer && isPromotionLive(offer))));
      } catch { setPromotionalOffers([]); }
    };
    void syncPromotions();
    window.addEventListener("storage", syncPromotions);
    window.addEventListener("fanzzy-promotions-updated", syncPromotions);
    return () => {
      window.removeEventListener("storage", syncPromotions);
      window.removeEventListener("fanzzy-promotions-updated", syncPromotions);
    };
  }, []);

  useEffect(() => {
    const syncHeroSlides = async () => {
      const remoteSlides = await fetchStoreSetting("heroSlides");
      const storedSlides = remoteSlides.value || window.localStorage.getItem("fanzzy-hero-slides");
      if (storedSlides) {
        try {
          const parsed = JSON.parse(storedSlides);
          const allowedSlides = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0 && !value.includes(blockedHeroImage)).slice(0, 4) : [];
          if (allowedSlides.length) {
            setHeroSlides(allowedSlides);
            return;
          }
        } catch {
          window.localStorage.removeItem("fanzzy-hero-slides");
        }
      }
      const legacy = await fetchStoreSetting("heroImage");
      const storedLegacy = legacy.value || window.localStorage.getItem("fanzzy-hero-image");
      if (storedLegacy && !storedLegacy.includes(blockedHeroImage)) setHeroSlides([storedLegacy]);
    };
    void syncHeroSlides();
    window.addEventListener("storage", syncHeroSlides);
    window.addEventListener("fanzzy-hero-updated", syncHeroSlides);
    window.addEventListener("fanzzy-hero-slides-updated", syncHeroSlides);
    return () => {
      window.removeEventListener("storage", syncHeroSlides);
      window.removeEventListener("fanzzy-hero-updated", syncHeroSlides);
      window.removeEventListener("fanzzy-hero-slides-updated", syncHeroSlides);
    };
  }, []);

  useEffect(() => {
    if (!heroSlides.length) return;
    setHeroSlideIndex(0);
    const timer = window.setInterval(() => {
      setHeroSlideIndex((current) => (current + 1) % heroSlides.length);
    }, heroSlideDuration * 1000);
    return () => window.clearInterval(timer);
  }, [heroSlides, heroSlideDuration]);

  useEffect(() => {
    const syncHeroSlideDuration = async () => {
      const remote = await fetchStoreSetting("heroSlideDuration");
      const stored = remote.value || window.localStorage.getItem("fanzzy-hero-slide-duration");
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) setHeroSlideDuration(Math.min(30, Math.max(2, parsed)));
    };
    void syncHeroSlideDuration();
    window.addEventListener("storage", syncHeroSlideDuration);
    window.addEventListener("fanzzy-hero-slides-updated", syncHeroSlideDuration);
    return () => {
      window.removeEventListener("storage", syncHeroSlideDuration);
      window.removeEventListener("fanzzy-hero-slides-updated", syncHeroSlideDuration);
    };
  }, []);

  const announce = (message: string) => setToast(message);
  const openSearch = () => {
    setSearch("");
    setSearchOpen(true);
  };
  const closeSearch = () => {
    setSearch("");
    setSearchOpen(false);
  };
  const subscribeNewsletter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    const remote = await fetchStoreSetting("newsletterSubscribers");
    let subscribers: string[] = [];
    if (remote.value) {
      try {
        const parsed = JSON.parse(remote.value) as unknown;
        if (Array.isArray(parsed))
          subscribers = parsed.filter((item): item is string => typeof item === "string");
      } catch {
        subscribers = [];
      }
    }
    if (!subscribers.includes(normalizedEmail)) subscribers.push(normalizedEmail);
    const saveError = await saveStoreSetting(
      "newsletterSubscribers",
      JSON.stringify(subscribers),
    );
    if (saveError) {
      setNewsletterMessage("Please try again in a moment.");
      return;
    }
    setEmail("");
    setSubscribed(true);
    setNewsletterMessage("You’re on the list. Welcome to Fanzzy.");
  };
  const toggleWishlist = (id: string) => {
    setWishlist((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    announce(wishlist.includes(id) ? "Removed from wishlist" : "Saved to wishlist");
  };
  const addToCart = (product: Product, variant: ProductVariant | null = null, size: string | null = null) => {
    if (getProductVariantType(product) === "normal" && product.variants?.length && !variant) {
      openQuickProduct(product);
      return;
    }
    if (getProductVariantType(product) === "size" && getProductSizes(product).length && !size) {
      openQuickProduct(product);
      return;
    }
    if (getSelectionStock(product, variant, size) <= 0) return announce(`${product.name}${size ? ` · Size ${size}` : ""}${variant?.name ? ` · ${variant.name}` : ""} is sold out`);
    const cartKey = [product.id, variant ? (variant.name || variant.image) : "", size || ""].filter(Boolean).join("::");
    setCart((current) => ({ ...current, [cartKey]: 1 }));
    if (variant) setCartVariants((current) => ({ ...current, [cartKey]: variant }));
    if (size) setCartSizes((current) => ({ ...current, [cartKey]: size }));
    setCartOpen(true);
    announce(`${product.name}${variant?.name ? ` · ${variant.name}` : ""} added to cart`);
  };
  const addPromotionToCart = (offer: PromotionOffer) => {
    if (!quickProduct) return;
    const paidSelection = makePromotionSelection(quickProduct, selectedVariant, selectedSize);
    const paid = Array.from({ length: offer.type === "bundle" ? 0 : offer.buyQuantity }, () => paidSelection);
    const free = offer.type === "bundle" ? [] : selectedFreeSelections;
    const bundle = offer.type === "bundle" ? selectedBundleSelections : [];
    const error = validatePromotionSelection(offer, offer.type === "bundle" ? bundle : paid, free);
    if (error) return announce(error);
    const chosen = offer.type === "bundle" ? bundle : [...paid, ...free];
    if (chosen.some((selection) => (selection.stock || 0) <= 0)) return announce("One of the selected variants is out of stock");
    const groupId = `${offer.id}-${Date.now()}`;
    const prices = offer.type === "bundle" ? allocateBundlePrices(bundle, offer.fixedBundlePrice) : paid.map(() => 0).concat(free.map(() => 0));
    const addLine = (selection: PromotionSelection, index: number, role: PromotionCartLine["role"], linePrice: number) => {
      const product = products.find((item) => item.id === selection.productId || item.sku === selection.sku) || quickProduct;
      const variant = product.variants?.find((item) => item.name === selection.variantName) || null;
      const size = selection.size || null;
      const cartKey = `${product.id}::${variant?.name || ""}::${size || ""}::offer-${groupId}-${index}`;
      setCart((current) => ({ ...current, [cartKey]: 1 }));
      if (variant) setCartVariants((current) => ({ ...current, [cartKey]: variant }));
      if (size) setCartSizes((current) => ({ ...current, [cartKey]: size }));
      setCartPromotionLines((current) => ({ ...current, [cartKey]: { groupId, offerId: offer.id, role, label: offerTypeLabel(offer), regularPrice: selection.price || product.price, linePrice } }));
    };
    if (offer.type === "bundle") bundle.forEach((selection, index) => addLine(selection, index, "bundle", prices[index] || 0));
    else {
      paid.forEach((selection, index) => addLine(selection, index, "paid", selection.price || 0));
      free.forEach((selection, index) => addLine(selection, paid.length + index, "free", 0));
    }
    setCartOpen(true);
    closeQuickProduct();
    announce(`${offerTypeLabel(offer)} added to cart`);
  };
  const updateQuantity = (cartKey: string, delta: number) => {
    const productId = cartKey.split("::", 1)[0];
    const product = products.find((item) => item.id === productId);
    const variant = cartVariants[cartKey];
    const size = cartSizes[cartKey];
    if (delta > 0 && product && getSelectionStock(product, variant, size) <= (cart[cartKey] ?? 0)) return announce(`${product.name}${size ? ` · Size ${size}` : ""} has no more stock available`);
    setCart((current) => {
      const next = Math.max(0, (current[cartKey] ?? 0) + delta);
      const updated = { ...current };
      if (next === 0) delete updated[cartKey]; else updated[cartKey] = next;
      return updated;
    });
    if ((cart[cartKey] ?? 0) + delta <= 0) {
      setCartVariants((current) => {
        const updated = { ...current };
        delete updated[cartKey];
        return updated;
      });
      setCartSizes((current) => { const updated = { ...current }; delete updated[cartKey]; return updated; });
      setCartPromotionLines((current) => { const updated = { ...current }; delete updated[cartKey]; return updated; });
    }
  };
  const removeFromCart = (cartKey: string) => {
    setCart((current) => {
      const updated = { ...current };
      delete updated[cartKey];
      return updated;
    });
    setCartVariants((current) => {
      const updated = { ...current };
      delete updated[cartKey];
      return updated;
    });
    setCartSizes((current) => { const updated = { ...current }; delete updated[cartKey]; return updated; });
    setCartPromotionLines((current) => { const updated = { ...current }; delete updated[cartKey]; return updated; });
    announce("Item removed from cart");
  };
  const closeAuth = useCallback(() => {
    window.localStorage.removeItem(checkoutAfterAuthKey);
    window.localStorage.removeItem(ordersAfterAuthKey);
    setAuthOpen(false);
    setAuthMessage("");
    setAuthOtp("");
    setOtpSent(false);
    setOtpCooldown(0);
    setAuthJustVerified(false);
  }, []);
  const activeOverlayLayers = useMemo(() => [
    mobileNavOpen && "mobileNav",
    searchOpen && "search",
    privacyOpen && "privacy",
    returnPolicyOpen && "returnPolicy",
    termsOpen && "terms",
    assistantOpen && "assistant",
    profileOpen && "profile",
    savedOpen && "saved",
    ordersOpen && "orders",
    cartOpen && "cart",
    authOpen && "auth",
    checkoutOpen && "checkout",
    orderConfirmation && "orderConfirmation",
    quickProduct && "quickProduct",
    zoomedImage && "zoomedImage",
  ].filter((layer): layer is string => Boolean(layer)), [
    mobileNavOpen,
    searchOpen,
    privacyOpen,
    returnPolicyOpen,
    termsOpen,
    assistantOpen,
    profileOpen,
    savedOpen,
    ordersOpen,
    cartOpen,
    authOpen,
    checkoutOpen,
    orderConfirmation,
    quickProduct,
    zoomedImage,
  ]);
  const activeOverlayKey = activeOverlayLayers.join("|");

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useEffect(() => {
    const previousLayers = overlayHistoryStack.current;

    if (overlayRestoredFromUrl.current) {
      overlayRestoredFromUrl.current = false;
      // A quick-view URL can be restored directly (for example from a
      // refreshed tab or a shared link). Normalize it to two entries so Back
      // returns to this same listing page instead of leaving the storefront.
      const restoredPageHistoryState: StorefrontPageHistoryState = {
        activeCategory,
        search,
        scrollY: Math.round(window.scrollY),
      };
      overlayPageState.current = restoredPageHistoryState;
      const restoredScrollY = Math.round(window.scrollY);
      window.history.replaceState(
        {
          ...window.history.state,
          fanzzyPage: restoredPageHistoryState,
          fanzzyOverlayScrollY: restoredScrollY,
        },
        "",
        overlayHistoryUrl([], undefined),
      );
      for (let index = 0; index < activeOverlayLayers.length; index += 1) {
        window.history.pushState(
          {
            ...window.history.state,
            fanzzyOverlay: activeOverlayLayers[index],
            fanzzyPage: restoredPageHistoryState,
            fanzzyOverlayScrollY: restoredScrollY,
          },
          "",
          overlayHistoryUrl(activeOverlayLayers.slice(0, index + 1), quickProduct?.id),
        );
      }
      overlayScrollY.current = restoredScrollY;
      overlayHistoryStack.current = activeOverlayLayers;
      return;
    }

    // State was already reduced by the Back-button handler, so no replacement
    // history entry should be created during this render.
    if (overlayClosedFromBack.current) {
      overlayClosedFromBack.current = false;
      overlayHistoryStack.current = activeOverlayLayers;
      return;
    }

    const previousIsCurrentPrefix = previousLayers.every(
      (layer, index) => activeOverlayLayers[index] === layer,
    );
    const currentIsPreviousPrefix = activeOverlayLayers.every(
      (layer, index) => previousLayers[index] === layer,
    );

    if (activeOverlayLayers.length > previousLayers.length && previousIsCurrentPrefix) {
      // Opening a new layer (for example product popup, then photo zoom) gets
      // exactly one same-page history entry per layer.
      overlayLastBackUrl.current = null;
      const pageHistoryState: StorefrontPageHistoryState = {
        activeCategory,
        search,
        scrollY: Math.round(window.scrollY),
      };
      overlayPageState.current = pageHistoryState;
      window.history.replaceState(
        { ...window.history.state, fanzzyPage: pageHistoryState },
        "",
        window.location.href,
      );
      if (previousLayers.length === 0) {
        overlayScrollY.current = Math.round(window.scrollY);
        window.history.replaceState(
          {
            ...window.history.state,
            fanzzyOverlayScrollY: Math.round(window.scrollY),
            fanzzyPage: pageHistoryState,
          },
          "",
          window.location.href,
        );
      }
      if (quickProduct) window.sessionStorage.setItem("fanzzy-overlay-product", JSON.stringify(quickProduct));
      for (let index = previousLayers.length; index < activeOverlayLayers.length; index += 1) {
        window.history.pushState(
          { ...window.history.state, fanzzyOverlay: activeOverlayLayers[index] },
          "",
          overlayHistoryUrl(activeOverlayLayers.slice(0, index + 1), quickProduct?.id),
        );
      }
    } else if (activeOverlayLayers.length < previousLayers.length && currentIsPreviousPrefix) {
      // An on-screen close button already removed the layer. Consume its
      // same-page history entry without closing the next layer underneath it.
      const removedLayerCount = previousLayers.length - activeOverlayLayers.length;
      overlayHistoryStack.current = activeOverlayLayers;
      overlayHistoryCleanup.current = true;
      if (activeOverlayLayers.length === 0) {
        overlayScrollY.current = null;
      }
      window.history.go(-removedLayerCount);
      return;
    } else if (activeOverlayKey !== previousLayers.join("|") && activeOverlayLayers.length) {
      // Replacing one drawer with another (cart -> login, profile -> orders)
      // reuses the current entry instead of adding a misleading extra Back step.
      const pageHistoryState: StorefrontPageHistoryState = {
        activeCategory,
        search,
        scrollY: Math.round(window.scrollY),
      };
      overlayPageState.current = pageHistoryState;
      window.history.replaceState(
        {
          ...window.history.state,
          fanzzyOverlay: activeOverlayLayers.at(-1),
          fanzzyPage: pageHistoryState,
          fanzzyOverlayScrollY: Math.round(window.scrollY),
        },
        "",
        overlayHistoryUrl(activeOverlayLayers, quickProduct?.id),
      );
    }

    overlayHistoryStack.current = activeOverlayLayers;
  }, [activeCategory, activeOverlayKey, activeOverlayLayers, search]);

  useEffect(() => {
    // Keep the current listing snapshot up to date without adding a history
    // entry. This also records a live search query while the search drawer is
    // open, before a product view replaces that drawer in the same entry.
    const pageHistoryState: StorefrontPageHistoryState = {
      activeCategory,
      search,
      scrollY: Math.round(window.scrollY),
    };
    overlayPageState.current = pageHistoryState;
    window.history.replaceState(
      { ...window.history.state, fanzzyPage: pageHistoryState },
      "",
      window.location.href,
    );
  }, [activeCategory, search]);

  useEffect(() => {
    const closeOverlayFromBack = () => {
      if (overlayHistoryCleanup.current) {
        overlayHistoryCleanup.current = false;
        return;
      }
      if (overlayClosedFromBack.current) return;
      const backUrl = window.location.href;
      if (overlayLastBackUrl.current === backUrl) return;
      overlayLastBackUrl.current = backUrl;

      const topLayer = activeOverlayLayers.at(-1);
      if (!topLayer) return;

      const savedScrollState = window.history.state?.fanzzyOverlayScrollY;
      const pageHistoryState = overlayPageState.current;
      const savedScrollY = Number(overlayScrollY.current ?? savedScrollState ?? pageHistoryState?.scrollY);
      overlayClosedFromBack.current = true;
      overlayHistoryStack.current = activeOverlayLayers.slice(0, -1);

      if (pageHistoryState?.activeCategory) setActiveCategory(pageHistoryState.activeCategory);
      if (typeof pageHistoryState?.search === "string") setSearch(pageHistoryState.search);

      if (Number.isFinite(savedScrollY)) {
        const restoreScroll = () => {
          window.scrollTo({ top: savedScrollY, behavior: "auto" });
          document.documentElement.scrollTop = savedScrollY;
          document.body.scrollTop = savedScrollY;
        };
        restoreScroll();
        [50, 200, 600].forEach((delay) => window.setTimeout(restoreScroll, delay));
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            window.scrollTo({ top: savedScrollY, behavior: "auto" });
            if (activeOverlayLayers.length === 1) {
              overlayScrollY.current = null;
            }
          });
        });
      }

      switch (topLayer) {
        case "zoomedImage": setZoomedImage(null); break;
        case "quickProduct": setQuickProduct(null); break;
        case "orderConfirmation": setOrderConfirmation(null); break;
        case "checkout": setCheckoutOpen(false); break;
        case "auth": closeAuth(); break;
        case "cart": setCartOpen(false); break;
        case "orders": setOrdersOpen(false); break;
        case "saved": setSavedOpen(false); break;
        case "profile": setProfileOpen(false); break;
        case "assistant": setAssistantOpen(false); break;
        case "search": setSearchOpen(false); break;
        case "terms": setTermsOpen(false); break;
        case "returnPolicy": setReturnPolicyOpen(false); break;
        case "privacy": setPrivacyOpen(false); break;
        case "mobileNav": setMobileNavOpen(false); break;
      }
    };

    window.addEventListener("popstate", closeOverlayFromBack);
    return () => window.removeEventListener("popstate", closeOverlayFromBack);
  }, [activeOverlayKey, activeOverlayLayers, closeAuth]);
  const signOut = async () => {
    await customerAuthRequest("sign-out", { method: "POST" });
    clearCustomerAuthTokens();
    setAuthUser(null);
    setProfileOpen(false);
    announce("Signed out successfully");
  };
  const sendOtp = async () => {
    const phone = authPhone.trim();
    if (!phone) {
      setAuthMessage("Enter your mobile number to receive a code.");
      return;
    }
    if (otpCooldown > 0) {
      setAuthMessage(`Please wait ${otpCooldown} seconds before requesting another OTP.`);
      return;
    }
    setAuthLoading(true);
    setAuthMessage("");
    try {
      const response = await customerAuthRequest("send-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const responseText = await response.text();
      let result: { error?: string; pendingToken?: string } = {};
      if (responseText) {
        try {
          result = JSON.parse(responseText) as { error?: string };
        } catch {
          // Static hosts can return an HTML/empty error page instead of JSON.
        }
      }
      if (!response.ok) {
        setAuthMessage(
          result.error
            || (response.status === 404 || response.status === 405
              ? "SMS login is unavailable on this deployment. Please try again later."
              : response.status >= 500
                ? "The SMS OTP service is temporarily unavailable. Please try again in a moment."
                : "We could not send the SMS OTP."),
        );
        return;
      }
      setOtpSent(true);
      saveCustomerAuthTokens(result);
      setOtpCooldown(60);
      setAuthMessage("OTP sent successfully by SMS");
    } catch {
      setAuthMessage("Could not connect to the SMS OTP service. Check your connection and try again.");
    } finally {
      setAuthLoading(false);
    }
  };
  const sendVoiceOtp = async () => {
    const phone = authPhone.trim();
    if (!phone) {
      setAuthMessage("Enter your mobile number to receive a call.");
      return;
    }
    if (otpCooldown > 0) {
      setAuthMessage(`Please wait ${otpCooldown} seconds before requesting another OTP.`);
      return;
    }
    setAuthLoading(true);
    setAuthMessage("");
    try {
      const response = await customerAuthRequest("send-voice-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const responseText = await response.text();
      let result: { error?: string; pendingToken?: string } = {};
      if (responseText) {
        try { result = JSON.parse(responseText) as { error?: string; pendingToken?: string }; } catch { /* handled below */ }
      }
      if (!response.ok) {
        setAuthMessage(result.error || (response.status >= 500 ? "The voice OTP service is temporarily unavailable." : "We could not start the voice OTP call."));
        return;
      }
      setOtpSent(true);
      saveCustomerAuthTokens(result);
      setOtpCooldown(60);
      setAuthMessage("Your OTP is being read by an automated voice call.");
    } catch {
      setAuthMessage("Could not connect to the voice OTP service. Check your connection and try again.");
    } finally {
      setAuthLoading(false);
    }
  };
  const verifyOtp = async () => {
    const token = authOtp.trim();
    if (!token) {
      setAuthMessage("Enter the 6-digit verification code from SMS or voice call.");
      return;
    }
    setAuthLoading(true);
    setAuthMessage("");
    try {
      const response = await customerAuthRequest("verify-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: token }),
      });
      const result = await response.json() as { error?: string; user?: CustomerAuthUser; sessionToken?: string };
      if (!response.ok || !result.user) {
        setAuthMessage(result.error || (response.status === 410 ? "OTP expired" : "Invalid OTP"));
        return;
      }
      saveCustomerAuthTokens(result);
      clearPendingCustomerAuthToken();
      setAuthUser(result.user);
      setCheckoutForm((current) => ({ ...current, phone: current.phone || result.user!.phone }));
      setAuthOtp("");
      setOtpSent(false);
      setOtpCooldown(0);
      setAuthJustVerified(true);
      setAuthMessage("OTP verified successfully");
    } catch {
      setAuthMessage("Please try again");
    } finally {
      setAuthLoading(false);
    }
  };
  const openCheckout = async () => {
    if (!cartItems.length) return announce("Add a piece to your cart first");
    if (cartStockIssues.length) return announce(cartHasSoldOutItems ? "Remove sold out items before checkout" : "Reduce item quantities before checkout");
    if (!authUser) {
      window.localStorage.setItem(checkoutAfterAuthKey, "1");
      setCartOpen(false);
      setAuthMessage("");
      setAuthOpen(true);
      return;
    }
    setCartOpen(false);
    setCheckoutOpen(true);
  };
  const openOrders = () => {
    if (authUser) {
      setOrdersOpen(true);
      return;
    }
    window.localStorage.setItem(ordersAfterAuthKey, "1");
    setAuthMessage("Sign in with a one-time SMS or voice code to view your orders.");
    setAuthOpen(true);
  };
  const applyCoupon = () => {
    const code = normalizeCouponCode(couponInput);
    if (!code) return announce("Enter a coupon code");
    const source = marketingRecords;
    const coupon = source.find((record) => String(record.kind || "").toLowerCase() === "coupon" && String(record.status || "").toLowerCase() === "active" && normalizeCouponCode(record.code) === code);
    if (!coupon) {
      setAppliedCoupon(null);
      return announce("That coupon is not active or does not exist");
    }
    if (!getCouponDiscount(coupon, subtotal)) return announce("This coupon has no valid discount");
    setAppliedCoupon(coupon);
    setCouponInput(code);
    announce(`${code} applied`);
  };
  const decrementLocalInventory = (items: NonNullable<CustomerOrder["items"]>) => {
    const normalizeInventoryKey = (value?: string) => String(value || "").trim().replace(/[^a-z0-9]/gi, "").toLowerCase();
    let changed = false;
    const next = products.map((product) => {
        const matchingItems = items.filter((item) => {
          const itemId = normalizeInventoryKey(item.productId);
          return itemId && (itemId === normalizeInventoryKey(product.id) || itemId === normalizeInventoryKey(product.sku));
        });
        if (!matchingItems.length) return product;

        const updated: Product = {
          ...product,
          variants: product.variants?.map((variant) => ({ ...variant })),
          sizeStock: { ...(product.sizeStock || {}) },
        };
        matchingItems.forEach((item) => {
          const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
          if (!quantity) return;
          const normalizedSize = normalizeInventoryKey(item.size);
          const normalizedVariant = normalizeInventoryKey(item.variantName);
          if (normalizedSize) {
            const sizeKey = Object.keys(updated.sizeStock || {}).find((key) => normalizeInventoryKey(key) === normalizedSize) || item.size!;
            const sizeVariantIndex = updated.variants?.findIndex((variant) => normalizeInventoryKey(variant.size || variant.name) === normalizedSize) ?? -1;
            const sizeVariant = sizeVariantIndex >= 0 ? updated.variants?.[sizeVariantIndex] : undefined;
            const currentSizeStock = updated.sizeStock?.[sizeKey] ?? (sizeVariant?.stock ?? updated.stock);
            updated.sizeStock = { ...(updated.sizeStock || {}), [sizeKey]: Math.max(0, Math.floor(Number(currentSizeStock) - quantity)) };
            if (sizeVariantIndex >= 0 && updated.variants) {
              updated.variants[sizeVariantIndex] = {
                ...updated.variants[sizeVariantIndex],
                stock: Math.max(0, Math.floor(Number(updated.variants[sizeVariantIndex].stock ?? currentSizeStock) - quantity)),
              };
            }
            changed = true;
            return;
          }
          if (normalizedVariant && updated.variants?.length) {
            const variantIndex = updated.variants.findIndex((variant) => normalizeInventoryKey(variant.name) === normalizedVariant);
            if (variantIndex >= 0) {
              const variant = updated.variants[variantIndex];
              updated.variants[variantIndex] = {
                ...variant,
                stock: Math.max(0, Math.floor(Number(variant.stock ?? updated.stock) - quantity)),
              };
              changed = true;
              return;
            }
          }
          updated.stock = Math.max(0, Math.floor(Number(updated.stock) - quantity));
          changed = true;
        });
        return updated;
    });
    if (!changed) return false;
    setProducts(next);
    window.localStorage.setItem("fanzzy-products", JSON.stringify(next));
    const variantCache = Object.fromEntries(next.filter((product) => product.variants?.length).flatMap((product) => [
      [product.sku, product.variants],
      [product.id, product.variants],
    ]));
    window.localStorage.setItem(localProductVariantsKey, JSON.stringify(variantCache));
    window.dispatchEvent(new Event("fanzzy-products-updated"));
    return true;
  };
  const decrementLocalInventoryOnce = (order: CustomerOrder) => {
    const adjustmentId = order.razorpayPaymentId || order.id;
    if (!adjustmentId) return;
    const storageKey = `fanzzy-local-inventory-adjustments:${authUser?.id || "guest"}`;
    let adjustedIds: string[] = [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]") as unknown;
      if (Array.isArray(parsed)) adjustedIds = parsed.filter((value): value is string => typeof value === "string");
    } catch {
      adjustedIds = [];
    }
    if (adjustedIds.includes(adjustmentId) || !decrementLocalInventory(order.items || [])) return;
    window.localStorage.setItem(storageKey, JSON.stringify([...adjustedIds, adjustmentId].slice(-250)));
  };
  const persistPaidOrder = async (newOrder: CustomerOrder) => {
    if (!authUser) {
      setIsPaying(false);
      setCheckoutOpen(false);
      setAuthMessage("Sign in with a one-time SMS or voice code before placing an order.");
      setAuthOpen(true);
      return;
    }
    let previousOrders: unknown[] = [];
    try {
      const stored = window.localStorage.getItem(`fanzzy-orders:${authUser.id}`);
      const parsed = stored ? JSON.parse(stored) : [];
      if (Array.isArray(parsed)) previousOrders = parsed;
    } catch {
      previousOrders = [];
    }
    const remote = await fetchStoreOrders<CustomerOrder>();
    const merged = new Map<string, CustomerOrder>();
    remote.data?.forEach((order) => { if (order?.id) merged.set(order.id, order); });
    previousOrders.forEach((order) => {
      if (order && typeof order === "object" && "id" in order && typeof order.id === "string" && !merged.has(order.id)) {
        merged.set(order.id, order as CustomerOrder);
      }
    });
    const existingPayment = Array.from(merged.values()).find((order) =>
      order.razorpayPaymentId && order.razorpayPaymentId === newOrder.razorpayPaymentId,
    );
    if (existingPayment) {
      const userOrders = Array.from(merged.values()).filter((order) => belongsToCustomer(order, authUser));
      window.localStorage.setItem(`fanzzy-orders:${authUser.id}`, JSON.stringify(userOrders));
      window.localStorage.setItem("fanzzy-orders", JSON.stringify(Array.from(merged.values())));
      window.dispatchEvent(new Event("fanzzy-orders-updated"));
      setOrderConfirmation(existingPayment);
      decrementLocalInventoryOnce(existingPayment);
      setCart({});
      setCartVariants({});
      setCartPromotionLines({});
      setCheckoutOpen(false);
      setFulfillmentMethod("delivery");
      setSelectedPickupHubId("");
      setIsPaying(false);
      announce(`${existingPayment.id} was already confirmed`);
      return;
    }
    const nextOrders = [newOrder, ...Array.from(merged.values()).filter((order) => order.id !== newOrder.id)];
    await saveStoreOrders(nextOrders);
    window.localStorage.setItem("fanzzy-orders", JSON.stringify(nextOrders));
    const userOrders = nextOrders.filter((order) => belongsToCustomer(order, authUser) && isPaidOrder(order));
    window.localStorage.setItem(`fanzzy-orders:${authUser.id}`, JSON.stringify(userOrders));
    window.dispatchEvent(new Event("fanzzy-orders-updated"));
    setOrderConfirmation(newOrder);
    setCart({});
    setCartVariants({});
    setCartPromotionLines({});
    setCheckoutOpen(false);
    setFulfillmentMethod("delivery");
    setSelectedPickupHubId("");
    setCheckoutForm({ name: "", phone: "", email: "", address: "" });
    setCouponInput("");
    setAppliedCoupon(null);
    setIsPaying(false);
    decrementLocalInventoryOnce(newOrder);
    window.dispatchEvent(new Event("fanzzy-products-updated"));
    announce(`${newOrder.id} placed successfully`);
  };
  const persistPendingOrder = async (newOrder: CustomerOrder) => {
    if (!authUser) throw new Error("Sign in before placing an order");
    const remote = await fetchStoreOrders<CustomerOrder>();
    const merged = new Map<string, CustomerOrder>();
    remote.data?.forEach((order) => { if (order?.id) merged.set(order.id, order); });
    try {
      const stored = window.localStorage.getItem(`fanzzy-orders:${authUser.id}`);
      const localOrders = stored ? JSON.parse(stored) : [];
      if (Array.isArray(localOrders)) {
        localOrders.forEach((order) => {
          if (order?.id && !merged.has(order.id)) merged.set(order.id, order as CustomerOrder);
        });
      }
    } catch {
      // A corrupt local cache must not prevent the server-side order record.
    }
    const nextOrders = [newOrder, ...Array.from(merged.values()).filter((order) => order.id !== newOrder.id)];
    const saveError = await saveStoreOrders(nextOrders);
    // Keep a browser-local copy when Supabase is temporarily unavailable.
    window.localStorage.setItem("fanzzy-orders", JSON.stringify(nextOrders));
    window.localStorage.setItem(
      `fanzzy-orders:${authUser.id}`,
      JSON.stringify(nextOrders.filter((order) => belongsToCustomer(order, authUser))),
    );
    window.dispatchEvent(new Event("fanzzy-orders-updated"));
  };
  const submitCheckout = async () => {
    if (isPaying) return;
    if (!authUser) {
      setCheckoutOpen(false);
      setAuthMessage("Sign in with a one-time SMS or voice code before placing an order.");
      setAuthOpen(true);
      return;
    }
    if (cartStockIssues.length) return announce(cartHasSoldOutItems ? "Remove sold out items before checkout" : "Reduce item quantities before checkout");
    const name = checkoutForm.name.trim();
    const digits = checkoutForm.phone.replace(/\D/g, "");
    if (!name) return announce("Customer name is required");
    if (digits.length < 10) return announce("A valid WhatsApp number is mandatory");
    if (fulfillmentMethod === "pickup" && !selectedPickupHub) return announce("Select a pickup hub");
    if (fulfillmentMethod === "delivery" && !checkoutForm.address.trim()) return announce("Delivery address is required");
    const orderAddress = fulfillmentMethod === "pickup" && selectedPickupHub
      ? `Pickup from ${selectedPickupHub.name} · ${selectedPickupHub.place}`
      : checkoutForm.address.trim();

    const orderToken = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(-6).toUpperCase() || "000000";
    const orderId = `#FZ-${orderToken}`;
    const pendingOrder: CustomerOrder = {
      id: orderId,
      userId: authUser.id,
      userPhone: authUser.phone,
      date: new Date().toISOString().slice(0, 10),
      status: "Processing",
      total: formatINR(orderTotal),
      customerName: name,
      phone: checkoutForm.phone.trim(),
      email: checkoutForm.email.trim(),
      address: orderAddress,
      fulfillmentMethod,
      ...(fulfillmentMethod === "pickup" && selectedPickupHub ? {
        pickupHubId: selectedPickupHub.id,
        pickupHubName: selectedPickupHub.name,
        pickupHubPlace: selectedPickupHub.place,
      } : {}),
      paymentStatus: "pending",
      ...(appliedCoupon ? { coupon: appliedCoupon.code } : {}),
      items: cartItems.map((product) => ({ productId: product.id, name: `${product.billName || product.name}${product.variant?.name ? ` · ${product.variant.name}` : ""}${product.size ? ` · Size ${product.size}` : ""}`, quantity: product.quantity, price: formatINR(getCartLinePrice(product)), image: product.image, variantName: product.variant?.name, variantImage: product.variant?.image, size: product.size || undefined, promotion: product.promotion || undefined })),
    };

    setIsPaying(true);
    try {
      // Save before opening Razorpay so a completed payment can always be matched
      // in Admin Orders, even if the customer's browser closes during the callback.
      await persistPendingOrder(pendingOrder);
      const orderResponse = await fetch(razorpayApiUrl("order"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Math.round(orderTotal * 100), receipt: orderId.replace("#", ""), fanzzyOrderId: orderId }),
      });
      const razorpayOrder = await readRazorpayResponse<{ id?: string; amount?: number; currency?: string; keyId?: string; error?: string }>(orderResponse);
      if (!orderResponse.ok || !razorpayOrder.id || !razorpayOrder.keyId) throw new Error(razorpayOrder.error || "Razorpay order creation failed");
      await persistPendingOrder({ ...pendingOrder, razorpayOrderId: razorpayOrder.id });
      const Razorpay = await loadRazorpayCheckout();
      const checkout = new Razorpay({
        key: razorpayOrder.keyId,
        amount: razorpayOrder.amount || Math.round(orderTotal * 100),
        currency: razorpayOrder.currency || "INR",
        name: "Fanzzy",
        description: `Fanzzy order ${orderId}`,
        order_id: razorpayOrder.id,
        prefill: { name, contact: checkoutForm.phone.trim(), ...(checkoutForm.email.trim() ? { email: checkoutForm.email.trim() } : {}) },
        notes: { address: orderAddress, fanzzy_order_id: orderId },
        theme: { color: "#4b1c2b" },
        handler: (payment) => {
          void (async () => {
            try {
              const verifyResponse = await fetch(razorpayApiUrl("verify"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  razorpayOrderId: payment.razorpay_order_id,
                  razorpayPaymentId: payment.razorpay_payment_id,
                  razorpaySignature: payment.razorpay_signature,
                }),
              });
              const verification = await readRazorpayResponse<{ verified?: boolean; error?: string; inventoryAdjusted?: boolean }>(verifyResponse);
              if (!verifyResponse.ok || !verification.verified) throw new Error(verification.error || "Payment verification failed");
              const paidOrder = { ...pendingOrder, paymentStatus: "paid" as const, razorpayOrderId: payment.razorpay_order_id, razorpayPaymentId: payment.razorpay_payment_id, inventoryAdjusted: verification.inventoryAdjusted !== false };
              await persistPaidOrder(paidOrder);
            } catch (error) {
              setIsPaying(false);
              announce(error instanceof Error ? error.message : "Payment could not be verified");
            }
          })();
        },
        modal: { ondismiss: () => setIsPaying(false) },
      });
      checkout.open();
    } catch (error) {
      setIsPaying(false);
      announce(error instanceof Error ? error.message : "Online payment could not start");
    }
  };
  const downloadBill = (order: CustomerOrder) => {
    if (!printOrderBill(order)) announce("Allow pop-ups to download your bill");
  };
  const getOrderedProduct = (item: NonNullable<CustomerOrder["items"]>[number]) => {
    const orderedName = item.name.split(" · ")[0].trim().toLowerCase();
    return products.find((candidate) =>
      matchesProductKey(candidate, item.productId)
      || candidate.name.trim().toLowerCase() === orderedName
      || candidate.billName?.trim().toLowerCase() === orderedName,
    );
  };
  const openOrderedProduct = (item: NonNullable<CustomerOrder["items"]>[number]) => {
    const product = getOrderedProduct(item);
    if (!product) {
      announce("This product is no longer available in the collection.");
      return;
    }
    openQuickProduct(product);
  };

  const visibleOrders = useMemo(() => {
    if (!authUser) return [];
    return orders.filter((order) => isCustomerOrder(order, authUser));
  }, [authUser, orders]);
  const assistantReply = (message: string) => {
    const query = message.toLowerCase();
    const money = (value: number) => formatINR(value);
    const productSummary = (items: Product[]) => items.slice(0, 3).map((product) => `${product.name} (${money(getCustomerPrice(product))})`).join(", ");
    if (/hello|hi|hey|help/.test(query)) return "I can help with almost anything in the store: latest arrivals, product suggestions, budgets, gifts, stock, a new order, order tracking, shipping, returns, payments, and jewellery care. Ask me anything.";
    if (/latest|new arrival|newest|recent|just in|arrived/.test(query)) {
      const latest = [...products].reverse().slice(0, 3);
      return latest.length ? `Our latest arrivals are ${productSummary(latest)}. Ask me about any one of them or tell me your budget.` : "There are no new arrivals loaded yet. Please check back after Admin adds the next pieces.";
    }
    if (/new order|place an order|buy|purchase|checkout|how do i order/.test(query)) return cartCount ? `You have ${cartCount} piece${cartCount === 1 ? "" : "s"} in your cart. Open Cart, choose Proceed to buy, add your details, and place the order.` : "To place a new order, open Shop, choose a piece, tap + to add it to your cart, then use Proceed to buy at checkout.";
    if (/order|track|delivery|status/.test(query)) {
      if (!orders.length) return "I don’t see an order on this device yet. Place an order first, then open My orders to track it with your WhatsApp number.";
      const latest = orders[0];
      return `Your latest order ${latest.id} is currently ${latest.status}. The total is ${latest.total}. Open My orders for the full history.`;
    }
    if (/price|cost|budget|under|below|less than/.test(query)) {
      const budget = query.match(/(?:under|below|less than|within|budget)\s*(?:₹|rs\.?\s*)?([\d,]+)/)?.[1];
      if (budget) {
        const amount = Number(budget.replace(/,/g, ""));
        const matches = products.filter((product) => getCustomerPrice(product) <= amount);
        return matches.length ? `Within ${money(amount)}, I found ${productSummary(matches)}.` : `I couldn’t find a piece under ${money(amount)} yet. Try increasing your budget or ask for our lowest-priced pieces.`;
      }
      return `Our pieces currently range from ${money(Math.min(...products.map((product) => getCustomerPrice(product))))} to ${money(Math.max(...products.map((product) => getCustomerPrice(product))))}. Tell me a maximum budget and I’ll filter them.`;
    }
    if (/stock|available|availability|in stock/.test(query)) {
      const available = products.filter((product) => product.price >= 0);
      return available.length ? `These pieces are currently listed in the catalog: ${productSummary(available)}. Ask me for a specific product and I’ll check its listing.` : "The catalog is updating. Please check again in a moment.";
    }
    if (/ship|deliver/.test(query)) return "We offer complimentary shipping above ₹999. Your order updates are shared using the WhatsApp number entered at checkout.";
    if (/return|exchange/.test(query)) return "Returns are accepted within 7 days for eligible unworn pieces. Keep the packaging safe and contact us if you need help with a return.";
    if (/care|clean|maintain/.test(query)) return "Keep jewellery away from perfume, water, and sprays. Store each piece separately in a soft pouch and gently wipe it after wear.";
    if (/gift|present|birthday|anniversary/.test(query)) return "For gifting, I’d start with a versatile pair of earrings or a delicate necklace. Tell me the recipient’s style or your budget and I’ll narrow it down.";
    if (/offer|discount|coupon|promo|sale/.test(query)) return "Look for the current offer banner on the storefront. You can copy an active coupon code there before checkout.";
    if (/payment|cod|cash|online|razorpay/.test(query)) return "At checkout, enter your name, WhatsApp number, email if needed, and delivery address. Available payment options are shown when the order is placed.";
    if (/category|collection|what do you sell|jewellery|jewelry/.test(query)) return "Fanzzy has earrings, necklaces, bracelets, and rings. Ask for a category or open View all categories to browse the full edit.";
    const category = ["earrings", "necklaces", "bracelets", "rings"].find((item) => query.includes(item));
    if (category) {
      const matches = products.filter((product) => product.category.toLowerCase().includes(category)).slice(0, 3);
      if (matches.length) return `Here are a few ${category} to explore: ${matches.map((product) => `${product.name} (${formatINR(getCustomerPrice(product))})`).join(", ")}.`;
    }
    const matches = products.filter((product) => `${product.name} ${product.category}`.toLowerCase().includes(query)).slice(0, 3);
    if (matches.length) return `I found ${matches.map((product) => `${product.name} (${formatINR(getCustomerPrice(product))})`).join(", ")}. Open the collection to take a closer look.`;
    return "I’m here to help with products, latest arrivals, budgets, gifts, new orders, order status, shipping, payments, returns, offers, and jewellery care. Try asking: ‘What’s new?’, ‘Show me rings under ₹1500’, or ‘How do I place a new order?’";
  };
  const assistantProducts = (message: string) => {
    const query = message.toLowerCase();
    if (/order|track|delivery|status|ship|return|exchange|care|clean|payment|cod|razorpay/.test(query)) return [];
    if (/latest|new arrival|newest|recent|just in|arrived/.test(query)) return [...products].reverse().slice(0, 3);
    const budget = query.match(/(?:under|below|less than|within|budget)\s*(?:₹|rs\.?\s*)?([\d,]+)/)?.[1];
    if (budget) return products.filter((product) => getCustomerPrice(product) <= Number(budget.replace(/,/g, ""))).slice(0, 3);
    const category = ["earrings", "necklaces", "bracelets", "rings"].find((item) => query.includes(item));
    if (category) return products.filter((product) => product.category.toLowerCase().includes(category)).slice(0, 3);
    if (/gift|present|birthday|anniversary/.test(query)) return products.filter((product) => product.tag === "Bestseller" || product.tag === "New in").slice(0, 3);
    return products.filter((product) => `${product.name} ${product.category}`.toLowerCase().includes(query)).slice(0, 3);
  };
  const sendAssistantMessage = (value = assistantInput) => {
    const message = value.trim();
    if (!message) return;
    const matches = assistantProducts(message);
    setAssistantMessages((current) => [...current, { role: "user", text: message }, { role: "assistant", text: assistantReply(message), productIds: matches.map((product) => product.id) }]);
    setAssistantInput("");
  };
  const quickOffers = quickProduct ? offersForProduct(quickProduct) : [];
  const activeQuickOffer = selectedPromotion && quickOffers.some((offer) => offer.id === selectedPromotion.id) ? selectedPromotion : quickOffers[0] || null;
  const quickFreeChoices = activeQuickOffer && quickProduct ? (getProductVariantType(quickProduct) === "normal" && quickProduct.variants?.length ? quickProduct.variants.map((variant) => makePromotionSelection(quickProduct, variant, null)) : [makePromotionSelection(quickProduct, null, selectedSize)]) : [];
  const quickBundleChoices = activeQuickOffer?.type === "bundle" ? products.flatMap((product) => getProductVariantType(product) === "normal" && product.variants?.length ? product.variants.map((variant) => makePromotionSelection(product, variant, null)) : [makePromotionSelection(product)]) : [];
  const isSelectionEligible = (offer: PromotionOffer, selection: PromotionSelection, bucket: "paid" | "free") => {
    const scope = bucket === "paid" ? offer.eligiblePaid : offer.eligibleFree;
    if (!scope.length) return true;
    return scope.some((item) => selectionKey(item) === selectionKey(selection) || item.productId === selection.productId);
  };

  return (
    <main className="site-shell" id="top">
      <div className="announcement"><div className="announcement-promo"><strong>{announcementText}</strong><button onClick={() => { const shop = document.getElementById("shop"); if (shop) shop.scrollIntoView({ behavior: "smooth" }); else window.location.assign(`${siteBasePath}/#shop`); }}>Explore now&nbsp; ↗</button></div><span className="announcement-powered">Driven by Excellence. Powered by Vestano Retail</span></div>

      <header className="site-header">
        <a href="#top" className="wordmark" aria-label="fanZZy home"><img src={siteAsset("fanzzy-mark.png")} alt="fanZZy" className="brand-logo" /><span className="navbar-brand-name">fanZZy</span></a>
        <nav className="desktop-nav" aria-label="Main navigation"><a href="#shop">Shop</a><a href="#categories">Collections</a><a href="#story">The journal</a><a href="#footer">About</a></nav>
        <div className="header-actions">
          <label className="navbar-search"><span aria-hidden="true">⌕</span><input readOnly placeholder="Search jewellery" onFocus={openSearch} aria-label="Open search" /></label>
          <button className="header-action-with-icon saved-header-action" onClick={() => setSavedOpen(true)} aria-label="View saved pieces"><svg className="header-action-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none"><path d="M8 13.25S2.75 10.15 2.75 6.55A2.55 2.55 0 0 1 8 5.8a2.55 2.55 0 0 1 5.25.75C13.25 10.15 8 13.25 8 13.25Z" /></svg><span className="action-label">Saved</span>{wishlist.length > 0 && <b>{wishlist.length}</b>}</button>
          <button className="header-action-with-icon" onClick={openOrders} aria-label="View my orders"><svg className="header-action-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none"><path d="M5 2.5h6v11L8 11.7 5 13.5v-11Z" /><path d="M6.6 5.4h2.8M6.6 7.7h2.1" /></svg><span className="action-label">My orders</span>{orders.length > 0 && <b>{orders.length}</b>}</button>
          <button className="header-action-with-icon" onClick={() => setCartOpen(true)} aria-label={cartCount > 0 ? `Open shopping cart, ${cartCount} item${cartCount === 1 ? "" : "s"}` : "Open shopping cart"}><svg className="header-action-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none"><path d="M4 5.5h8l-.65 8H4.65L4 5.5Z" /><path d="M6.25 5.5V4.25a1.75 1.75 0 0 1 3.5 0V5.5" /></svg><span className="action-label">Cart</span>{cartCount > 0 && <span className="bag-count">({cartCount})</span>}</button>
          <button className="profile-button" onClick={() => setProfileOpen(true)} aria-label="View account profile"><span className="profile-logo" data-signed-in={authUser ? "true" : "false"} aria-hidden="true"><span /></span><span className="action-label">Profile</span></button>
        </div>
        <button className="mobile-menu" onClick={() => setMobileNavOpen((current) => !current)} aria-label={mobileNavOpen ? "Close menu" : "Open menu"} aria-expanded={mobileNavOpen}>{mobileNavOpen ? "×" : "☰"}</button>
      </header>

      {mobileNavOpen && <div className="mobile-nav-panel" role="dialog" aria-label="Mobile navigation">
        <nav aria-label="Mobile navigation links">
          <a href="#shop" onClick={() => setMobileNavOpen(false)}>Shop <span>↗</span></a>
          <a href="#categories" onClick={() => setMobileNavOpen(false)}>Collections <span>↗</span></a>
          <a href="#story" onClick={() => setMobileNavOpen(false)}>The journal <span>↗</span></a>
          <a href="#footer" onClick={() => setMobileNavOpen(false)}>About <span>↗</span></a>
        </nav>
        <div className="mobile-nav-actions">
          <button onClick={() => { setMobileNavOpen(false); openSearch(); }}>Search the collection <span>⌕</span></button>
          <button onClick={() => { setMobileNavOpen(false); setSavedOpen(true); }}>Saved pieces <span>♡</span></button>
          <button onClick={() => { setMobileNavOpen(false); openOrders(); }}>My orders <span>↗</span></button>
          <button onClick={() => { setMobileNavOpen(false); setProfileOpen(true); }}>Profile <span className="mobile-profile-logo" aria-hidden="true"><span /></span></button>
          <button onClick={() => { setMobileNavOpen(false); setCartOpen(true); }}>Your cart {cartCount > 0 && <span>({cartCount})</span>}</button>
        </div>
      </div>}

      {heroSlides.length > 0 && <section className="hero hero-background" id="top"><div className="hero-slide-layer" key={heroSlides[heroSlideIndex]}><img src={heroSlides[heroSlideIndex]} alt="Fanzzy collection highlight" /></div></section>}

      <section className="section-block" id="categories"><div className="category-showcase"><div className="category-intro"><h2>Find your <em>signature.</em></h2><a className="text-link" href={`${siteBasePath}/collections`}>View all categories <span>↗</span></a></div><div className="category-grid">{categories.slice(0, 4).map((category, index) => <button className={`category-card category-${index + 1}`} key={category.name} onClick={() => { selectCategory(category.name); document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" }); }}><img src={category.image} alt="" /><span className="category-overlay" /><span className="category-info"><strong>{category.name}</strong></span></button>)}</div></div></section>

      <section className="manifesto"><p className="eyebrow">THE FANZZY STANDARD</p><h2>Jewellery with a point of view.<br /><em>Made for your everyday extraordinary.</em></h2><p className="manifesto-copy">Fanzzy is a study in contrast — soft and sculptural, familiar and unexpected. Every piece is made in small batches with considered materials and a little bit of magic.</p></section>

      <section className="section-block product-section" id="shop"><div className="section-heading"><div><p className="eyebrow">CURATED FOR YOU</p><h2>Pieces worth <em>keeping.</em></h2></div><a className="text-link" href="#footer">Shop all <span>↗</span></a></div>{promotionalOffers.length > 0 && <div className="storefront-offer-rail"><span className="eyebrow">LIVE OFFERS</span>{promotionalOffers.slice(0, 3).map((offer) => <button key={offer.id} onClick={() => { const first = products.find((product) => offersForProduct(product).some((item) => item.id === offer.id)); if (first) openQuickProduct(first); }}>{offerTypeLabel(offer)} <b>↗</b></button>)}</div>}<div className="filter-row"><div className="filter-pills"><button className={activeCategory === "All pieces" ? "active" : ""} onClick={() => selectCategory("All pieces")}>All pieces</button>{categories.map((category) => <button className={activeCategory === category.name ? "active" : ""} key={category.name} onClick={() => selectCategory(category.name)}>{category.name}</button>)}</div><span className="result-count">{filteredProducts.length} pieces</span></div><div className="product-grid">{filteredProducts.map((product) => <ProductCard key={product.id} product={product} promotions={offersForProduct(product)} wished={wishlist.includes(product.id)} onWishlist={() => toggleWishlist(product.id)} onAdd={() => (getProductVariantType(product) === "normal" && product.variants?.length) || (getProductVariantType(product) === "size" && product.sizes?.length) || offersForProduct(product).length ? openQuickProduct(product) : addToCart(product)} onQuickView={() => openQuickProduct(product)} onImageZoom={() => setZoomedImage({ src: product.image, alt: product.name, adjustments: product.imageAdjustments })} />)}</div></section>

      <section className="editorial" id="story"><div className="editorial-image"><img src="https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=1100&q=85" alt="Close-up of sculptural gold jewelry" /><span>THE ART OF<br /><em>ADORNMENT</em></span></div><div className="editorial-copy"><p className="eyebrow">A NOTE FROM THE STUDIO</p><h2>Less noise.<br /><em>More meaning.</em></h2><p>There is beauty in the in-between. The way a quiet chain layers with your favourite shirt. A ring that becomes part of your hand. Fanzzy is made for these small rituals — the ones that make a day feel like yours.</p><a className="button button-dark" href="#footer">Read our story <span>↗</span></a><div className="editorial-sign">F / 19<br /></div></div></section>

      <section className="offer-banner"><div><p className="eyebrow light">{activeCampaign ? activeCampaign.kind === "Coupon" ? "EXCLUSIVE OFFER" : "SEASONAL EDIT" : "LIMITED OFFER"}</p><h2>{activeCampaign ? activeCampaign.name : "Buy 1, get 1"}<br /><em>{activeCampaign ? "is here." : "on us."}</em></h2></div><div><p>{activeCampaign ? <>{activeCampaign.detail}{activeCampaign.discount && <> · <strong>{activeCampaign.discount}</strong></>}{activeCampaign.code && <> with code <strong>{activeCampaign.code}</strong></>}</> : <>Choose two eligible pieces and enjoy our Buy 1 Get 1 offer.</>}</p>{activeCampaign?.code ? <button className="button button-light" onClick={() => { const code = activeCampaign.code ?? ""; navigator.clipboard?.writeText(code); announce(`Code copied: ${code}`); }}>Copy code <span>↗</span></button> : <button className="button button-light" onClick={() => { document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" }); announce(activeCampaign && isBogoCampaign(activeCampaign) ? `${getBogoOfferLabel(activeCampaign)} offer opened` : "Offer collection opened"); }}>Shop the offer <span>↗</span></button>}</div></section>

      <section className="newsletter"><div><p className="eyebrow">THE FANZZY LETTER</p><h2>A little light<br /><em>in your inbox.</em></h2></div><form onSubmit={subscribeNewsletter}><p>New drops, studio notes, and 10% off your first order — no noise, promise.</p><div className="email-line"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Your email address" aria-label="Your email address" required /><button aria-label="Subscribe to newsletter">↗</button></div>{(subscribed || newsletterMessage) && <span className="success-message">{newsletterMessage}</span>}</form></section>

      <footer className="site-footer" id="footer"><div className="footer-brand"><a href="#top" className="wordmark wordmark-light"><img src={siteAsset("fanzzy-mark.png")} alt="Fanzzy" className="brand-logo" /></a><p>Quietly remarkable jewellery<br />for all your becoming.</p></div><div><p className="eyebrow light">Explore</p><a href="#shop">New arrivals</a><a href="#shop">Bestsellers</a><a href="#categories">Collections</a><a href="#shop">Gift cards</a></div><div><p className="eyebrow light">Need a hand?</p><a href="#footer">Contact us</a><a href="#footer">Shipping & returns</a><a href="#footer">Care guide</a><a href="#footer">FAQs</a></div><div><p className="eyebrow light">Follow along</p><a href="https://www.instagram.com/fanzzy.in/?hl=en" target="_blank" rel="noreferrer">Instagram ↗</a><a href="https://www.facebook.com/profile.php?id=61593401750910" target="_blank" rel="noreferrer">Facebook ↗</a><a href="https://www.pinterest.com/fanzzyv/" target="_blank" rel="noreferrer">Pinterest ↗</a><a href="#footer">WhatsApp ↗</a><p className="footer-small">Made with intention in India.<br />© Fanzzy 2024</p></div><div className="footer-bottom"><button type="button" onClick={() => setPrivacyOpen(true)}>Privacy</button><button type="button" onClick={() => setTermsOpen(true)}>Terms</button><button type="button" onClick={() => setReturnPolicyOpen(true)}>Return Policy</button><span>Accessibility</span><span>India / INR ₹</span></div></footer>

      <button className="whatsapp-float" onClick={() => setAssistantOpen(true)} aria-label="Open Fanzzy AI Assistant">✦ <span>Chat with AI</span></button>

      {termsOpen && <div className="drawer-backdrop terms-backdrop" onClick={() => setTermsOpen(false)}><section className="terms-modal" role="dialog" aria-modal="true" aria-labelledby="terms-title" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><p className="eyebrow">FANZZY</p><h2 id="terms-title">Terms &amp; Conditions</h2></div><button aria-label="Close terms" onClick={() => setTermsOpen(false)}>×</button></div><div className="terms-content"><p>By using <strong>Fanzzy</strong> and placing an order, you agree to the following terms:</p><ul><li>Product colours and appearance may slightly vary from images shown.</li><li>Where a product video is available, customers can view it by opening the product details.</li><li>Prices, offers and product availability may change without prior notice.</li><li>Orders are confirmed only after successful payment/confirmation.</li><li>Delivery time may vary depending on location and courier service.</li><li>Returns, exchanges and refunds are subject to our <strong>Return &amp; Refund Policy</strong>.</li><li>Fanzzy reserves the right to cancel orders due to stock, payment, pricing or technical issues.</li><li>Customer information will be handled according to our <strong>Privacy Policy</strong>.</li><li>All website content, images and the Fanzzy brand are protected and may not be copied without permission.</li><li>These terms are governed by applicable laws of <strong>India</strong>.</li></ul><p>For any assistance, please contact <strong>Fanzzy Customer Support</strong>.</p><p><strong>© 2026 Fanzzy. All Rights Reserved.</strong></p></div></section></div>}

      {returnPolicyOpen && <div className="drawer-backdrop terms-backdrop" onClick={() => setReturnPolicyOpen(false)}><section className="terms-modal" role="dialog" aria-modal="true" aria-labelledby="return-policy-title" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><p className="eyebrow">FANZZY</p><h2 id="return-policy-title">Return Policy</h2></div><button aria-label="Close return policy" onClick={() => setReturnPolicyOpen(false)}>×</button></div><div className="terms-content"><p>Customers may request a return for eligible products within the return period mentioned on our website.</p><p>Once a return request is approved, the <strong>customer must send the product to the return hub/address provided by Fanzzy</strong>.</p><ul><li>The product must be unused, undamaged, and returned in its original packaging with all tags/accessories intact.</li><li><strong>Return courier/shipping charges must be paid by the customer. Fanzzy will not bear the cost of sending the returned product to our hub.</strong></li><li>Customers are responsible for safely packing and dispatching the return item.</li><li>We recommend using a trackable courier service. Fanzzy will not be responsible for return parcels lost or damaged during transit.</li><li>Refund/replacement processing will begin only after the returned item reaches our hub and successfully passes the quality inspection.</li><li>Original delivery/shipping charges, if any, are non-refundable unless the return is due to a wrong or defective product supplied by Fanzzy.</li><li>Products that are used, damaged, altered, or returned without original packaging may not be eligible for refund or replacement.</li><li>Certain products may be marked as <strong>non-returnable</strong> for hygiene or other applicable reasons.</li></ul><p>If a customer receives a <strong>wrong, damaged, or defective product</strong>, they should contact Fanzzy customer support within the specified return period with the order details and supporting photos/videos.</p></div></section></div>}
      {privacyOpen && <div className="drawer-backdrop terms-backdrop" onClick={() => setPrivacyOpen(false)}><section className="terms-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-title" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><p className="eyebrow">FANZZY</p><h2 id="privacy-title">Privacy Policy</h2></div><button aria-label="Close privacy policy" onClick={() => setPrivacyOpen(false)}>×</button></div><div className="terms-content"><p>At <strong>Fanzzy</strong>, we respect and protect your privacy. We collect necessary information such as your name, contact details, address, and order information to process orders, arrange delivery, manage returns/refunds, and provide customer support.</p><p>Your information may be shared with trusted <strong>payment, courier, and service partners</strong> only when required to complete our services. We do not sell customers' personal information to third parties.</p><p>We take reasonable measures to keep your information secure. By using the Fanzzy website, you agree to this Privacy Policy and any updates made to it.</p></div></section></div>}

      {assistantOpen && <div className="drawer-backdrop" onClick={() => setAssistantOpen(false)}><aside className="assistant-drawer" role="dialog" aria-modal="true" aria-labelledby="assistant-title" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><p className="eyebrow">FANZZY AI</p><h2 id="assistant-title">How can I help?</h2></div><button aria-label="Close AI assistant" onClick={() => setAssistantOpen(false)}>×</button></div><div className="assistant-messages" aria-live="polite">{assistantMessages.map((message, index) => <div className={`assistant-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.text}{message.productIds?.length ? <div className="assistant-product-actions">{message.productIds.map((productId) => { const product = products.find((item) => item.id === productId); return product ? <button key={product.id} onClick={() => { openQuickProduct(product); setAssistantOpen(false); }}>View {product.name} · {formatINR(getCustomerPrice(product))} ↗</button> : null; })}</div> : null}</span></div>)}</div><div className="assistant-prompts"><button onClick={() => sendAssistantMessage("Help me choose a gift")}>Choose a gift</button><button onClick={() => sendAssistantMessage("Track my order")}>Track my order</button><button onClick={() => sendAssistantMessage("How do I care for my jewellery?")}>Jewellery care</button></div><form className="assistant-form" onSubmit={(event) => { event.preventDefault(); sendAssistantMessage(); }}><input value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Ask Fanzzy Assistant..." aria-label="Ask Fanzzy Assistant" /><button type="submit" aria-label="Send message">↗</button></form></aside></div>}

      {searchOpen && <div className="overlay search-overlay" role="dialog" aria-modal="true" aria-label="Search"><div className="overlay-top"><span className="wordmark"><img src={siteAsset("fanzzy-mark.png")} alt="Fanzzy" className="brand-logo" /></span><button onClick={closeSearch}>Close&nbsp; ×</button></div><div className="search-content"><p className="eyebrow">SEARCH THE COLLECTION</p><div className="large-search"><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Try “gold hoops”" /><span>⌕</span></div>{search && <div className="search-results">{filteredProducts.length ? filteredProducts.map((product) => <button key={product.id} onClick={() => { openQuickProduct(product) }}><img src={product.image} alt="" /><span><strong>{product.name}</strong><small>{product.category} · {formatINR(getCustomerPrice(product))}</small></span><b>↗</b></button>) : <p className="muted">No pieces found. Try another search.</p>}</div>}{!search && <div className="search-suggestions"><span>Trending now</span><button onClick={() => setSearch("hoops")}>Hoops</button><button onClick={() => setSearch("pearl")}>Pearls</button><button onClick={() => setSearch("chain")}>Chains</button></div>}</div></div>}

      {orderConfirmation && <div className="drawer-backdrop" onClick={() => setOrderConfirmation(null)}><section className="order-confirmation" role="dialog" aria-modal="true" aria-labelledby="order-confirmation-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" aria-label="Close payment confirmation" onClick={() => setOrderConfirmation(null)}>×</button><p className="eyebrow">PAYMENT SUCCESSFUL</p><h2 id="order-confirmation-title">Your payment is complete.</h2><p>We received <strong>{orderConfirmation.total}</strong> for order <strong>{orderConfirmation.id}</strong>. Your order has been confirmed.</p>{orderConfirmation.fulfillmentMethod === "pickup" && <p className="pickup-confirmation"><strong>Pickup from {orderConfirmation.pickupHubName || "hub"}</strong><br />{orderConfirmation.pickupHubPlace || "Pickup place saved with your order."}<br /><small>No delivery charges.</small></p>}{orderConfirmation.razorpayPaymentId && <p className="payment-reference">Payment ID: {orderConfirmation.razorpayPaymentId}</p>}<div className="confirmation-actions"><button className="button button-dark" onClick={() => downloadBill(orderConfirmation)}>Download bill <span>↗</span></button><button className="save-text" onClick={() => { setOrderConfirmation(null); setOrdersOpen(true); }}>View my orders</button></div></section></div>}

      {savedOpen && <div className="drawer-backdrop" onClick={() => setSavedOpen(false)}><aside className="orders-drawer saved-drawer" role="dialog" aria-modal="true" aria-labelledby="saved-title" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><p className="eyebrow">YOUR EDIT</p><h2 id="saved-title">Saved pieces</h2></div><button aria-label="Close saved pieces" onClick={() => setSavedOpen(false)}>×</button></div>{wishlist.length ? <div className="saved-list">{wishlist.map((productId) => { const product = products.find((item) => item.id === productId); return product ? <article className="saved-card" key={product.id}><button className="saved-product" onClick={() => { openQuickProduct(product); setSavedOpen(false); }}><img src={product.image} alt="" /><span><strong>{product.name}</strong><small>{product.category} · {formatINR(getCustomerPrice(product))}</small></span><b>↗</b></button><div className="saved-card-actions"><button className="module-secondary" onClick={() => { addToCart(product); setSavedOpen(false); }}>Add to cart</button><button className="saved-remove" onClick={() => toggleWishlist(product.id)}>Remove</button></div></article> : null; })}</div> : <div className="orders-empty saved-empty"><div>♡</div><h3>Your edit is waiting.</h3><p>Tap the heart on any piece to keep it close while you decide.</p><button className="button button-dark" onClick={() => { setSavedOpen(false); document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" }); }}>Explore pieces <span>↗</span></button></div>}</aside></div>}

      {profileOpen && <div className="drawer-backdrop" onClick={() => setProfileOpen(false)}><aside className="orders-drawer profile-drawer" role="dialog" aria-modal="true" aria-labelledby="profile-title" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><p className="eyebrow">YOUR FANZZY ACCOUNT</p><h2 id="profile-title">Profile</h2></div><button aria-label="Close profile" onClick={() => setProfileOpen(false)}>×</button></div>{authUser ? <div className="profile-content"><div className="profile-avatar" aria-hidden="true">{profileName.slice(0, 1).toUpperCase()}</div><p className="eyebrow">SIGNED IN</p><h3>{profileName}</h3><p className="profile-welcome">Your saved pieces, cart and order history stay together here.</p><dl className="profile-details"><div><dt>Login mobile number</dt><dd>{authUser.phone}</dd></div><div><dt>Account ID</dt><dd>{authUser.id}</dd></div></dl><div className="profile-shortcuts"><button onClick={() => { setProfileOpen(false); setOrdersOpen(true); }}><span>Orders</span><b>{orders.length.toString().padStart(2, "0")} ↗</b></button><button onClick={() => { setProfileOpen(false); setSavedOpen(true); }}><span>Saved</span><b>{wishlist.length.toString().padStart(2, "0")} ♡</b></button></div><button className="button button-dark full-width" onClick={() => { setProfileOpen(false); setCartOpen(true); }}>Open my cart <span>↗</span></button><button className="profile-sign-out" onClick={signOut}>Sign out</button></div> : <div className="profile-content profile-signed-out"><div className="profile-avatar" aria-hidden="true">○</div><p className="eyebrow">NOT SIGNED IN</p><h3>Welcome to Fanzzy.</h3><p>Sign in with a one-time SMS or voice code to keep your cart and orders connected to your mobile number.</p><button className="button button-dark full-width" onClick={() => { setProfileOpen(false); setAuthMessage(""); setAuthOpen(true); }}>Sign in with mobile OTP <span>↗</span></button></div>}</aside></div>}

      {ordersOpen && <div className="drawer-backdrop" onClick={() => setOrdersOpen(false)}><aside className="orders-drawer" role="dialog" aria-modal="true" aria-labelledby="orders-title" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><p className="eyebrow">YOUR FANZZY ACCOUNT</p><h2 id="orders-title">My orders</h2></div><button aria-label="Close orders" onClick={() => setOrdersOpen(false)}>×</button></div><div className="orders-intro"><p>These are the orders placed using your signed-in account. Only you can see this account’s orders.</p></div>{visibleOrders.length ? <div className="customer-order-list">{visibleOrders.map((order) => <article className="customer-order-card" key={order.id}><div className="customer-order-head"><div><strong>{order.id}</strong><small>{formatOrderDate(order.date)} · {order.customerName}</small></div><span className={`customer-order-status ${order.status.toLowerCase()}`}>{order.status}</span></div>{order.items?.length ? <div className="customer-order-items">{order.items.map((item) => { const product = getOrderedProduct(item); return <button className="customer-order-product" key={`${order.id}-${item.name}`} onClick={() => openOrderedProduct(item)} aria-label={`View ${item.name} details`}>{product ? <img src={product.image} alt="" style={imageAdjustmentStyle(product.imageAdjustments)} /> : <span className="order-product-placeholder" aria-hidden="true">✦</span>}<span className="order-product-copy"><strong>{item.name}</strong><b>× {item.quantity}</b>{product ? <em>{product.category} · View details ↗</em> : <em>Product no longer in the collection</em>}</span><small>{item.price}</small></button>; })}</div> : <p className="customer-order-items legacy-order">Order details are available in your confirmation.</p>}<div className="customer-order-total"><span>Total paid</span><strong>{order.total}</strong></div><button className="module-secondary customer-bill-button" onClick={() => downloadBill(order)}>Download bill ↗</button></article>)}</div> : <div className="orders-empty"><div>✦</div><h3>No orders found for this account.</h3><p>Orders appear here after you complete payment while signed in to this account.</p><button className="button button-dark" onClick={() => { setOrdersOpen(false); document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" }); }}>Shop the collection <span>↗</span></button></div>}</aside></div>}

      {cartOpen && <div className="drawer-backdrop" onClick={() => setCartOpen(false)}><aside className="cart-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><p className="eyebrow">YOUR CART</p><h2>{cartCount ? `${cartCount} piece${cartCount > 1 ? "s" : ""}` : "A little empty"}</h2></div><button onClick={() => setCartOpen(false)}>×</button></div>{cartItems.length ? <><div className="drawer-items">{cartItems.map((product) => <div className={`drawer-item${getVariantStock(product, product.variant) <= 0 ? " drawer-item-sold-out" : ""}`} key={product.cartKey}><img src={product.variant?.image || product.image} alt="" style={imageAdjustmentStyle(product.variant?.adjustments || product.imageAdjustments)} /><div><strong>{product.name}</strong>{product.variant?.name && <small className="cart-variant-name">{product.variant.name}</small>}{product.size && <small className="cart-variant-name">Size {product.size}</small>}{product.promotion && <small className={`cart-promotion-label ${product.promotion.role === "free" ? "is-free" : ""}`}>{product.promotion.role === "free" ? `FREE · ${product.promotion.label}` : product.promotion.role === "bundle" ? `${product.promotion.label} · allocated price` : product.promotion.label}</small>}{getVariantStock(product, product.variant) <= 0 && <small className="cart-stock-label">Sold out</small>}<small>{formatINR(getCartLinePrice(product))}{product.promotion && product.promotion.role === "bundle" && product.promotion.linePrice !== product.promotion.regularPrice ? <del className="cart-regular-price">{formatINR(product.promotion.regularPrice)}</del> : null}</small><div className="quantity"><button onClick={() => updateQuantity(product.cartKey, -1)} aria-label={`Decrease ${product.name} quantity`}>−</button><span>{product.quantity}</span><button onClick={() => updateQuantity(product.cartKey, 1)} aria-label={`Increase ${product.name} quantity`}>+</button></div></div><div className="cart-item-actions"><b>{formatINR(getCartLinePrice(product) * product.quantity)}</b><button className="cart-remove" onClick={() => removeFromCart(product.cartKey)} aria-label={`Remove ${product.name} from cart`}>Remove</button></div></div>)}</div><div className="cart-fulfillment"><p className="field-label">Receive your order</p><div className="cart-fulfillment-options"><button type="button" className={fulfillmentMethod === "delivery" ? "active" : ""} onClick={() => setFulfillmentMethod("delivery")}>Home delivery<small>Use delivery address</small></button><button type="button" className={fulfillmentMethod === "pickup" ? "active" : ""} onClick={() => { setFulfillmentMethod("pickup"); if (!selectedPickupHubId && pickupHubs[0]) setSelectedPickupHubId(pickupHubs[0].id); }} disabled={!pickupHubs.length}>Hub pickup<small>{pickupHubs.length ? "Collect from a hub" : "No hubs available"}</small></button></div>{fulfillmentMethod === "pickup" && pickupHubs.length > 0 && <select aria-label="Pickup hub" value={selectedPickupHubId} onChange={(event) => setSelectedPickupHubId(event.target.value)}><option value="">Select pickup hub</option>{pickupHubs.map((hub) => <option key={hub.id} value={hub.id}>{hub.name} · {hub.place}</option>)}</select>}{fulfillmentMethod === "pickup" && !pickupHubs.length && <small className="cart-fulfillment-help">Add a pickup hub in Admin before choosing hub pickup.</small>}</div><div className="drawer-footer">{cartStockIssues.length > 0 && <div className="cart-stock-warning" role="alert"><strong>Remove sold out items before checkout</strong><span>{cartHasSoldOutItems ? "This cart contains an unavailable item." : "One or more quantities are above the available stock."}</span></div>}<div><span>Subtotal</span><strong>{formatINR(subtotal)}</strong></div>{cartItems.some((item) => item.promotion?.role === "bundle") && <div className="offer-total"><span>Bundle regular total</span><strong>{formatINR(cartItems.reduce((sum, item) => sum + (item.promotion?.regularPrice || 0) * item.quantity, 0))}</strong></div>}{cartItems.some((item) => item.promotion?.role === "free") && <div className="offer-total"><span>Free-item discount</span><strong>Applied</strong></div>}{bogoDiscount > 0 && <div className="offer-total"><span>{bogoOfferLabel} discount</span><strong>−{formatINR(bogoDiscount)}</strong></div>}{couponDiscount > 0 && <div className="offer-total"><span>Coupon discount</span><strong>−{formatINR(couponDiscount)}</strong></div>}<div><span>Delivery</span><strong>{deliveryTotal > 0 ? formatINR(deliveryTotal) : "Free"}</strong></div><div className="drawer-total"><span>Total</span><strong>{formatINR(orderTotal)}</strong></div><p>{cartItems.some((item) => item.promotion) ? "Promotion items are linked by offer group ID for inventory, returns, and refunds." : deliveryTotal > 0 ? "Delivery charge applied to this order." : deliveryCharge.freeAboveEnabled ? `Free delivery on orders above ${formatINR(deliveryCharge.freeAbove)}.` : "Complimentary shipping."}</p><button className="button button-dark full-width" onClick={openCheckout}>Proceed to buy <span>↗</span></button></div></> : <div className="empty-bag"><div>✦</div><p>Your future favourites<br />belong here.</p><button className="text-link" onClick={() => setCartOpen(false)}>Continue shopping <span>↗</span></button></div>}</aside></div>}

      {authOpen && <div className="drawer-backdrop auth-backdrop" onClick={closeAuth}><section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" aria-label="Close sign in" onClick={closeAuth}>×</button><p className="eyebrow">SECURE MOBILE LOGIN</p><h2 id="auth-title">Continue with your mobile number.</h2><p className="auth-intro">Enter your mobile number and receive a one-time code by SMS or voice call. No password is required.</p><div className="otp-auth-form"><label>Mobile number<input type="tel" value={authPhone} onChange={(event) => { setAuthPhone(event.target.value); setAuthOtp(""); setOtpSent(false); setOtpCooldown(0); }} placeholder="+91 98765 43210" inputMode="tel" autoComplete="tel" disabled={authLoading} /></label>{otpSent && <label>6-digit verification code<input value={authOtp} onChange={(event) => setAuthOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="Enter 6-digit code" disabled={authLoading} onKeyDown={(event) => { if (event.key === "Enter") void verifyOtp(); }} /></label>}{otpSent ? <><button className="google-sign-in" type="button" onClick={() => void verifyOtp()} disabled={authLoading}><span className="email-otp-mark" aria-hidden="true">✦</span>{authLoading ? "Please wait…" : "Verify code"}<span aria-hidden="true">↗</span></button><div className="otp-fallback-actions"><button className="auth-resend" type="button" onClick={() => void sendOtp()} disabled={authLoading || otpCooldown > 0}>{otpCooldown > 0 ? `Resend SMS in ${otpCooldown}s` : "Resend SMS OTP"}</button><button className="auth-resend" type="button" onClick={() => void sendVoiceOtp()} disabled={authLoading || otpCooldown > 0}>{otpCooldown > 0 ? `Call again in ${otpCooldown}s` : "Call again with OTP"}</button></div></> : <div className="otp-channel-actions"><button className="google-sign-in" type="button" onClick={() => void sendOtp()} disabled={authLoading}><span className="email-otp-mark" aria-hidden="true">✦</span>{authLoading ? "Please wait…" : "Send SMS code"}<span aria-hidden="true">↗</span></button><button className="google-sign-in auth-voice-button" type="button" onClick={() => void sendVoiceOtp()} disabled={authLoading}><span className="email-otp-mark" aria-hidden="true">☎</span>{authLoading ? "Please wait…" : "Call me with code"}<span aria-hidden="true">↗</span></button></div>}</div>{authMessage && <p className="auth-message" role="alert">{authMessage}</p>}<p className="auth-note">Your orders and cart are saved to this verified mobile number.</p></section></div>}

      {checkoutOpen && <div className="drawer-backdrop checkout-backdrop" onClick={() => setCheckoutOpen(false)}><section className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title" onClick={(event) => event.stopPropagation()} onFocusCapture={(event) => { if (event.target instanceof HTMLInputElement) requestAnimationFrame(() => event.target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" })); }}><div className="drawer-header"><div><p className="eyebrow">CHECKOUT</p><h2 id="checkout-title">Complete your order</h2></div><button aria-label="Close checkout" onClick={() => setCheckoutOpen(false)}>×</button></div><p className="checkout-intro">We’ll use your WhatsApp number to confirm your order and delivery updates.</p><div className="checkout-grid"><label>Customer name<input value={checkoutForm.name} onChange={(event) => setCheckoutForm((current) => ({ ...current, name: event.target.value }))} placeholder="Your full name" required /></label><label>WhatsApp number <span className="required-mark">Required</span><input type="tel" value={checkoutForm.phone} onChange={(event) => setCheckoutForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+91 98765 43210" required /></label><label>Email address <span className="optional-mark">Optional</span><input type="email" value={checkoutForm.email} onChange={(event) => setCheckoutForm((current) => ({ ...current, email: event.target.value }))} placeholder="you@example.com" /></label><div className="checkout-fulfillment checkout-wide"><p className="field-label">How would you like to receive your order?</p><div className="fulfillment-options"><label><input type="radio" name="fulfillment-method" checked={fulfillmentMethod === "delivery"} onChange={() => setFulfillmentMethod("delivery")} /> <span>Home delivery<small>Delivery charges apply as configured.</small></span></label><label className={!pickupHubs.length ? "disabled" : ""}><input type="radio" name="fulfillment-method" checked={fulfillmentMethod === "pickup"} onChange={() => { setFulfillmentMethod("pickup"); if (!selectedPickupHubId && pickupHubs[0]) setSelectedPickupHubId(pickupHubs[0].id); }} disabled={!pickupHubs.length} /> <span>Pick up from a hub<small>{pickupHubs.length ? "No delivery charges." : "Add a hub in Admin → Hub to enable pickup."}</small></span></label></div></div>{fulfillmentMethod === "pickup" && pickupHubs.length > 0 && <label className="checkout-wide pickup-hub-select">Pickup hub<select value={selectedPickupHubId} onChange={(event) => setSelectedPickupHubId(event.target.value)}><option value="">Select a pickup hub</option>{pickupHubs.map((hub) => <option key={hub.id} value={hub.id}>{hub.name} · {hub.place}</option>)}</select><small className="pickup-hub-details">{selectedPickupHub ? `${selectedPickupHub.name} · ${selectedPickupHub.place}` : "Choose where you will collect your order."}</small></label>}{fulfillmentMethod === "delivery" && <label className="checkout-wide">Delivery address<input value={checkoutForm.address} onChange={(event) => setCheckoutForm((current) => ({ ...current, address: event.target.value }))} placeholder="House number, street, city, pincode" required /></label>}<div className="checkout-coupon checkout-wide"><label htmlFor="checkout-coupon-code">Coupon code <span className="optional-mark">Optional</span></label><div className="coupon-entry"><input id="checkout-coupon-code" value={couponInput} onChange={(event) => { setCouponInput(event.target.value.toUpperCase()); setAppliedCoupon(null); }} placeholder="Enter coupon code" autoCapitalize="characters" /><button className="button button-light" type="button" onClick={applyCoupon}>Apply</button></div>{appliedCoupon && <p className="coupon-success">{appliedCoupon.code} applied · {appliedCoupon.discount} off</p>}</div></div>{bogoDiscount > 0 && <div className="checkout-total coupon-total"><span>{bogoOfferLabel} discount</span><strong>−{formatINR(bogoDiscount)}</strong></div>}{couponDiscount > 0 && <div className="checkout-total coupon-total"><span>Coupon discount</span><strong>−{formatINR(couponDiscount)}</strong></div>}<div className="checkout-total"><span>{fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"}</span><strong>{fulfillmentMethod === "pickup" ? "Free" : deliveryTotal > 0 ? formatINR(deliveryTotal) : "Free"}</strong></div><div className="checkout-total"><span>Order total</span><strong>{formatINR(orderTotal)}</strong></div><div className="checkout-actions"><button className="button button-dark" onClick={submitCheckout}>Place order <span>↗</span></button><button className="save-text" onClick={() => setCheckoutOpen(false)}>Back to cart</button></div></section></div>}


      {quickProduct && <div className="drawer-backdrop" onClick={closeQuickProduct}><div className="quick-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" aria-label="Close quick view" onClick={closeQuickProduct}>×</button><div className="quick-image" onClick={() => setZoomedImage({ src: selectedVariant?.image || quickProduct.image, alt: selectedVariant?.name ? `${quickProduct.name} - ${selectedVariant.name}` : quickProduct.name, adjustments: selectedVariant?.adjustments || quickProduct.imageAdjustments })} title="Click to zoom"><img src={selectedVariant?.image || quickProduct.image} alt={selectedVariant?.name ? `${quickProduct.name} - ${selectedVariant.name}` : quickProduct.name} style={imageAdjustmentStyle(selectedVariant?.adjustments || quickProduct.imageAdjustments)} /></div><div className="quick-copy"><p className="eyebrow">{quickProduct.category}</p><h2>{quickProduct.name}</h2><div className="price-row"><span>{formatINR(getCustomerPrice(quickProduct))}</span><del>{formatINR(getComparePrice(quickProduct))}</del></div>{getProductVariantType(quickProduct) === "normal" && quickProduct.variants?.length ? <div className="variant-picker"><span>Choose colour / series / model</span><div>{quickProduct.variants.map((variant, index) => { const variantStock = getVariantStock(quickProduct, variant); return <button key={`${quickProduct.id}-${variant.name || index}`} disabled={variantStock <= 0} className={`${selectedVariant?.name === variant.name && selectedVariant?.image === variant.image ? "active" : ""} ${variantStock <= 0 ? "sold-out" : ""}`} onClick={() => setSelectedVariant(variant)}><img src={variant.image || quickProduct.image} alt="" style={imageAdjustmentStyle(variant.adjustments)} /><span>{variant.name || `Option ${index + 1}`} · {variantStock > 0 ? `${variantStock} available` : "Sold out"}</span></button>; })}</div></div> : null}{getProductVariantType(quickProduct) === "size" && getProductSizes(quickProduct).length ? <div className="size-picker"><span>Choose size</span><div>{getProductSizes(quickProduct).map((size) => { const sizeVariant = getSizeVariant(quickProduct, size); const stock = getSelectionStock(quickProduct, selectedVariant, size); return <button type="button" key={size} disabled={stock <= 0} className={`${selectedSize === size ? "active" : ""} ${stock <= 0 ? "sold-out" : ""}`} onClick={() => setSelectedSize(size)}>{sizeVariant?.image ? <img src={sizeVariant.image} alt="" /> : null}Size {size} · {stock > 0 ? `${stock} available` : "Sold out"}</button>; })}</div></div> : null}{quickOffers.length > 0 && <div className="storefront-promotion-picker"><span className="promotion-picker-label">Special offer available</span><div className="storefront-promotion-tabs">{quickOffers.map((offer) => <button key={offer.id} className={activeQuickOffer?.id === offer.id ? "active" : ""} onClick={() => { setSelectedPromotion(offer); setSelectedFreeSelections([]); setSelectedBundleSelections([]); }}>{offerTypeLabel(offer)}</button>)}</div>{activeQuickOffer?.type === "bundle" ? <div className="promotion-selection-panel"><strong>Select Any {activeQuickOffer.bundleQuantity} Items for ₹{activeQuickOffer.fixedBundlePrice.toLocaleString("en-IN")}</strong><small>{selectedBundleSelections.length} of {activeQuickOffer.bundleQuantity} selected · regular prices are allocated proportionally</small><div className="promotion-choice-grid">{quickBundleChoices.filter((selection) => isSelectionEligible(activeQuickOffer, selection, "paid")).map((selection, index) => { const product = products.find((item) => item.id === selection.productId); const active = selectedBundleSelections.some((item) => selectionKey(item) === selectionKey(selection)); const stock = selection.stock || 0; return <button key={`${selectionKey(selection)}-${index}`} disabled={stock <= 0 || (!active && selectedBundleSelections.length >= activeQuickOffer.bundleQuantity)} className={active ? "active" : ""} onClick={() => setSelectedBundleSelections((current) => active ? current.filter((item) => selectionKey(item) !== selectionKey(selection)) : [...current, selection])}><img src={product?.variants?.find((variant) => variant.name === selection.variantName)?.image || product?.image || quickProduct.image} alt="" /><span>{product?.name || quickProduct.name}{selection.variantName ? ` · ${selection.variantName}` : ""}<small>{stock > 0 ? `${stock} available · ₹${(selection.price || 0).toLocaleString("en-IN")}` : "Out of stock"}</small></span></button>; })}</div><button className="button button-dark full-width" disabled={selectedBundleSelections.length !== activeQuickOffer.bundleQuantity} onClick={() => addPromotionToCart(activeQuickOffer)}>Add Bundle to Cart</button></div> : <div className="promotion-selection-panel"><strong>Select Your {activeQuickOffer?.freeQuantity || 1} Free Variant{(activeQuickOffer?.freeQuantity || 1) > 1 ? "s" : ""}</strong><small>{selectedFreeSelections.length} of {activeQuickOffer?.freeQuantity || 1} selected · paid item: {selectedVariant?.name || quickProduct.name}</small><div className="promotion-choice-grid">{quickFreeChoices.filter((selection) => activeQuickOffer ? isSelectionEligible(activeQuickOffer, selection, "free") : true).map((selection, index) => { const active = selectedFreeSelections.some((item) => selectionKey(item) === selectionKey(selection)); const stock = selection.stock || 0; return <button key={`${selectionKey(selection)}-${index}`} disabled={stock <= 0 || (!active && selectedFreeSelections.length >= (activeQuickOffer?.freeQuantity || 1))} className={active ? "active" : ""} onClick={() => setSelectedFreeSelections((current) => active ? current.filter((item) => selectionKey(item) !== selectionKey(selection)) : [...current, selection])}><img src={quickProduct.variants?.find((variant) => variant.name === selection.variantName)?.image || quickProduct.image} alt="" /><span>{selection.variantName || quickProduct.name}<small>{stock > 0 ? `${stock} available` : "Out of stock"} · FREE</small></span></button>; })}</div><button className="button button-dark full-width" disabled={selectedFreeSelections.length !== (activeQuickOffer?.freeQuantity || 1) || selectedVariantStock <= 0} onClick={() => activeQuickOffer && addPromotionToCart(activeQuickOffer)}>Add {offerTypeLabel(activeQuickOffer || quickOffers[0])} to Cart</button></div>} </div>}{<div className="quick-actions"><button className="button button-dark full-width" type="button" disabled={selectedVariantStock <= 0} onClick={() => { addToCart(quickProduct, getProductVariantType(quickProduct) === "normal" ? selectedVariant : null, getProductVariantType(quickProduct) === "size" ? selectedSize : null); closeQuickProduct(); }}>{selectedVariantStock > 0 ? "Buy now" : "Sold out"} <span>↗</span></button></div>}<p>Designed to become part of your everyday ritual. Hand-finished in small batches with a soft, lasting glow.</p></div></div></div>}
      {zoomedImage && <div className="drawer-backdrop image-zoom-backdrop" onClick={() => setZoomedImage(null)}><section className="image-zoom-modal" role="dialog" aria-modal="true" aria-label={`Zoomed view of ${zoomedImage.alt}`} onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setZoomedImage(null)} aria-label="Close image zoom">×</button><img src={zoomedImage.src} alt={zoomedImage.alt} style={imageAdjustmentStyle(zoomedImage.adjustments)} /></section></div>}

      {toast && <div className="toast">{toast}<span>✦</span></div>}
    </main>
  );
}




