import { createHash } from "node:crypto";
// Node's test runner imports this TypeScript file directly.
// @ts-expect-error TypeScript disallows .ts import paths without allowImportingTsExtensions.
import { adjustOrderInventory } from "./inventory-adjustment.ts";
// @ts-expect-error TypeScript disallows .ts import paths without allowImportingTsExtensions.
import { onlineRefundChoices, selectOnlineRefundItems, type OnlineRefundSelection } from "./online-refund-selection.ts";
// @ts-expect-error TypeScript disallows .ts import paths without allowImportingTsExtensions.
import { getOnlineReturnEligibility } from "./return-policy.ts";
// @ts-expect-error TypeScript disallows .ts import paths without allowImportingTsExtensions.
import { type WalkInOrder, walkInReturnsConfigFromEnv } from "./walk-in-returns.ts";
import type { RazorpayPayment } from "./razorpay-payment-sync";

type StoreConfig = { supabaseUrl: string; supabaseKey: string };

export type OnlineRefundRequest = {
  id: string;
  orderId: string;
  userId: string;
  customerName: string;
  phone: string;
  amount: string;
  status: "Requested" | "Approved" | "Rejected" | "Refunded";
  reason: string;
  createdAt: string;
  updatedAt?: string;
  requestedItemIds?: string[];
  requestedItems?: Array<{ orderItemId: string; quantity: number }>;
  selection?: OnlineRefundSelection;
  selections?: OnlineRefundSelection[];
  inventoryRestockedAt?: string;
  refundReference?: string;
  refundProviderStatus?: string;
};

export type OnlineRefundOrder = WalkInOrder & {
  posSale?: boolean;
  /** Local-only fixture marker. It never represents a provider payment. */
  localTestOrder?: boolean;
  shippingTotal?: number;
  codCharge?: number;
  returnStatus?: string;
  refundStatus?: string;
  refundReference?: string;
  paymentMethod?: "online" | "cod";
  paymentStatus?: "pending" | "paid" | "cod_pending" | "cod_collected";
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
};

const settingsHeaders = (config: StoreConfig) => ({
  apikey: config.supabaseKey,
  Authorization: `Bearer ${config.supabaseKey}`,
  "Content-Type": "application/json",
});

const orderSettingKey = "orders";
// This is the physical store-setting key. Client catalog helpers accept the
// camel-cased alias `refundRequests`, but server-side refund processing talks
// to the database directly.
const refundRequestSettingKey = "refund_requests";

const normalizeId = (value: unknown) => String(value ?? "").trim();
const normalizeComparable = (value: unknown) => normalizeId(value).toLowerCase();
const formatCurrency = (amount: number) => `₹${Math.max(0, Math.round(amount)).toLocaleString("en-IN")}`;

