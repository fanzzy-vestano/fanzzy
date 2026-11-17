import { randomUUID } from "node:crypto";
import { isPosOrder, orderNeedsDelivery } from "./order-fulfillment";
import type {
  CustomerCancellationReason,
  CustomerCancellationRecord,
} from "./customer-cancellation";
import { createDelhiveryPickupRequest, delhiveryPickupSchedule, getDelhiveryAdminOptions, loadDelhiveryAdminOptions, manifestDelhiveryShipment, trackDelhiveryShipment } from "./delhivery";

export type StoredOrder = {
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
  fulfillmentMethod?: "delivery" | "pickup";
  pickupHubId?: string;
  pickupHubName?: string;
  pickupHubPlace?: string;
  paymentStatus?: "pending" | "paid" | "cod_pending" | "cod_collected";
  paymentMethod?: "online" | "cod";
  codCharge?: number;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  inventoryReserved?: boolean;
  inventoryReservedAt?: string;
  inventoryReleased?: boolean;
  inventoryAdjusted?: boolean;
  cancelledAt?: string;
  cancelledBy?: "customer" | "admin";
  cancellationReason?: CustomerCancellationReason;
  cancellationDescription?: string;
  cancellationRecords?: CustomerCancellationRecord[];
  returnStatus?: "Returned" | "Partially returned" | "Refunded";
  refundStatus?: "Not applicable" | "Pending" | "Completed" | "Refunded";
  refundReference?: string;
  delhiveryAwb?: string;
  delhiveryTrackingUrl?: string;
  delhiveryShipmentStatus?: "awaiting_weight" | "pending" | "created" | "failed" | "skipped";
  delhiveryWeightGrams?: number;
  delhiveryPickupLocation?: string;
  delhiveryShipmentError?: string;
  delhiveryShipmentCreatedAt?: string;
  delhiveryShipmentRequestedAt?: string;
  delhiveryPickupRequestStatus?: "pending" | "created" | "covered" | "failed" | "skipped";
  delhiveryPickupRequestId?: string;
  delhiveryPickupRequestDate?: string;
  delhiveryPickupRequestTime?: string;
  delhiveryPickupExpectedPackageCount?: number;
  delhiveryPickupRequestError?: string;
  delhiveryLiveStatus?: string;
  delhiveryLiveStatusType?: string;
  delhiveryLiveStatusDate?: string;
  delhiveryLiveLocation?: string;
  delhiveryLastTrackedAt?: string;
  delhiveryScans?: Array<{ status: string; date?: string; location?: string; instructions?: string }>;
  couponDiscount?: number;
  coupon?: string;
  promotionDiscount?: number;
  shippingTotal?: number;
  items?: Array<{ name: string; quantity: number; price: string; regularPrice?: number; productId?: string; productName?: string; variantName?: string; size?: string; hsnCode?: string; vendorId?: string | null; vendorName?: string; vendorSlug?: string; cancelled?: boolean; promotion?: { groupId: string; offerId: string; role: "paid" | "free" | "bundle"; linePrice: number; regularPrice: number; label: string } }>;
};
type StoredOrderItem = NonNullable<StoredOrder["items"]>[number];

import { syncVendorOrderForPaidOrder } from "./vendor-server";
import { assertLocalTestServerSafety, isLocalTestEnvironment } from "./runtime-safety";
import { assertCapturedPayment } from "./payment-policy";
import { checkoutRpc, readTransactionalOrders, patchTransactionalOrders, createTransactionalOrder, captureTransactionalPayment } from "./transactional-checkout";
import { recoverCapturedOrderBinding } from "./razorpay-provider";
import { authorizeMobileQuote } from "./mobile-checkout-authority";
import { checkoutRequestHash } from "./transactional-checkout";

type StoredVariant = { name?: string; size?: string; stock?: number; [key: string]: unknown };

export type RazorpayPayment = {
  id: string;
  status?: string;
  captured?: boolean;
  currency?: string;
  order_id?: string;
  amount?: number;
  email?: string;
  contact?: string;
  created_at?: number;
  notes?: Record<string, unknown>;
};

assertLocalTestServerSafety(process.env);

