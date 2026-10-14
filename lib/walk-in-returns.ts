import type { InventoryOrder } from "./inventory-adjustment";

export const returnReasons = [
  "Wrong product received",
  "Size or variant issue",
  "Product quality issue",
  "Customer changed their mind",
  "Product not as expected",
  "Other",
] as const;

export type ReturnReason = typeof returnReasons[number];
export type RefundSettlementMethod = "Cash" | "UPI";
export type RefundSettlementStatus = "Pending" | "Completed";
export type WalkInReturnStatus = "Return Received" | "Rejected";
export type WalkInRefundStatus = "Refund Pending" | "Refund Completed";

export type WalkInOrderItem = {
  name?: string;
  productName?: string;
  quantity?: number;
  price?: string;
  productId?: string;
  image?: string;
  variantName?: string;
  variantImage?: string;
  size?: string;
  promotion?: { linePrice?: number; regularPrice?: number; role?: string; label?: string };
};

export type WalkInOrder = {
  id: string;
  date?: string;
  createdAt?: string;
  status?: string;
  total?: string;
  customerName?: string;
  userPhone?: string;
  userEmail?: string;
  phone?: string;
  email?: string;
  coupon?: string;
  couponDiscount?: number;
  paymentStatus?: string;
  paymentMethod?: string;
  posPaymentMethod?: string;
  razorpayPaymentId?: string;
  items?: WalkInOrderItem[];
  returnStatus?: string;
  refundStatus?: string;
};

export type WalkInReturnRecord = {
  id: string;
  clientRequestId: string;
  orderId: string;
  orderItemId: string;
  orderItemIndex: number;
  productId: string;
  productName: string;
  sku: string;
  variantName: string;
  size: string;
  quantity: number;
  reason: ReturnReason;
  description: string;
  damaged: boolean;
  refundAmount: number;
  refundMethod: RefundSettlementMethod;
  refundReference: string;
  refundStatus: WalkInRefundStatus;
  returnStatus: WalkInReturnStatus;
  settlementStatus: RefundSettlementStatus;
  createdAt: string;
  completedAt?: string;
  staffMember: string;
  inventoryAdjustment: {
    adjusted: boolean;
    damagedQuantity: number;
    restockedQuantity: number;
    stockScope: string;
  };
};

export type ReturnableOrderLine = {
  id: string;
  index: number;
  productId: string;
  sku: string;
  productName: string;
  image: string;
  variantName: string;
  size: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  priceLabel: string;
  previouslyReturned: number;
  remainingEligible: number;
  promotionLabel: string;
};

export type ReturnOrderSummary = {
  order: WalkInOrder;
  lines: ReturnableOrderLine[];
  returns: WalkInReturnRecord[];
};

export type ReturnSubmission = {
  orderId?: unknown;
  orderItemId?: unknown;
  quantity?: unknown;
  reason?: unknown;
  description?: unknown;
  damaged?: unknown;
  refundMethod?: unknown;
  refundReference?: unknown;
  settlementStatus?: unknown;
  cashAmount?: unknown;
  staffMember?: unknown;
  clientRequestId?: unknown;
};

type StoreConfig = { supabaseUrl: string; supabaseKey: string };

const returnsSettingKey = "walk_in_returns";
const ordersSettingKey = "orders";
const productDamagesSettingKey = "product_damages";

const headers = (config: StoreConfig) => ({
  apikey: config.supabaseKey,
  Authorization: `Bearer ${config.supabaseKey}`,
  "Content-Type": "application/json",
});

export const parseMoneyValue = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace(/,/g, "");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
};

const normalizeId = (value: unknown) => String(value ?? "").trim();
const normalizeComparable = (value: unknown) => normalizeId(value).toLowerCase();

export const buildOrderItemId = (orderId: string, item: WalkInOrderItem, index: number) =>
  [
    orderId,
    index,
    normalizeId(item.productId || item.productName || item.name),
    normalizeId(item.variantName),
    normalizeId(item.size),
  ].join("::");