async function readJsonSetting<T>(config: StoreConfig, key: string, fallback: T): Promise<T> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/store_settings?key=eq.${encodeURIComponent(key)}&select=value`, {
    headers: settingsHeaders(config),
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
    headers: { ...settingsHeaders(config), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ key, value: JSON.stringify(value), updated_at: new Date().toISOString() }]),
  });
  if (!response.ok) throw new Error(`Could not update ${key}.`);
}

const requestedItemsFor = (request: OnlineRefundRequest, order: OnlineRefundOrder) => {
  const choices = onlineRefundChoices(order);
  const requestedItems = Array.isArray(request.requestedItems) && request.requestedItems.length
    ? request.requestedItems
    : Array.isArray(request.requestedItemIds) && request.requestedItemIds.length
      ? request.requestedItemIds.map((orderItemId) => ({ orderItemId, quantity: 1 }))
      // Requests created before item selection was added represent a return of
      // the full order, which is also what the previous admin screen showed.
      : choices.map((choice) => ({ orderItemId: choice.id, quantity: choice.quantity }));

  return selectOnlineRefundItems(order, requestedItems.map((item) => ({
    orderItemId: normalizeId(item.orderItemId),
    quantity: Math.floor(Number(item.quantity)),
  })));
};

type RefundPreview = {
  request: OnlineRefundRequest;
  order: OnlineRefundOrder;
  selections: OnlineRefundSelection[];
  amount: number;
};

const previewOnlineRefund = async (
  requestId: string,
  config: StoreConfig,
): Promise<RefundPreview> => {
  const normalizedRequestId = normalizeId(requestId);
  if (!normalizedRequestId || normalizedRequestId.length > 120) {
    throw new Error("Enter a valid refund request ID.");
  }
  const [orders, requests] = await Promise.all([
    readJsonSetting<OnlineRefundOrder[]>(config, orderSettingKey, []),
    readJsonSetting<OnlineRefundRequest[]>(config, refundRequestSettingKey, []),
  ]);
  const request = requests.find((candidate) =>
    normalizeComparable(candidate.id) === normalizeComparable(normalizedRequestId),
  );
  if (!request) throw new Error("Refund request could not be found.");
  const order = orders.find((candidate) =>
    normalizeComparable(candidate.id) === normalizeComparable(request.orderId),
  );
  if (!order || order.posSale) throw new Error("The online order could not be found.");
  if (request.status === "Refunded") {
    throw new Error("This refund request has already been completed.");
  }
  if (request.status !== "Requested" && request.status !== "Approved") {
    throw new Error("Only a pending refund request can be completed.");
  }
  const eligibility = getOnlineReturnEligibility(order, new Date(request.createdAt));
  if (!eligibility.eligible) throw new Error(eligibility.message);
  const selections = requestedItemsFor(request, order);
  const amount = Math.round(selections.reduce((total, selection) => total + selection.refundAmount, 0) * 100);
  if (!Number.isSafeInteger(amount) || amount < 100) {
    throw new Error("The saved refund amount is invalid.");
  }
  return { request, order, selections, amount };
};

type RazorpayRefund = {
  id?: string;
  payment_id?: string;
  amount?: number;
  currency?: string;
  receipt?: string;
  status?: string;
  error?: { description?: string };
};

const razorpayAuthorization = () =>
  `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64")}`;
const refundIdPattern = /^rfnd_[A-Za-z0-9]+$/;
const refundReceiptFor = (requestId: string) =>
  `fanzzy-return-${createHash("sha256").update(requestId).digest("hex").slice(0, 20)}`;
const validProviderRefund = (value: RazorpayRefund | undefined, paymentId: string, amount: number, receipt: string) =>
  Boolean(
    value &&
      refundIdPattern.test(value.id || "") &&
      value.payment_id === paymentId &&
      value.amount === amount &&
      value.currency === "INR" &&
      value.receipt === receipt,
  );

async function readRazorpay<T>(path: string) {
  let response: Response;
  try {
    response = await fetch(`https://api.razorpay.com/v1/${path}`, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: { authorization: razorpayAuthorization() },
    });
  } catch {
    throw new Error("Razorpay could not be reached. The refund is awaiting reconciliation.");
  }
  if (!response.ok) {
    throw new Error("Razorpay could not verify the original payment. The refund was not issued.");
  }
  return response.json() as Promise<T>;
}

async function findExistingRazorpayRefund(paymentId: string, amount: number, receipt: string) {
  try {
    const result = await readRazorpay<{ items?: RazorpayRefund[] }>(
      `payments/${encodeURIComponent(paymentId)}/refunds?count=100`,
    );
    return result.items?.find((refund) => validProviderRefund(refund, paymentId, amount, receipt));
  } catch {
    return undefined;
  }
}

async function createRazorpayRefund(
  paymentId: string,
  amount: number,
  receipt: string,
  notes: Record<string, string>,
) {
  const known = await findExistingRazorpayRefund(paymentId, amount, receipt);
  if (known) return known;
  let response: Response;
  let result: RazorpayRefund;
  try {
    response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
      method: "POST",
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/json", authorization: razorpayAuthorization() },
      body: JSON.stringify({ amount, receipt, notes }),
    });
    result = await response.json() as RazorpayRefund;
  } catch {
    throw new Error("Razorpay could not be reached. No refund was recorded.");
  }
  if (!response.ok || !validProviderRefund(result, paymentId, amount, receipt)) {
    const duplicate = await findExistingRazorpayRefund(paymentId, amount, receipt);
    if (duplicate) return duplicate;
    const message = String(result.error?.description || "Razorpay did not accept this refund.")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    throw new Error(message || "Razorpay did not accept this refund.");
  }
  return result;
}

