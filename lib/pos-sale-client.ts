import { browserLocalStorage, prepareBrowserStorage, flushBrowserStorage } from "./browser-storage";
import { adminApiFetch } from "./site-api-client";

type Sale = { id: string; date?: string; total?: string; items?: unknown[]; customerName?: string; phone?: string; couponDiscount?: number; posPaymentMethod?: string };
type LocalPreviewSale = Sale & {
  invoiceNumber?: unknown;
  localPreview?: unknown;
  inventoryAdjusted?: unknown;
  createdAt?: unknown;
};
export type PosInventorySnapshot = {
  sku: string; stock: number; status: "Published" | "Low stock" | "Draft";
  variants: Array<{ name: string; size?: string; image: string; stock?: number; price?: number }>;
  sizeStock: Record<string, number>;
};
export type PosSaleResult<T> = { order: T; orders: T[]; products: PosInventorySnapshot[]; replayed: boolean };
const pendingKey = "fanzzy-pos-sale-attempt";

type PosLine = { productId?: unknown; quantity?: unknown; variantName?: unknown; size?: unknown };

const localPosOnly = () => process.env.NEXT_PUBLIC_LOCAL_POS_ONLY === "true";

const normalizedSelection = (value: unknown) => String(value || "").trim().replace(/^size\s+/i, "").toLowerCase();
const localStockValue = (value: unknown) => {
  const stock = Number(value);
  return Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : undefined;
};

const localStatus = (product: PosInventorySnapshot) => {
  const optionStock = product.variants.some((variant) => localStockValue(variant.stock) !== undefined)
    ? product.variants.reduce((total, variant) => total + (localStockValue(variant.stock) || 0), 0)
    : Object.keys(product.sizeStock).length
      ? Object.values(product.sizeStock).reduce((total, stock) => total + Math.max(0, Number(stock) || 0), 0)
      : product.stock;
  return optionStock <= 0 ? "Draft" as const : optionStock < 10 ? "Low stock" as const : "Published" as const;
};

export const isLocalPosOnly = () => localPosOnly();

// The normal POS identifier is intentionally short enough to read on a bill
// and match against the conventional #FZ-POS-XXXXXX format.
export const createPosSaleToken = () =>
  globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(-6).toUpperCase()
  || String(Date.now()).slice(-6);

// A prior local preview used the complete UUID. Repair only that unmistakable
// local shape in browser storage; this never calls the server or renames a
// shared/live order.
export function migrateLocalPreviewOrderIds<T extends LocalPreviewSale>(orders: T[]): T[] {
  const fullLocalId = /^#FZ-POS-([A-F0-9]{32})$/i;
  let changed = false;
  const migrated = orders.map((order) => {
    const match = fullLocalId.exec(order.id);
    if (!match || order.posPaymentMethod !== "External UPI") return order;
    const token = match[1].slice(-6).toUpperCase();
    const id = `#FZ-POS-${token}`;
    const previousInvoice = `POS-${match[1]}`;
    changed = true;
    return {
      ...order,
      id,
      invoiceNumber: order.invoiceNumber === previousInvoice ? `POS-${token}` : order.invoiceNumber,
      localPreview: true,
    } as T;
  });
  return changed ? migrated : orders;
}

// Local previews use this deliberately separate path. It never calls the
// server or Supabase, and keeps its record and inventory snapshot in the
// current browser only.
export function commitLocalPosSale<T extends Sale>(candidate: T, currentProducts: PosInventorySnapshot[], existingOrders: T[]): PosSaleResult<T> {
  const prior = existingOrders.find((order) => order.id === candidate.id);
  if (prior) {
    if (posBillFingerprint(prior) !== posBillFingerprint(candidate)) throw new Error(`Sale ${candidate.id} already exists with a different bill.`);
    return { order: prior, orders: existingOrders, products: currentProducts, replayed: true };
  }
  const products = currentProducts.map((product) => ({ ...product, variants: product.variants.map((variant) => ({ ...variant })), sizeStock: { ...product.sizeStock } }));
  for (const value of candidate.items || []) {
    const line = value as PosLine;
    const sku = String(line.productId || "");
    const quantity = Math.floor(Number(line.quantity));
    const product = products.find((item) => item.sku === sku);
    if (!product || !Number.isFinite(quantity) || quantity < 1) throw new Error("The local POS sale has an invalid product or quantity.");
    const selectedVariant = normalizedSelection(line.variantName || line.size);
    let optionStockTracked = false;
    if (selectedVariant) {
      const index = product.variants.findIndex((variant, variantIndex) => normalizedSelection(
        line.size ? variant.size || variant.name || `Option ${variantIndex + 1}` : variant.name || `Option ${variantIndex + 1}`,
      ) === selectedVariant);
      const variantStock = index >= 0 ? localStockValue(product.variants[index].stock) : undefined;
      if (index >= 0 && variantStock !== undefined) {
        if (variantStock < quantity) throw new Error(`${sku} does not have enough local option stock.`);
        product.variants[index].stock = Math.max(0, variantStock - quantity);
        optionStockTracked = true;
      }
      const sizeKey = line.size
        ? Object.keys(product.sizeStock).find((key) => normalizedSelection(key) === normalizedSelection(line.size))
        : undefined;
      if (sizeKey) {
        const sizeStock = localStockValue(product.sizeStock[sizeKey]);
        if (sizeStock === undefined || sizeStock < quantity) throw new Error(`${sku} does not have enough local size stock.`);
        product.sizeStock[sizeKey] = sizeStock - quantity;
        optionStockTracked = true;
      }
    }
    if (!optionStockTracked && product.stock < quantity) throw new Error(`${sku} does not have enough local stock.`);
    // Product-level stock can lag behind option stock in the shared catalogue.
    // The production transaction permits the selected option and never lets
    // the aggregate value become negative, so the preview follows suit.
    product.stock = Math.max(0, product.stock - quantity);
    product.status = localStatus(product);
  }
  const order = { ...candidate, posSale: true, inventoryAdjusted: true, localPreview: true } as T;
  return { order, orders: [order, ...existingOrders], products, replayed: false };
}