const orderItemProductName = (item: WalkInOrderItem) =>
  normalizeId(item.productName) || normalizeId(item.name).split(" · ")[0].trim() || "Order item";

const orderItemSku = (item: WalkInOrderItem) => normalizeId(item.productId) || orderItemProductName(item);

const orderItemVariant = (item: WalkInOrderItem) => {
  if (normalizeId(item.variantName)) return normalizeId(item.variantName);
  const parts = normalizeId(item.name).split(" · ").slice(1).filter((part) => !/^size\s+/i.test(part.trim()));
  return parts.join(" · ");
};

const orderItemSize = (item: WalkInOrderItem) =>
  normalizeId(item.size) || normalizeId(item.name).match(/(?:^| · )Size (.+)$/i)?.[1]?.trim() || "";

export const isCompletedReturn = (record: WalkInReturnRecord) => record.returnStatus !== "Rejected";

export const returnedQuantityForLine = (returns: WalkInReturnRecord[], orderItemId: string) =>
  returns
    .filter((record) => record.orderItemId === orderItemId && isCompletedReturn(record))
    .reduce((sum, record) => sum + Math.max(0, Math.floor(Number(record.quantity) || 0)), 0);

export const summarizeReturnableOrder = (order: WalkInOrder, returns: WalkInReturnRecord[] = []): ReturnOrderSummary => {
  const items = Array.isArray(order.items) ? order.items : [];
  const orderReturns = returns.filter((record) => normalizeComparable(record.orderId) === normalizeComparable(order.id));
  const lines = items.map((item, index) => {
    const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
    const unitPrice = item.promotion && Number.isFinite(Number(item.promotion.linePrice))
      ? Math.max(0, Number(item.promotion.linePrice))
      : parseMoneyValue(item.price);
    const id = buildOrderItemId(order.id, item, index);
    const previouslyReturned = Math.min(quantity, returnedQuantityForLine(orderReturns, id));
    return {
      id,
      index,
      productId: orderItemSku(item),
      sku: orderItemSku(item),
      productName: orderItemProductName(item),
      image: normalizeId(item.variantImage) || normalizeId(item.image),
      variantName: orderItemVariant(item),
      size: orderItemSize(item),
      quantity,
      unitPrice,
      lineTotal: unitPrice * quantity,
      priceLabel: normalizeId(item.price) || `₹${unitPrice.toLocaleString("en-IN")}`,
      previouslyReturned,
      remainingEligible: Math.max(0, quantity - previouslyReturned),
      promotionLabel: item.promotion?.label ? String(item.promotion.label) : "",
    };
  });
  return { order, lines, returns: orderReturns };
};

export const validateReturnSubmission = (
  submission: ReturnSubmission,
  summary: ReturnOrderSummary,
) => {
  const orderItemId = normalizeId(submission.orderItemId);
  const line = summary.lines.find((candidate) => candidate.id === orderItemId);
  if (!line) throw new Error("Select a valid item from the original order.");
  if (line.remainingEligible < 1) throw new Error("This order item has already been fully returned.");

  const quantity = Math.floor(Number(submission.quantity));
  if (!Number.isFinite(quantity) || quantity < 1) throw new Error("Return quantity must be at least 1.");
  if (quantity > line.remainingEligible) throw new Error("Return quantity cannot exceed the remaining eligible quantity.");

  const reason = normalizeId(submission.reason) as ReturnReason;
  if (!returnReasons.includes(reason)) throw new Error("Select a supported return reason.");

  const description = normalizeId(submission.description);
  if (reason === "Other" && !description) throw new Error("Please provide a description for the selected return reason.");

  const refundMethod = normalizeId(submission.refundMethod) as RefundSettlementMethod;
  if (refundMethod !== "Cash" && refundMethod !== "UPI") throw new Error("Select a supported refund settlement method.");

  const settlementStatus = normalizeId(submission.settlementStatus) as RefundSettlementStatus || "Pending";
  if (settlementStatus !== "Pending" && settlementStatus !== "Completed") throw new Error("Select a valid refund status.");

  const refundReference = normalizeId(submission.refundReference);
  if (refundMethod === "UPI" && settlementStatus === "Completed" && !refundReference) {
    throw new Error("Enter the UPI transaction reference before marking the refund completed.");
  }

  const refundAmount = Math.round(line.unitPrice * quantity * 100) / 100;
  const cashAmount = Number(submission.cashAmount);
  if (refundMethod === "Cash" && settlementStatus === "Completed" && (!Number.isFinite(cashAmount) || Math.round(cashAmount * 100) < Math.round(refundAmount * 100))) {
    throw new Error("Cash amount handed back must cover the refund amount.");
  }

  return {
    line,
    quantity,
    reason,
    description,
    refundMethod,
    refundReference,
    settlementStatus,
    refundAmount,
    damaged: submission.damaged === true,
    staffMember: normalizeId(submission.staffMember) || "Admin staff",
    clientRequestId: normalizeId(submission.clientRequestId),
  };
};