const orderIdFromReceipt = (receipt?: string) => {
  const value = String(receipt || "").trim();
  if (!/^#?FZ-[A-Z0-9-]+$/i.test(value)) return "";
  return value.startsWith("#") ? value : `#${value}`;
};

const isPosPayment = (payment: RazorpayPayment, receipt?: string) => {
  const notedOrderId = typeof payment.notes?.fanzzy_order_id === "string" ? payment.notes.fanzzy_order_id.trim() : "";
  const posReference = typeof payment.notes?.fanzzy_pos_reference === "string" ? payment.notes.fanzzy_pos_reference.trim() : "";
  const paymentSource = typeof payment.notes?.fanzzy_payment_source === "string" ? payment.notes.fanzzy_payment_source.trim() : "";
  return /^#?FZ-POS-/i.test(orderIdFromReceipt(receipt))
    || /^#?FZ-POS-/i.test(notedOrderId)
    || Boolean(posReference)
    || paymentSource === "pos_qr_fallback";
};

async function readOrders() { return readTransactionalOrders(); }

const publicTrackingPhone = (value: string) => String(value || "").replace(/\D/g, "").slice(-10);

const publicTrackingOrderId = (value: string) => {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized.startsWith("#") ? normalized : `#${normalized}`;
};

/**
 * Looks up only the non-sensitive shipment fields needed by the public
 * tracking page. The customer's phone number is required so an order number
 * alone cannot reveal shipment details.
 */
export async function lookupPublicOrderTracking(orderId: string, phone: string) {
  const orders = await readOrders();
  const requestedId = publicTrackingOrderId(orderId);
  const requestedPhone = publicTrackingPhone(phone);
  const order = orders.find((candidate) =>
    candidate.id.trim().toUpperCase() === requestedId
    && [candidate.phone, candidate.userPhone].some((value) => publicTrackingPhone(String(value || "")) === requestedPhone),
  );
  if (!order) return null;

  let liveTracking: Awaited<ReturnType<typeof trackDelhiveryShipment>> | undefined;
  if (order.delhiveryAwb) {
    try {
      liveTracking = await trackDelhiveryShipment(order.delhiveryAwb, order.id);
    } catch {
      // Keep showing the last saved shipment status if Delhivery is temporarily unavailable.
    }
  }

  return {
    orderId: order.id,
    placedOn: order.createdAt || order.date,
    deliveryAddress: order.fulfillmentMethod === "pickup" ? undefined : order.address,
    status: liveTracking?.status || order.delhiveryLiveStatus || order.status || "Order received",
    statusType: liveTracking?.statusType || order.delhiveryLiveStatusType,
    statusDate: liveTracking?.statusDate || order.delhiveryLiveStatusDate,
    location: liveTracking?.location || order.delhiveryLiveLocation,
    waybill: order.delhiveryAwb,
    trackingUrl: order.delhiveryTrackingUrl,
    scans: liveTracking?.scans || [],
    shipmentAvailable: Boolean(order.delhiveryAwb),
  };
}

async function writeOrders(orders: StoredOrder[]) { return patchTransactionalOrders(orders); }

const normalizeText = (value: unknown, maxLength = 240) =>
  String(typeof value === "string" || typeof value === "number" ? value : "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

const normalizeOrderMoney = (value: unknown) => {
  const text = normalizeText(value, 40);
  if (/^₹[0-9,]+(?:\.\d{1,2})?$/.test(text)) return text;
  const amount = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) ? `₹${Math.max(0, Math.round(amount)).toLocaleString("en-IN")}` : "₹0";
};

const normalizeOrderNumber = (value: unknown) => {
  const orderId = normalizeText(value, 40).toUpperCase();
  return /^#FZ-[A-Z0-9-]+$/.test(orderId) ? orderId : "";
};

const normalizePositiveInteger = (value: unknown, fallback = 0) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const sanitizeMobilePendingOrder = (value: unknown, identity: { id: string; phone: string }): StoredOrder => {
  const source = value && typeof value === "object" ? value as Partial<StoredOrder> : {};
  const id = normalizeOrderNumber(source.id);
  if (!id) throw new Error("A valid Fanzzy order ID is required.");
  if (source.status && source.status !== "Processing") throw new Error("Mobile orders must start as Processing.");
  if (source.paymentStatus && source.paymentStatus !== "pending") throw new Error("Mobile orders must start with pending payment status.");
  if (source.paymentMethod !== "cod" && source.paymentMethod !== "online") throw new Error("Select a valid payment method.");

  const customerPhone = normalizeText(source.phone || source.userPhone || identity.phone, 32);
  const userPhone = normalizeText(source.userPhone || identity.phone, 32);
  const identityMatches = source.userId === identity.id || customerPhoneDigits(userPhone || customerPhone) === customerPhoneDigits(identity.phone);
  if (!identityMatches) throw new Error("This order does not belong to the signed-in customer.");

  const fulfillmentMethod = source.fulfillmentMethod === "pickup" ? "pickup" : "delivery";
  const address = normalizeText(source.address, 320);
  if (fulfillmentMethod === "delivery" && !/\b[1-9][0-9]{5}\b/.test(address)) {
    throw new Error("A complete delivery address with a valid pincode is required.");
  }
  if (fulfillmentMethod === "pickup" && !normalizeText(source.pickupHubId || source.pickupHubName, 120)) {
    throw new Error("Select a pickup hub for this order.");
  }

  const items = Array.isArray(source.items) ? source.items.map((item) => {
    const row = item && typeof item === "object" ? item as Partial<StoredOrderItem> : {};
    return {
      productId: normalizeText(row.productId, 120),
      productName: normalizeText(row.productName, 160),
      name: normalizeText(row.name, 200),
      quantity: normalizePositiveInteger(row.quantity),
      price: normalizeOrderMoney(row.price),
      regularPrice: Math.max(0, Number(row.regularPrice) || 0),
      variantName: normalizeText(row.variantName, 120) || undefined,
      size: normalizeText(row.size, 40) || undefined,
      hsnCode: normalizeText(row.hsnCode, 40) || undefined,
      vendorId: row.vendorId === null ? null : normalizeText(row.vendorId, 120) || undefined,
      vendorName: normalizeText(row.vendorName, 160) || undefined,
      vendorSlug: normalizeText(row.vendorSlug, 120) || undefined,
      promotion: row.promotion,
    };
  }).filter((item) => item.productId && item.name && item.quantity > 0) : [];
  if (!items.length) throw new Error("Add at least one item before checkout.");

  const now = new Date().toISOString();
  const createdAt = normalizeText(source.createdAt, 40);
  const date = normalizeText(source.date, 20);
  return {
    id,
    userId: identity.id,
    userPhone,
    userEmail: normalizeText(source.userEmail, 160) || undefined,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : now.slice(0, 10),
    createdAt: createdAt && !Number.isNaN(Date.parse(createdAt)) ? createdAt : now,
    status: "Processing",
    total: normalizeOrderMoney(source.total),
    customerName: normalizeText(source.customerName, 140) || "Fanzzy customer",
    phone: customerPhone || identity.phone,
    email: normalizeText(source.email, 160) || undefined,
    address,
    fulfillmentMethod,
    pickupHubId: fulfillmentMethod === "pickup" ? normalizeText(source.pickupHubId, 120) || undefined : undefined,
    pickupHubName: fulfillmentMethod === "pickup" ? normalizeText(source.pickupHubName, 160) || undefined : undefined,
    pickupHubPlace: fulfillmentMethod === "pickup" ? normalizeText(source.pickupHubPlace, 160) || undefined : undefined,
    paymentStatus: "pending",
    paymentMethod: source.paymentMethod,
    codCharge: Math.max(0, Number(source.codCharge) || 0),
    couponDiscount: Math.max(0, Number(source.couponDiscount) || 0),
    coupon: normalizeText(source.coupon, 80) || undefined,
    promotionDiscount: Math.max(0, Number(source.promotionDiscount) || 0),
    shippingTotal: Math.max(0, Number(source.shippingTotal) || 0),
    items,
  };
};

const delhiveryFailureMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Delhivery shipment creation failed.";
  return message.replace(/\s+/g, " ").trim().slice(0, 240);
};

const delhiveryPickupFailureMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Delhivery pickup request failed.";
  return message.replace(/\s+/g, " ").trim().slice(0, 240);
};

// Automatic Delhivery booking starts with the current storefront rollout.
// Older paid orders remain in order history but must never be booked later by
// a payment-repair/sync run.
const delhiveryAutomationStartDate = "2026-09-05";

const requiresAdminShipmentWeight = () => /^(1|true|yes|on)$/i.test(String(process.env.DELHIVERY_REQUIRE_ADMIN_WEIGHT || ""));

const isDeliveryOrderReadyForPickup = (order: StoredOrder) =>
  orderNeedsDelivery(order)
  && Boolean(order.delhiveryAwb)
  && order.delhiveryShipmentStatus === "created"
  && order.status !== "Delivered"
  && order.status !== "Cancelled";

const pickupRequestAlreadyCoversWarehouse = (error: unknown) =>
  /already exist|auto pickup/i.test(error instanceof Error ? error.message : String(error || ""));

async function ensureDelhiveryPickupRequest(orders: StoredOrder[], order: StoredOrder) {
  if (!isDeliveryOrderReadyForPickup(order)) return;
  // A pending request with an error is a previous failed attempt. Allow the
  // next payment/admin sync to retry it after the Delhivery wallet is topped up.
  if (order.delhiveryPickupRequestStatus === "pending" && !order.delhiveryPickupRequestError) return;

  const defaultPickupLocation = getDelhiveryAdminOptions().pickupLocations[0] || "";
  const pickupLocation = order.delhiveryPickupLocation || defaultPickupLocation;
  const schedule = delhiveryPickupSchedule(order.delhiveryPickupRequestTime);
  if (order.delhiveryPickupRequestStatus === "created" && (order.delhiveryPickupRequestDate || "") >= schedule.currentDate) return;

  // Delhivery raises pickup requests against a warehouse, not an individual
  // AWB. Cover later orders with the request already created for this slot.
  const existingRequest = orders.find((candidate) =>
    candidate.id !== order.id
    && (candidate.delhiveryPickupLocation || defaultPickupLocation) === pickupLocation
    && (candidate.delhiveryPickupRequestDate || "") >= schedule.currentDate
    && ["pending", "created", "covered"].includes(candidate.delhiveryPickupRequestStatus || ""),
  );
  if (existingRequest) {
    order.delhiveryPickupRequestStatus = "covered";
    order.delhiveryPickupRequestId = existingRequest.delhiveryPickupRequestId;
    order.delhiveryPickupRequestDate = existingRequest.delhiveryPickupRequestDate;
    order.delhiveryPickupRequestTime = existingRequest.delhiveryPickupRequestTime;
    order.delhiveryPickupExpectedPackageCount = existingRequest.delhiveryPickupExpectedPackageCount;
    delete order.delhiveryPickupRequestError;
    await writeOrders(orders);
    return;
  }

  order.delhiveryPickupRequestStatus = "pending";
  order.delhiveryPickupRequestDate = schedule.pickupDate;
  order.delhiveryPickupRequestTime = schedule.pickupTime;
  await writeOrders(orders);
  try {
    const expectedPackageCount = orders.filter((candidate) =>
      isDeliveryOrderReadyForPickup(candidate)
      && (candidate.delhiveryPickupLocation || defaultPickupLocation) === pickupLocation
    ).length;
    const pickup = await createDelhiveryPickupRequest(expectedPackageCount, pickupLocation, order.delhiveryPickupRequestTime);
    order.delhiveryPickupRequestStatus = "created";
    order.delhiveryPickupRequestId = pickup.pickupId;
    order.delhiveryPickupRequestDate = pickup.pickupDate;
    order.delhiveryPickupRequestTime = pickup.pickupTime;
    order.delhiveryPickupExpectedPackageCount = pickup.expectedPackageCount;
    delete order.delhiveryPickupRequestError;
  } catch (error) {
    if (pickupRequestAlreadyCoversWarehouse(error)) {
      order.delhiveryPickupRequestStatus = "covered";
      order.delhiveryPickupRequestError = "An existing Delhivery pickup already covers this warehouse.";
    } else {
      order.delhiveryPickupRequestStatus = "failed";
      order.delhiveryPickupRequestError = delhiveryPickupFailureMessage(error);
    }
  }
  await writeOrders(orders);
}

