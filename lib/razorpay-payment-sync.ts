type StoredOrder = {
  id: string;
  userId?: string;
  userPhone?: string;
  userEmail?: string;
  date: string;
  createdAt?: string;
  status: "Processing" | "Packed" | "Shipped" | "Delivered" | "Cancelled";
  total: string;
  customerName: string;
  phone: string;
  email?: string;
  address?: string;
  paymentStatus?: "pending" | "paid";
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  inventoryReserved?: boolean;
  inventoryReservedAt?: string;
  inventoryReleased?: boolean;
  inventoryAdjusted?: boolean;
  couponDiscount?: number;
  promotionDiscount?: number;
  shippingTotal?: number;
  items?: Array<{ name: string; quantity: number; price: string; regularPrice?: number; productId?: string; variantName?: string; size?: string; supplierName?: string; vendorId?: string | null; vendorName?: string; vendorSlug?: string }>;
};

import { syncVendorOrderForPaidOrder } from "./vendor-server";

type StoredVariant = { name?: string; size?: string; stock?: number; [key: string]: unknown };

export type RazorpayPayment = {
  id: string;
  order_id?: string;
  amount?: number;
  email?: string;
  contact?: string;
  created_at?: number;
  notes?: Record<string, unknown>;
};

const paymentAddress = (payment: RazorpayPayment) => {
  const address = payment.notes?.address;
  return typeof address === "string" && address.trim() ? address.trim() : undefined;
};

const customerEmail = (email?: string) => {
  const normalized = email?.trim();
  // Razorpay uses this placeholder for some payment methods. It is not the customer's email.
  return normalized && !normalized.toLowerCase().endsWith("@razorpay.com") ? normalized : undefined;
};

const restorePaymentContactDetails = (order: StoredOrder, payment: RazorpayPayment) => {
  const address = paymentAddress(payment);
  const email = customerEmail(payment.email);
  if (payment.contact?.trim()) order.phone = payment.contact.trim();
  if (address) order.address = address;
  if (email) order.email = email;
  if (!email && order.email?.toLowerCase().endsWith("@razorpay.com")) delete order.email;
  if (!email && order.customerName === payment.email?.split("@")[0]) order.customerName = "Razorpay customer";
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://pdrcrkxeyqxqgpwfxqpu.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || "sb_publishable_OTSfS6G2tlrAGINfyY3VGA_yi_3BPAV";

const headers = {
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
  "Content-Type": "application/json",
};

const asMoney = (amountPaise: number) => `₹${Math.round(amountPaise / 100).toLocaleString("en-IN")}`;
const asOrderId = (payment: RazorpayPayment, receipt?: string) => {
  const notedId = typeof payment.notes?.fanzzy_order_id === "string" ? payment.notes.fanzzy_order_id.trim() : "";
  if (/^#FZ-[A-Z0-9-]+$/i.test(notedId)) return notedId;
  const receiptId = String(receipt || "").trim();
  if (/^#?FZ-[A-Z0-9-]+$/i.test(receiptId)) return receiptId.startsWith("#") ? receiptId : `#${receiptId}`;
  return `#FZ-RZP-${payment.id.slice(-6).toUpperCase()}`;
};

async function readOrders() {
  const response = await fetch(`${supabaseUrl}/rest/v1/store_settings?key=eq.orders&select=value`, { headers });
  if (!response.ok) throw new Error("Could not read saved orders");
  const rows = await response.json() as Array<{ value?: string }>;
  try {
    const parsed = JSON.parse(rows[0]?.value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed as StoredOrder[] : [];
  } catch {
    return [] as StoredOrder[];
  }
}

async function writeOrders(orders: StoredOrder[]) {
  const response = await fetch(`${supabaseUrl}/rest/v1/store_settings?on_conflict=key`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ key: "orders", value: JSON.stringify(orders), updated_at: new Date().toISOString() }]),
  });
  if (!response.ok) throw new Error("Could not save the paid order");
}