/**
 * Records an online refund and restores inventory for exactly the quantities
 * the customer requested. This belongs on the server so stock cannot depend
 * on stale browser state or a manual page refresh.
 */
export async function completeOnlineRefund(
  requestId: string,
  config: StoreConfig = walkInReturnsConfigFromEnv(),
  providerRefund?: { reference: string; status?: string },
  options: { skipOrderWrite?: boolean } = {},
) {
  const normalizedRequestId = normalizeId(requestId);
  if (!normalizedRequestId || normalizedRequestId.length > 120) {
    throw new Error("Enter a valid refund request ID.");
  }

  const [orders, requests] = await Promise.all([
    readJsonSetting<OnlineRefundOrder[]>(config, orderSettingKey, []),
    readJsonSetting<OnlineRefundRequest[]>(config, refundRequestSettingKey, []),
  ]);
  const requestIndex = requests.findIndex((request) => normalizeComparable(request.id) === normalizeComparable(normalizedRequestId));
  if (requestIndex < 0) throw new Error("Refund request could not be found.");

  const request = requests[requestIndex];
  const orderIndex = orders.findIndex((order) => normalizeComparable(order.id) === normalizeComparable(request.orderId));
  if (orderIndex < 0 || orders[orderIndex].posSale) throw new Error("The online order could not be found.");
  const order = orders[orderIndex];

  // Retrying a completed browser request must not add inventory again.
  if (request.status === "Refunded") {
    return { request, order, requests, orders, inventoryRestored: false };
  }
  if (request.status !== "Requested" && request.status !== "Approved") {
    throw new Error("Only a pending refund request can be completed.");
  }

  const eligibility = getOnlineReturnEligibility(order, new Date(request.createdAt));
  if (!eligibility.eligible) throw new Error(eligibility.message);

  const selections = requestedItemsFor(request, order);
  const choices = onlineRefundChoices(order);
  const inventoryOrder = {
    items: selections.map((selection) => {
      const choice = choices.find((candidate) => candidate.id === selection.orderItemId);
      if (!choice) throw new Error("A requested product could not be found in the original order.");
      return {
        name: choice.productName,
        quantity: selection.quantity,
        price: `₹${choice.unitPrice}`,
        productId: choice.productId,
        variantName: choice.variantName || undefined,
        size: choice.size || undefined,
      };
    }),
  };

  const adjustment = await adjustOrderInventory(inventoryOrder, config, "release", false);
  if (!adjustment.complete) {
    throw new Error(adjustment.reason || "Could not restore stock for the refunded products.");
  }

  const completedAt = new Date().toISOString();
  const refundAmount = selections.reduce((total, selection) => total + selection.refundAmount, 0);
  const completedRequest: OnlineRefundRequest = {
    ...request,
    status: "Refunded",
    amount: formatCurrency(refundAmount),
    selection: selections.length === 1 ? selections[0] : undefined,
    selections,
    updatedAt: completedAt,
    inventoryRestockedAt: completedAt,
    refundReference: providerRefund?.reference || request.refundReference,
    refundProviderStatus: providerRefund?.status || request.refundProviderStatus,
  };
  const updatedRequests = requests.map((item, index) => index === requestIndex ? completedRequest : item);
  const completedOrder: OnlineRefundOrder = {
    ...order,
    returnStatus: "Refunded",
    refundStatus: "Refunded",
    refundReference: providerRefund?.reference || order.refundReference,
  };
  const updatedOrders = orders.map((item, index) => index === orderIndex ? completedOrder : item);

  await writeJsonSetting(config, refundRequestSettingKey, updatedRequests);
  // Transactional order storage rejects direct REST writes. The provider
  // refund path records this same completed order through the checkout RPC.
  // Keep the default REST write for the stock-only unit tests and legacy
  // non-transactional stores.
  if (!options.skipOrderWrite) {
    await writeJsonSetting(config, orderSettingKey, updatedOrders);
  }

  return {
    request: completedRequest,
    order: completedOrder,
    requests: updatedRequests,
    orders: updatedOrders,
    inventoryRestored: true,
  };
}