async function ensureDelhiveryShipment(orders: StoredOrder[], order: StoredOrder, force = false) {
  if (!orderNeedsDelivery(order)) return;
  if (order.status === "Delivered" || order.status === "Cancelled") return;
  const orderDate = String(order.createdAt || order.date || "").slice(0, 10);
  if (orderDate && orderDate < delhiveryAutomationStartDate) return;
  if (order.delhiveryAwb) {
    await ensureDelhiveryPickupRequest(orders, order);
    return;
  }
  if (requiresAdminShipmentWeight() && !force && !order.delhiveryWeightGrams) {
    if (order.delhiveryShipmentStatus !== "awaiting_weight") {
      order.delhiveryShipmentStatus = "awaiting_weight";
      delete order.delhiveryShipmentError;
      await writeOrders(orders);
    }
    return;
  }
  if (order.delhiveryShipmentStatus === "pending") return;
  order.delhiveryShipmentStatus = "pending";
  order.delhiveryShipmentRequestedAt = new Date().toISOString();
  await writeOrders(orders);
  try {
    const shipment = await manifestDelhiveryShipment(order);
    order.delhiveryAwb = shipment.waybill;
    order.delhiveryTrackingUrl = shipment.trackingUrl;
    order.delhiveryShipmentStatus = "created";
    order.delhiveryShipmentCreatedAt = new Date().toISOString();
    // Creating a Delhivery shipment only means the label/waybill exists. Keep
    // the order in Processing until the warehouse actually dispatches it.
    delete order.delhiveryShipmentError;
  } catch (error) {
    order.delhiveryShipmentStatus = "failed";
    order.delhiveryShipmentError = delhiveryFailureMessage(error);
  }
  await writeOrders(orders);
  await ensureDelhiveryPickupRequest(orders, order);
}