async function readJsonSetting<T>(key: string, fallback: T) {
  const response = await fetch(`${supabaseUrl}/rest/v1/store_settings?key=eq.${encodeURIComponent(key)}&select=value`, { headers });
  if (!response.ok) throw new Error(`Could not read ${key}`);
  const rows = await response.json() as Array<{ value?: string }>;
  try {
    return JSON.parse(rows[0]?.value || "") as T;
  } catch {
    return fallback;
  }
}

async function writeJsonSetting(key: string, value: unknown) {
  const response = await fetch(`${supabaseUrl}/rest/v1/store_settings?on_conflict=key`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ key, value: JSON.stringify(value), updated_at: new Date().toISOString() }]),
  });
  if (!response.ok) throw new Error(`Could not update ${key}`);
}

const normalizeSelection = (value?: string) => String(value || "").trim().replace(/^size\s+/i, "").toLowerCase();
const normalizeSku = (value?: string) => String(value || "").trim().replace(/[^a-z0-9]/gi, "").toLowerCase();
const findSettingKey = <T>(settings: Record<string, T>, sku: string) =>
  Object.keys(settings).find((key) => normalizeSku(key) === normalizeSku(sku));
const resolveSettingKey = <T>(settings: Record<string, T>, sku: string) => findSettingKey(settings, sku) || sku;

type InventoryMode = "decrement" | "release";
type InventoryAdjustment = { complete: boolean; reason?: string };

const inventoryMutationQueue: { current: Promise<void> } = { current: Promise.resolve() };
const withInventoryMutationLock = async <T>(operation: () => Promise<T>) => {
  const previous = inventoryMutationQueue.current;
  let release!: () => void;
  inventoryMutationQueue.current = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
};

const stockAfterAdjustment = (current: number, quantity: number, mode: InventoryMode) =>
  mode === "release" ? Math.max(0, Math.floor(current + quantity)) : Math.max(0, Math.floor(current - quantity));