async function recordTransactionalRefund(
  orderId: string,
  refundReference: string,
) {
  // @ts-expect-error The node test runner imports this TypeScript file directly.
  const { patchTransactionalOrders, readTransactionalOrders } = await import("./transactional-checkout.ts");
  const transactionalOrders = await readTransactionalOrders();
  const transactionalOrder = transactionalOrders.find((order) =>
    normalizeComparable(order.id) === normalizeComparable(orderId),
  );
  if (!transactionalOrder) throw new Error("The saved paid order could not be found.");
  transactionalOrder.returnStatus = "Refunded";
  transactionalOrder.refundStatus = "Refunded";
  transactionalOrder.refundReference = refundReference;
  await patchTransactionalOrders(transactionalOrders);
}

/** Issues the selected customer return refund in Razorpay, then restores stock. */
export async function issueOnlineRazorpayRefund(
  requestId: string,
  config: StoreConfig = walkInReturnsConfigFromEnv(),
) {
  const preview = await previewOnlineRefund(requestId, config);
  const localTestSimulation =
    process.env.FANZZY_ENV === "local-test" &&
    preview.order.localTestOrder === true &&
    preview.order.paymentMethod === "online" &&
    preview.order.paymentStatus === "paid" &&
    !preview.order.razorpayPaymentId;

  // A local fixture has no Razorpay payment by design. Simulate only the app
  // outcome so returns, stock restoration and customer statuses can be tested
  // without creating a misleading provider payment or contacting Razorpay.
  if (localTestSimulation) {
    const refundReference = `local_test_refund_${createHash("sha256").update(preview.request.id).digest("hex").slice(0, 16)}`;
    const completed = await completeOnlineRefund(requestId, config, {
      reference: refundReference,
      status: "local_test_simulated",
    }, { skipOrderWrite: true });
    await recordTransactionalRefund(completed.order.id, refundReference);
    return {
      ...completed,
      refundReference,
      providerStatus: "local_test_simulated",
      localTestSimulation: true,
    };
  }

  // These modules are needed only when an operator actually issues money
  // through Razorpay. Keeping them lazy also lets stock-only tests run without
  // bringing server checkout code into the browserless test environment.
  // @ts-expect-error The node test runner imports this TypeScript file directly.
  const { assertCapturedPayment, paymentConfigurationError } = await import("./payment-policy.ts");
  const configurationError = paymentConfigurationError(process.env);
  if (configurationError) throw new Error(configurationError);
  // @ts-expect-error The node test runner imports this TypeScript file directly.
  const { readTransactionalOrders } = await import("./transactional-checkout.ts");
  const transactionalOrders = await readTransactionalOrders();
  const transactionalOrder = transactionalOrders.find((order) =>
    normalizeComparable(order.id) === normalizeComparable(preview.order.id),
  );
  if (!transactionalOrder) throw new Error("The saved paid order could not be found.");
  if (
    transactionalOrder.paymentMethod !== "online" ||
    transactionalOrder.paymentStatus !== "paid" ||
    !transactionalOrder.razorpayPaymentId
  ) {
    throw new Error("Only captured online payments can be refunded through Razorpay.");
  }
  const paymentId = transactionalOrder.razorpayPaymentId.trim();
  if (/^pay_local_/i.test(paymentId)) {
    throw new Error("This local sample order has no Razorpay Test payment. Choose a captured Test Mode order instead.");
  }
  const payment = await readRazorpay<RazorpayPayment>(`payments/${encodeURIComponent(paymentId)}`);
  assertCapturedPayment(payment, transactionalOrder);
  const refundAmount = preview.amount;
  const capturedAmount = Math.round(Number(transactionalOrder.total.replace(/[^0-9.]/g, "")) * 100);
  if (!Number.isSafeInteger(capturedAmount) || refundAmount > capturedAmount) {
    throw new Error("The saved return amount exceeds the original payment.");
  }
  const receipt = refundReceiptFor(preview.request.id);
  const refund = await createRazorpayRefund(paymentId, refundAmount, receipt, {
    fanzzy_order_id: transactionalOrder.id,
    fanzzy_refund_request_id: preview.request.id,
  });
  const refundReference = refund.id!;
  const completed = await completeOnlineRefund(requestId, config, {
    reference: refundReference,
    status: refund.status,
  }, { skipOrderWrite: true });
  await recordTransactionalRefund(transactionalOrder.id, refundReference);
  return { ...completed, refundReference, providerStatus: refund.status || "processed" };
}