export async function reconcilePendingOrderInventory() {
  const orders = await readOrders();
  let reconciled = 0;
  let pending = 0;
  for (const order of orders) {
    if (order.paymentStatus !== "pending" || !order.inventoryReserved || order.inventoryReleased) continue;
    try {
      const updated = await checkoutRpc<StoredOrder>("expire", order.id);
      if (updated.inventoryReleased) reconciled++;
      else pending++;
    } catch { pending++; }
  }
  return { reconciled, pending };
}

export async function finalizeRazorpayPayment(payment: RazorpayPayment, receipt?: string, callback?: { key: string; hash: string }): Promise<StoredOrder | null> {
  if (!payment.id || payment.status !== "captured" || payment.captured !== true || payment.currency !== "INR") throw new Error("Payment has not been captured in INR.");
  const orders = await readOrders();
  let order = orders.find((row) => row.razorpayPaymentId === payment.id)
    || orders.find((row) => row.razorpayOrderId && row.razorpayOrderId === payment.order_id)
    || orders.find((row) => row.id === payment.notes?.fanzzy_order_id)
    || orders.find((row) => row.id === orderIdFromReceipt(receipt));
  if (!order) {
    if (isPosPayment(payment, receipt)) return null;
    throw new Error("Saved order could not be found. Payment requires reconciliation.");
  }
  if (!isPosOrder(order)) {
    if (!order.razorpayOrderId) order = await recoverCapturedOrderBinding(order, payment);
    assertCapturedPayment(payment, order);
  }
  return captureTransactionalPayment(order.id, payment, callback);
}

const customerPhoneDigits = (value: string) => String(value || "").replace(/\D/g, "").slice(-10);

export async function listCustomerOrders(identity: { id: string; phone: string }) {
  const orders = await readOrders();
  const phone = customerPhoneDigits(identity.phone);
  return orders
    .filter((order) => order.userId
      ? order.userId === identity.id
      : phone.length === 10 && customerPhoneDigits(order.userPhone || order.phone) === phone)
    .sort((left, right) => (right.createdAt || right.date).localeCompare(left.createdAt || left.date))
    .map((order) => ({
      id: order.id,
      date: order.date,
      createdAt: order.createdAt,
      status: order.status,
      paymentStatus: order.paymentStatus,
      total: order.total,
      fulfillmentMethod: order.fulfillmentMethod,
      items: order.items?.map((item) => ({ name: item.productName || item.name, quantity: item.quantity, price: item.price })),
    }));
}

export async function saveMobilePendingOrder(value: unknown, identity: { id: string; phone: string }, options: { requestKey: string; website?: boolean }) {
  const order = sanitizeMobilePendingOrder(value, identity);
  const requestHash = checkoutRequestHash(order);
  const existing = await checkoutRpc<{ order: StoredOrder; request_hash: string } | null>("lookup_request", "", identity.id, { requestKey: options.requestKey });
  if (existing) {
    if (existing.request_hash !== requestHash) throw new Error("Checkout request key was reused for different details.");
    return existing.order;
  }
  const quote = await authorizeMobileQuote(order, options.website === true, () => websitePromotionCustomerContext(identity));
  return createTransactionalOrder(order, identity.id, options.requestKey, quote, requestHash);
}