async function adjustInventory(order: StoredOrder, mode: InventoryMode = "decrement", requireAvailable = false): Promise<InventoryAdjustment> {
  const [savedVariants, savedSizeStock, savedVariantTypes] = await Promise.all([
    readJsonSetting<Record<string, StoredVariant[]>>("product_variants", {}),
    readJsonSetting<Record<string, Record<string, number>>>("product_size_stock", {}),
    readJsonSetting<Record<string, "normal" | "size">>("product_variant_type", {}),
  ]);
  const variants = structuredClone(savedVariants);
  const sizeStock = structuredClone(savedSizeStock);
  const baseQuantities = new Map<string, number>();
  let variantsChanged = false;
  let sizeStockChanged = false;
  const unresolvedProductIds = new Set<string>();

  // Checkout may store a normalized product id while Admin keys inventory by
  // the original SKU. Resolve each order line to that canonical SKU first.
  let productRows: Array<{ sku?: string; stock?: number }> = [];
  try {
    const productResponse = await fetch(`${supabaseUrl}/rest/v1/products?select=sku,stock`, { headers });
    if (productResponse.ok) productRows = await productResponse.json() as Array<{ sku?: string; stock?: number }>;
  } catch {
    productRows = [];
  }
  const resolveProductSku = (rawSku: string) =>
    productRows.find((product) => normalizeSku(product.sku) === normalizeSku(rawSku))?.sku?.trim()
      || findSettingKey(savedVariants, rawSku)
      || findSettingKey(savedSizeStock, rawSku)
      || findSettingKey(savedVariantTypes, rawSku)
      || rawSku;

  order.items?.forEach((item) => {
    const rawSku = String(item.productId || "").trim();
    const sku = resolveProductSku(rawSku);
    const quantity = Math.floor(Number(item.quantity) || 0);
    if (!sku || quantity <= 0) return;
    const product = productRows.find((candidate) => normalizeSku(candidate.sku) === normalizeSku(sku));
    const hasBaseStock = product?.stock !== undefined && product?.stock !== null && Number.isFinite(Number(product.stock));

    const variantTypeKey = resolveSettingKey(savedVariantTypes, sku);
    // The checkout line is the source of truth for the selected stock bucket.
    // This also repairs older products whose variant-type setting was not saved.
    const selectionType = item.size ? "size" : item.variantName ? "normal" : savedVariantTypes[variantTypeKey];
    if (selectionType === "size" && item.size) {
      const normalizedSize = normalizeSelection(item.size);
      const sizeStockKey = resolveSettingKey(sizeStock, sku);
      const currentSizeStock = sizeStock[sizeStockKey] || {};
      const sizeKey = Object.keys(currentSizeStock).find((key) => normalizeSelection(key) === normalizedSize) || item.size;
      const variantsKey = resolveSettingKey(variants, sku);
      const productVariants = variants[variantsKey] || [];
      const variantIndex = productVariants.findIndex((variant) => normalizeSelection(variant.size || variant.name) === normalizedSize);
      const sizeVariant = variantIndex >= 0 ? productVariants[variantIndex] : undefined;
      const configuredSizeStock = currentSizeStock[sizeKey];
      const variantAvailable = Number(sizeVariant?.stock);
      const hasConfiguredSizeStock = configuredSizeStock !== undefined && Number.isFinite(Number(configuredSizeStock));
      const hasVariantStock = Number.isFinite(variantAvailable);

      // Legacy products sometimes have a selected size but no matching size
      // or variant inventory row. Their base product stock is the only stock
      // bucket we can safely decrement in that case.
      if (!hasConfiguredSizeStock && !hasVariantStock) {
        // A zero base stock cannot represent the selected size. Keep the
        // payment pending until the size metadata is restored instead of
        // incorrectly marking its inventory as adjusted.
        if (!hasBaseStock) unresolvedProductIds.add(rawSku || sku);
        else baseQuantities.set(sku, (baseQuantities.get(sku) || 0) + quantity);
        return;
      }
      if (hasConfiguredSizeStock) {
        const available = Math.floor(Number(configuredSizeStock));
        if (mode === "decrement" && requireAvailable && available < quantity) {
          unresolvedProductIds.add(rawSku || sku);
          return;
        }
        sizeStock[sizeStockKey] = {
          ...currentSizeStock,
          [sizeKey]: stockAfterAdjustment(available, quantity, mode),
        };
        sizeStockChanged = true;
      }
      if (hasVariantStock && sizeVariant) {
        const available = Math.floor(Number(sizeVariant.stock));
        if (mode === "decrement" && requireAvailable && available < quantity) {
          unresolvedProductIds.add(rawSku || sku);
          return;
        }
        variants[variantsKey] = productVariants.map((variant, index) => index === variantIndex
          ? { ...variant, stock: stockAfterAdjustment(available, quantity, mode) }
          : variant);
        variantsChanged = true;
      }
      return;
    }

    if (selectionType === "normal" && item.variantName) {
      const normalizedVariant = normalizeSelection(item.variantName);
      const variantsKey = resolveSettingKey(variants, sku);
      const productVariants = variants[variantsKey] || [];
      const variantIndex = productVariants.findIndex((variant, index) =>
        normalizeSelection(variant.name || `Option ${index + 1}`) === normalizedVariant,
      );
      const selectedVariant = variantIndex >= 0 ? productVariants[variantIndex] : undefined;
      if (!selectedVariant || !Number.isFinite(Number(selectedVariant.stock))) {
        if (!hasBaseStock) unresolvedProductIds.add(rawSku || sku);
        else baseQuantities.set(sku, (baseQuantities.get(sku) || 0) + quantity);
        return;
      }
      const available = Math.floor(Number(selectedVariant.stock));
      if (mode === "decrement" && requireAvailable && available < quantity) {
        unresolvedProductIds.add(rawSku || sku);
        return;
      }
      variants[variantsKey] = productVariants.map((variant, index) => index === variantIndex
        ? { ...variant, stock: stockAfterAdjustment(available, quantity, mode) }
        : variant);
      variantsChanged = true;
      return;
    }

    if (!hasBaseStock) unresolvedProductIds.add(rawSku || sku);
    else baseQuantities.set(sku, (baseQuantities.get(sku) || 0) + quantity);
  });

  // Do not partially deduct an order. A local-only or deleted product cannot
  // be reconciled from this server, so its order stays pending instead of
  // making its other lines reduce again during every future sync.
  if (unresolvedProductIds.size > 0) {
    return { complete: false, reason: mode === "decrement" && requireAvailable ? "One or more products do not have enough stock." : undefined };
  }

  for (const [sku, quantity] of baseQuantities) {
    let expectedStock = Number(productRows.find((product) => normalizeSku(product.sku) === normalizeSku(sku))?.stock);
    if (!Number.isFinite(expectedStock)) return { complete: false };
    if (mode === "decrement" && requireAvailable && expectedStock < quantity) {
      return { complete: false, reason: "One or more products do not have enough stock." };
    }
    let updated = false;
    for (let attempt = 0; attempt < 3 && !updated; attempt += 1) {
      const nextStock = stockAfterAdjustment(expectedStock, quantity, mode);
      const updateResponse = await fetch(`${supabaseUrl}/rest/v1/products?sku=eq.${encodeURIComponent(sku)}&stock=eq.${encodeURIComponent(String(expectedStock))}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({ stock: nextStock, updated_at: new Date().toISOString() }),
      });
      if (!updateResponse.ok) throw new Error("Could not update product inventory");
      const updatedRows = await updateResponse.json() as Array<{ sku?: string }>;
      if (updatedRows.length > 0) {
        updated = true;
        break;
      }
      const retryResponse = await fetch(`${supabaseUrl}/rest/v1/products?sku=eq.${encodeURIComponent(sku)}&select=sku,stock`, { headers });
      if (!retryResponse.ok) return { complete: false };
      const retryRows = await retryResponse.json() as Array<{ sku?: string; stock?: number }>;
      expectedStock = Number(retryRows[0]?.stock);
      if (!Number.isFinite(expectedStock)) return { complete: false };
      if (mode === "decrement" && requireAvailable && expectedStock < quantity) {
        return { complete: false, reason: "One or more products do not have enough stock." };
      }
    }
    if (!updated) return { complete: false, reason: "Inventory changed while this order was being reserved." };
  }

  if (sizeStockChanged) await writeJsonSetting("product_size_stock", sizeStock);
  if (variantsChanged) await writeJsonSetting("product_variants", variants);
  return { complete: true };
}

export async function reconcilePendingOrderInventory() {
  const initialOrders = await readOrders();
  const reservationExpiry = Date.now() - 5 * 60 * 1000;
  for (const order of initialOrders) {
    if (order.paymentStatus !== "pending" || order.inventoryReserved !== true || order.inventoryReleased === true) continue;
    const reservedAt = Date.parse(order.inventoryReservedAt || order.createdAt || order.date || "");
    if (Number.isFinite(reservedAt) && reservedAt <= reservationExpiry) {
      await releaseReservedOrderInventory(order.id).catch(() => undefined);
    }
  }

  const orders = await readOrders();
  let reconciled = 0;
  let pending = 0;
  let ordersChanged = false;

  // Covers paid orders older than Razorpay's latest-payment window. Only an
  // explicit true is an idempotency marker, so stock is never reduced twice.
  for (const order of orders) {
    if (order.paymentStatus !== "paid" || order.inventoryAdjusted === true) continue;
    try {
      if (order.inventoryReserved === true && order.inventoryReleased !== true) {
        order.inventoryAdjusted = true;
        reconciled += 1;
        ordersChanged = true;
        continue;
      }
      const adjustment = await withInventoryMutationLock(() => adjustInventory(order));
      if (adjustment.complete) {
        order.inventoryAdjusted = true;
        reconciled += 1;
      } else {
        order.inventoryAdjusted = false;
        pending += 1;
      }
    } catch {
      order.inventoryAdjusted = false;
      pending += 1;
    }
    ordersChanged = true;
  }

  if (ordersChanged) await writeOrders(orders);
  return { reconciled, pending };
}

async function finalizeRazorpayPaymentInternal(payment: RazorpayPayment, receipt?: string) {
  if (!payment.id) throw new Error("Razorpay payment ID is missing");
  const orders = await readOrders();
  let order = orders.find((candidate) => candidate.razorpayPaymentId === payment.id);
  // Older paid orders do not have inventoryAdjusted. Treat only an explicit
  // true value as complete so the next payment sync can repair their missing
  // size/variant stock deduction and then mark them complete.
  if (order?.paymentStatus === "paid" && order.inventoryAdjusted === true) {
    if (!order.createdAt && payment.created_at) order.createdAt = new Date(payment.created_at * 1000).toISOString();
    restorePaymentContactDetails(order, payment);
    await writeOrders(orders);
    await syncVendorOrderForPaidOrder(order).catch(() => undefined);
    return order;
  }

  if (!order) {
    order = orders.find((candidate) => candidate.razorpayOrderId && candidate.razorpayOrderId === payment.order_id);
  }
  if (!order) {
    const notedOrderId = typeof payment.notes?.fanzzy_order_id === "string" ? payment.notes.fanzzy_order_id.trim() : "";
    if (notedOrderId) order = orders.find((candidate) => candidate.id === notedOrderId);
  }
  if (!order) {
    order = {
      id: asOrderId(payment, receipt),
      date: payment.created_at ? new Date(payment.created_at * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      createdAt: payment.created_at ? new Date(payment.created_at * 1000).toISOString() : new Date().toISOString(),
      status: "Processing",
      total: asMoney(Number(payment.amount) || 0),
      customerName: customerEmail(payment.email)?.split("@")[0] || "Razorpay customer",
      phone: payment.contact || "Not provided",
      email: customerEmail(payment.email),
      address: paymentAddress(payment),
      items: [],
    };
    orders.unshift(order);
  }

  order.paymentStatus = "paid";
  if (!order.createdAt && payment.created_at) order.createdAt = new Date(payment.created_at * 1000).toISOString();
  order.razorpayOrderId = payment.order_id || order.razorpayOrderId;
  order.razorpayPaymentId = payment.id;
  restorePaymentContactDetails(order, payment);
  order.inventoryAdjusted = order.inventoryReserved === true && order.inventoryReleased !== true;
  await writeOrders(orders);

  // Payment confirmation must not be lost because an older product is missing
  // size/variant metadata. Keep the paid order and let the next admin sync
  // retry inventory correction while it remains visibly pending.
  if (!order.inventoryAdjusted) {
    try {
      const adjustment = await adjustInventory(order);
      order.inventoryAdjusted = adjustment.complete;
    } catch {
      order.inventoryAdjusted = false;
    }
  }
  await writeOrders(orders);
  await syncVendorOrderForPaidOrder(order).catch(() => undefined);
  return order;
}

export async function finalizeRazorpayPayment(payment: RazorpayPayment, receipt?: string) {
  return withInventoryMutationLock(() => finalizeRazorpayPaymentInternal(payment, receipt));
}

export async function reserveOrderInventory(orderId: string) {
  return withInventoryMutationLock(async () => {
    const orders = await readOrders();
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order) throw new Error("Order could not be found for stock reservation.");
    if (order.paymentStatus === "paid") return order;
    if (order.inventoryReserved === true && order.inventoryReleased !== true) return order;

    const adjustment = await adjustInventory(order, "decrement", true);
    if (!adjustment.complete) throw new Error(adjustment.reason || "One or more products do not have enough stock.");
    order.inventoryReserved = true;
    order.inventoryReservedAt = new Date().toISOString();
    order.inventoryReleased = false;
    order.inventoryAdjusted = false;
    await writeOrders(orders);
    return order;
  });
}

export async function releaseReservedOrderInventory(orderId: string) {
  return withInventoryMutationLock(async () => {
    const orders = await readOrders();
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order) throw new Error("Order could not be found for stock release.");
    if (order.paymentStatus === "paid" || order.inventoryReserved !== true || order.inventoryReleased === true) return order;

    const adjustment = await adjustInventory(order, "release");
    if (!adjustment.complete) throw new Error("Reserved stock could not be released.");
    order.inventoryReserved = true;
    order.inventoryReleased = true;
    order.inventoryAdjusted = false;
    await writeOrders(orders);
    return order;
  });
}
