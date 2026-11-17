import { buildPublicCatalogResponse, type PublicCatalogProduct } from "./catalog/public-catalog-mapper";
import { validateWebsitePricing } from "./website-checkout-pricing";
import type { StoredOrder } from "./razorpay-payment-sync";
import type { CheckoutQuote } from "./transactional-checkout";
import { parseSalesPromotions, type PromotionBillContext } from "./sales-promotions";

type Setting = { key: string; value: string };
type InputOrder = { items?: unknown; total?: unknown; paymentMethod?: unknown; fulfillmentMethod?: unknown; shippingTotal?: unknown; codCharge?: unknown; couponDiscount?: unknown; promotionDiscount?: unknown };
const money = (value: unknown) => Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
const paise = (value: unknown) => Math.round(money(value) * 100);

export function validateMobileQuote(order: InputOrder, products: PublicCatalogProduct[], settings: Setting[]) {
  const setting = (key: string) => {
    const raw = settings.find((row) => row.key === key)?.value;
    if (!raw) throw new Error(`Checkout setting ${key} is required.`);
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { throw new Error(`Checkout setting ${key} is invalid.`); }
  };
  const payment = setting("payment_methods");
  const delivery = setting("delivery_charge");
  if (order.paymentMethod !== "cod" && order.paymentMethod !== "online") throw new Error("Select a valid payment method.");
  if (payment[order.paymentMethod] !== true) throw new Error("Selected payment method is currently unavailable.");
  // Mobile currently exposes delivery only. Pickup needs an authoritative hub
  // and serviceability contract before it can be accepted here.
  if (order.fulfillmentMethod !== "delivery") throw new Error("Select home delivery for mobile checkout.");
  if (!Array.isArray(order.items) || order.items.length === 0 || order.items.length > 100) throw new Error("Valid checkout items are required.");
  let subtotal = 0;
  const quantities = new Map<string, number>();
  for (const item of order.items) {
    if (!item || typeof item !== "object") throw new Error("Valid checkout items are required.");
    const product = products.find((row) => row.sku === item.productId);
    if (!product || !Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new Error("Checkout item is no longer available.");
    if (!Number.isFinite(product.price) || product.price <= 0 || paise(item.price) !== Math.round(product.price * 100)) throw new Error("Checkout item price has changed. Refresh your cart.");
    let available = product.stock;
    let selection = "base";
    if (product.variantType === "size") {
      if (!item.size || !product.sizes.includes(item.size) || !(item.size in product.sizeStock) || item.variantName) throw new Error("Select a valid product size.");
      available = product.sizeStock[item.size];
      selection = `size:${item.size}`;
    } else if (product.variants.length) {
      const index = product.variants.findIndex((v, i) => (v.name || `Option ${i + 1}`) === item.variantName);
      if (index < 0 || item.size) throw new Error("Select a valid product variant.");
      available = product.variants[index].stock ?? product.stock;
      selection = `variant:${index}`;
    } else if (item.size || item.variantName) throw new Error("Product has no such variant.");
    const key = `${product.sku}:${selection}`;
    const quantity = (quantities.get(key) || 0) + item.quantity;
    quantities.set(key, quantity);
    if (quantity > available) throw new Error("Checkout items do not have enough stock.");
    subtotal += Math.round(product.price * 100) * item.quantity;
  }
  const configuredCharge = (value: unknown) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error("Checkout charge configuration is invalid.");
    return Math.round(number * 100);
  };
  const shipping = delivery.enabled === true && !(delivery.freeAboveEnabled === true && subtotal >= configuredCharge(delivery.freeAbove)) ? configuredCharge(delivery.amount) : 0;
  const cod = order.paymentMethod === "cod" ? configuredCharge(payment.codCharge) : 0;
  if (money(order.couponDiscount || 0) !== 0 || money(order.promotionDiscount || 0) !== 0) throw new Error("Mobile discounts require server authorization.");
  if (paise(order.shippingTotal) !== shipping || paise(order.codCharge) !== cod || paise(order.total) !== subtotal + shipping + cod) throw new Error("Checkout total has changed. Refresh your cart.");
}

export async function authorizeMobileQuote(order: InputOrder, website = false, loadCustomerContext?: () => Promise<PromotionBillContext>): Promise<CheckoutQuote> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("Server checkout configuration is required.");
  const read = async (path: string) => {
    const response = await fetch(`${base}/rest/v1/${path}`, { cache: "no-store", headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!response.ok) throw new Error("Could not validate current checkout data.");
    return response.json();
  };
  const [products, vendors, settings] = await Promise.all([
    read("products?select=sku,name,category,stock,price,status,image,vendor_id,vendor_status,public_vendor_visible"),
    read("vendors?select=id,slug,business_name,status,store_visibility"),
    read("store_settings?key=in.(product_variants,product_variant_type,product_sizes,product_size_stock,payment_methods,delivery_charge,promotional_offers,sales_promotions,marketing_records,agents,pickup_hubs)&select=key,value"),
  ]) as [Array<Record<string, unknown>>, Array<Record<string, unknown>>, Setting[]];
  const value = (key: string) => settings.find((row) => row.key === key)?.value;
  const catalog = buildPublicCatalogResponse({ products, vendors, settings: { productVariants: value("product_variants"), productVariantType: value("product_variant_type"), productSizes: value("product_sizes"), productSizeStock: value("product_size_stock") } });
  let promotionResult: ReturnType<typeof validateWebsitePricing> | undefined;
  if (website) {
    const needsHistory = parseSalesPromotions(value("sales_promotions") || null).some((promotion) => promotion.type === "first");
    const customerContext = needsHistory && loadCustomerContext ? await loadCustomerContext() : {};
    promotionResult = validateWebsitePricing(order as StoredOrder, catalog.products, settings, customerContext);
    // Stock and exact selection are checked atomically by the reserve RPC.
  } else validateMobileQuote(order, catalog.products, settings);
  const items = (order as StoredOrder).items || [];
  return {
    expiresAt: promotionResult?.expiresAt || new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    prices: Object.fromEntries(items.map((item) => {
      const product = catalog.products.find((row) => row.sku === item.productId)!;
      return [product.sku, Math.round(product.price * 100)];
    })),
    settings: Object.fromEntries(settings.filter((row) => ["payment_methods", "delivery_charge", "promotional_offers", "sales_promotions", "marketing_records", "agents", "pickup_hubs"].includes(row.key)).map((row) => [row.key, row.value])),
    firstPurchase: promotionResult?.firstPurchase || false,
    salesOfferId: promotionResult?.salesOfferId || undefined,
    promotions: promotionResult?.redemptions || [],
  };
}