export async function websitePromotionCustomerContext(identity: { id: string; phone: string }) {
  const history = await listCustomerOrders(identity);
  const hasPurchase = history.some((order) => order.status !== "Cancelled" && (order.status === "Delivered" || order.paymentStatus === "paid" || order.paymentStatus === "cod_pending" || order.paymentStatus === "cod_collected"));
  return { customerPhone: identity.phone, historyAvailable: true, previousCustomerPhones: hasPurchase ? [identity.phone] : [] };
}

export async function confirmCashOnDeliveryOrder(orderId: string, identity?: { id: string; phone: string }) {
  if (!identity) throw new Error("Customer authentication required.");
  return checkoutRpc<StoredOrder>("cod", orderId, identity.id);
}

type OutboxJob = { id: number; order_id: string; kind: "shipment" | "vendor_sync"; token: string };
const fulfillmentEnabled = () => isLocalTestEnvironment(process.env) || process.env.FANZZY_FULFILLMENT_ENABLED === "true";

export async function processCheckoutOutbox(orderId = "", kind?: string) {
  if (!fulfillmentEnabled()) return { disabled: true, processed: 0 };
  let processed = 0;
  for (let i = 0; i < (orderId ? 1 : 10); i++) {
    const token = randomUUID();
    const job = await checkoutRpc<OutboxJob | null>("outbox_claim", orderId, "", { token, kind });
    if (!job) break;
    const orders = await readOrders();
    const order = orders.find((row) => row.id === job.order_id);
    // The durable sending transition happens before any external side effect.
    await checkoutRpc("outbox_sending", "", "", { id: job.id, token });
    try {
      if (!order || !order.inventoryAdjusted || !["paid", "cod_pending", "cod_collected"].includes(order.paymentStatus || "")) throw new Error("Order is not ready for fulfilment");
      if (job.kind === "vendor_sync") await syncVendorOrderForPaidOrder(order);
      else await ensureDelhiveryShipment(orders, order);
      if (job.kind === "shipment" && order.delhiveryShipmentStatus !== "created" && order.delhiveryShipmentStatus !== "awaiting_weight") throw new Error("Shipment outcome requires reconciliation");
      await checkoutRpc("outbox_complete", "", "", { id: job.id, token, result: { awaitingWeight: order.delhiveryShipmentStatus === "awaiting_weight", waybill: order.delhiveryAwb || null } });
      processed++;
    } catch {
      // Do not automatically repeat a request which might already have shipped
      // or created a vendor order. Operators reconcile ambiguous outcomes.
      await checkoutRpc("outbox_unknown", "", "", { id: job.id, token, result: { requiresReconciliation: true } }).catch(() => undefined);
    }
  }
  return { disabled: false, processed };
}

export async function createAdminDelhiveryShipment(orderId: string, weightGrams: number, pickupLocation: string, pickupTime: string) {
  if (!fulfillmentEnabled()) throw new Error("Fulfilment is disabled until deployment approval.");
  const normalizedWeight = Math.round(Number(weightGrams));
  if (!Number.isFinite(normalizedWeight) || normalizedWeight < 500 || normalizedWeight > 30000) throw new Error("Packed parcel weight must be between 500 and 30,000 grams.");
  const options = await loadDelhiveryAdminOptions();
  if (!options.pickupLocations.includes(pickupLocation)) throw new Error("Select the configured Delhivery pickup location.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(pickupTime)) throw new Error("Enter a valid Delhivery pickup time.");
  await checkoutRpc("prepare_shipment", orderId, "", { weight: normalizedWeight, pickupLocation, pickupTime: pickupTime + ":00" });
  await processCheckoutOutbox(orderId, "shipment");
  return (await readOrders()).find((row) => row.id === orderId)!;
}

export async function refreshDelhiveryOrderTracking(orderId: string, waybill: string) {
  const order = (await readOrders()).find((row) => row.id === orderId && row.delhiveryAwb === waybill);
  if (!order) throw new Error("Shipment does not match this order.");
  const tracking = await trackDelhiveryShipment(waybill, orderId);
  await checkoutRpc("tracking", orderId, "", { ...tracking, waybill });
  return tracking;
}

export async function reserveOrderInventory(orderId: string, identity?: { id: string; phone: string }) {
  if (!identity) throw new Error("Customer authentication required.");
  return checkoutRpc<StoredOrder>("reserve", orderId, identity.id);
}

export async function releaseReservedOrderInventory(orderId: string, identity?: { id: string; phone: string }) {
  if (!identity) throw new Error("Customer authentication required.");
  return checkoutRpc<StoredOrder>("release", orderId, identity.id);
}