async function readJsonSetting<T>(config: StoreConfig, key: string, fallback: T): Promise<T> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/store_settings?key=eq.${encodeURIComponent(key)}&select=value`, {
    headers: headers(config),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Could not read ${key}.`);
  const rows = await response.json() as Array<{ value?: string }>;
  try {
    return JSON.parse(rows[0]?.value || "") as T;
  } catch {
    return fallback;
  }
}

async function writeJsonSetting(config: StoreConfig, key: string, value: unknown) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/store_settings?on_conflict=key`, {
    method: "POST",
    headers: { ...headers(config), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ key, value: JSON.stringify(value), updated_at: new Date().toISOString() }]),
  });
  if (!response.ok) throw new Error(`Could not update ${key}.`);
}

export const walkInReturnsConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): StoreConfig => {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim() || env.SUPABASE_URL?.trim() || "";
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() || env.SUPABASE_PUBLISHABLE_KEY?.trim() || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || "";
  if (!supabaseUrl || !supabaseKey) throw new Error("Supabase is not configured.");
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), supabaseKey };
};

export async function getWalkInReturnOrder(orderId: string, config = walkInReturnsConfigFromEnv()) {
  const normalizedOrderId = normalizeId(orderId);
  if (!normalizedOrderId || normalizedOrderId.length > 80) throw new Error("Enter a valid order ID.");
  const [orders, returns] = await Promise.all([
    readJsonSetting<WalkInOrder[]>(config, ordersSettingKey, []),
    readJsonSetting<WalkInReturnRecord[]>(config, returnsSettingKey, []),
  ]);
  const order = orders.find((candidate) => normalizeComparable(candidate.id) === normalizeComparable(normalizedOrderId));
  if (!order) return null;
  return summarizeReturnableOrder(order, returns);
}

const stockScopeForLine = (line: ReturnableOrderLine) =>
  line.size ? `Size ${line.size}` : line.variantName || "Product stock";

export async function processWalkInReturn(submission: ReturnSubmission, config = walkInReturnsConfigFromEnv()) {
  const orderId = normalizeId(submission.orderId);
  const clientRequestId = normalizeId(submission.clientRequestId) || `return-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [orders, currentReturns] = await Promise.all([
    readJsonSetting<WalkInOrder[]>(config, ordersSettingKey, []),
    readJsonSetting<WalkInReturnRecord[]>(config, returnsSettingKey, []),
  ]);
  const existing = currentReturns.find((record) => record.clientRequestId === clientRequestId);
  if (existing) return existing;

  const orderIndex = orders.findIndex((candidate) => normalizeComparable(candidate.id) === normalizeComparable(orderId));
  if (orderIndex < 0) throw new Error("Order could not be found.");
  const summary = summarizeReturnableOrder(orders[orderIndex], currentReturns);
  const validated = validateReturnSubmission({ ...submission, clientRequestId }, summary);
  const now = new Date().toISOString();
  const completed = validated.settlementStatus === "Completed";
  const record: WalkInReturnRecord = {
    id: `RET-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    clientRequestId,
    orderId: summary.order.id,
    orderItemId: validated.line.id,
    orderItemIndex: validated.line.index,
    productId: validated.line.productId,
    productName: validated.line.productName,
    sku: validated.line.sku,
    variantName: validated.line.variantName,
    size: validated.line.size,
    quantity: validated.quantity,
    reason: validated.reason,
    description: validated.description,
    damaged: validated.damaged,
    refundAmount: validated.refundAmount,
    refundMethod: validated.refundMethod,
    refundReference: validated.refundReference,
    refundStatus: completed ? "Refund Completed" : "Refund Pending",
    returnStatus: "Return Received",
    settlementStatus: validated.settlementStatus,
    createdAt: now,
    completedAt: completed ? now : undefined,
    staffMember: validated.staffMember,
    inventoryAdjustment: {
      adjusted: false,
      damagedQuantity: validated.damaged ? validated.quantity : 0,
      restockedQuantity: validated.damaged ? 0 : validated.quantity,
      stockScope: stockScopeForLine(validated.line),
    },
  };

  if (validated.damaged) {
    const damages = await readJsonSetting<Record<string, unknown[]>>(config, productDamagesSettingKey, {});
    const nextDamage = {
      id: `return-damage-${record.id}`,
      sku: record.sku,
      productName: record.productName,
      quantity: record.quantity,
      reason: `${record.reason}${record.description ? ` · ${record.description}` : ""}`,
      stockScope: record.inventoryAdjustment.stockScope,
      createdAt: now,
      returnId: record.id,
      orderId: record.orderId,
    };
    await writeJsonSetting(config, productDamagesSettingKey, {
      ...damages,
      [record.sku]: [...(Array.isArray(damages[record.sku]) ? damages[record.sku] : []), nextDamage],
    });
  } else {
    const inventoryOrder: InventoryOrder = {
      items: [{
        name: record.productName,
        productId: record.sku,
        variantName: record.variantName || undefined,
        size: record.size || undefined,
        quantity: record.quantity,
        price: String(record.refundAmount / record.quantity),
      }],
    };
    // Node's built-in test runner imports TypeScript sources directly, so this
    // dynamic import keeps tests resolvable while the app build still uses the
    // extensionless type import above.
    // @ts-expect-error TypeScript disallows .ts runtime import paths without allowImportingTsExtensions.
    const { adjustOrderInventory } = await import("./inventory-adjustment.ts") as typeof import("./inventory-adjustment");
    const adjustment = await adjustOrderInventory(inventoryOrder, config, "release", false);
    if (!adjustment.complete) throw new Error(adjustment.reason || "Returned stock could not be restocked.");
  }

  const completedRecord: WalkInReturnRecord = {
    ...record,
    inventoryAdjustment: { ...record.inventoryAdjustment, adjusted: true },
  };
  const completedReturns = [completedRecord, ...currentReturns];
  await writeJsonSetting(config, returnsSettingKey, completedReturns);

  const orderReturnRecords = completedReturns.filter((item) => item.orderId === summary.order.id && isCompletedReturn(item));
  const orderItems = summary.lines.reduce((sum, line) => sum + line.quantity, 0);
  const orderReturnedItems = summary.lines.reduce((sum, line) => sum + returnedQuantityForLine(orderReturnRecords, line.id), 0);
  const refundPending = orderReturnRecords.some((item) => item.refundStatus === "Refund Pending");
  const updatedOrders = [...orders];
  updatedOrders[orderIndex] = {
    ...updatedOrders[orderIndex],
    returnStatus: orderReturnedItems >= orderItems ? "Returned" : "Partially returned",
    refundStatus: refundPending ? "Refund pending" : "Refund completed",
  };
  await writeJsonSetting(config, ordersSettingKey, updatedOrders);
  return completedRecord;
}