// The shared catalogue is intentionally read from Supabase even in local-only
// mode, so a refreshed Products/POS workspace used to lose its browser-only
// stock deductions. Reapply every confirmed local preview sale to that fresh
// catalogue. This is display-only local state: it never sends a write request.
export function applyLocalPreviewInventory<T extends PosInventorySnapshot>(currentProducts: T[]): T[] {
  if (!localPosOnly()) return currentProducts;
  let storedOrders: LocalPreviewSale[] = [];
  try {
    const parsed = JSON.parse(browserLocalStorage.getItem("fanzzy-orders") || "[]") as LocalPreviewSale[];
    if (Array.isArray(parsed)) storedOrders = parsed;
  } catch {
    return currentProducts;
  }
  const localSales = storedOrders
    .filter((order) => order?.id && order.localPreview === true && order.inventoryAdjusted === true && Array.isArray(order.items))
    .sort((left, right) => {
      const byCreatedAt = String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
      return byCreatedAt || String(left.id).localeCompare(String(right.id));
    });
  if (!localSales.length) return currentProducts;

  let adjusted: PosInventorySnapshot[] = currentProducts.map((product) => ({
    ...product,
    variants: product.variants.map((variant) => ({ ...variant })),
    sizeStock: { ...product.sizeStock },
  }));
  const appliedSales: LocalPreviewSale[] = [];
  for (const sale of localSales) {
    try {
      const committed = commitLocalPosSale(sale, adjusted, appliedSales);
      adjusted = committed.products;
      appliedSales.push(sale);
    } catch {
      // Keep the rest of the local preview usable if an old saved bill no
      // longer matches a changed shared catalogue.
    }
  }
  const adjustedBySku = new Map(adjusted.map((product) => [product.sku, product]));
  return currentProducts.map((product) => {
    const snapshot = adjustedBySku.get(product.sku);
    return snapshot ? { ...product, ...snapshot } : product;
  });
}

export const posBillFingerprint = (order: Sale) => JSON.stringify([
  order.date, order.total, order.items, order.customerName, order.phone, order.couponDiscount, order.posPaymentMethod,
]);

export function readPendingPosSale<T extends Sale>(): T | null {
  try {
    const order = JSON.parse(browserLocalStorage.getItem(pendingKey) || "null") as T | null;
    return order?.id && Array.isArray(order.items) && order.items.length ? order : null;
  } catch { return null; }
}

export async function commitAtomicPosSale<T extends Sale>(candidate: T): Promise<PosSaleResult<T>> {
  await prepareBrowserStorage();
  const pending = readPendingPosSale<T>();
  if (pending && posBillFingerprint(pending) !== posBillFingerprint(candidate)) {
    throw new Error(`Sale ${pending.id} needs confirmation first. Use Retry saved sale before starting another bill.`);
  }
  const order = pending || candidate;
  browserLocalStorage.setItem(pendingKey, JSON.stringify(order));
  if (!await flushBrowserStorage()) {
    throw new Error("This browser cannot preserve a sale reference across refresh. No sale was submitted. Keep this tab open and retry when storage is available.");
  }
  const response = await adminApiFetch("/admin/pos-sales", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order }),
  });
  const result = await response.json() as PosSaleResult<T> & { error?: string };
  if (!response.ok) {
    // Only known validation/conflict responses prove that this transaction did
    // not commit. Network/5xx failures retain the exact request for safe retry.
    if (response.status === 400 || response.status === 409) {
      browserLocalStorage.removeItem(pendingKey);
      await flushBrowserStorage();
    }
    throw new Error(result.error || "Sale confirmation is uncertain. Retry the saved sale reference.");
  }
  if (result.order?.id !== order.id || !Array.isArray(result.orders) || !Array.isArray(result.products)) {
    throw new Error("Sale confirmation is incomplete. Retry the saved sale reference.");
  }
  browserLocalStorage.removeItem(pendingKey);
  await flushBrowserStorage();
  return result;
}
