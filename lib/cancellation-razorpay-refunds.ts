import { createHash } from "node:crypto";
import type { CustomerCancellationRecord } from "./customer-cancellation";
import { assertCapturedPayment, paymentConfigurationError } from "./payment-policy";
import { razorpayRead } from "./razorpay-provider";
import {
  CheckoutError,
  patchTransactionalOrders,
  readTransactionalOrders,
} from "./transactional-checkout";
import type { RazorpayPayment, StoredOrder } from "./razorpay-payment-sync";

type RazorpayRefund = {
  id?: string;
  payment_id?: string;
  amount?: number;
  currency?: string;
  receipt?: string;
  status?: string;
  error?: { description?: string };
};

const orderIdPattern = /^#FZ-[A-Z0-9-]{6,64}$/i;
const refundIdPattern = /^rfnd_[A-Za-z0-9]+$/;

const moneyInPaise = (value: unknown) => {
  const number = typeof value === "number"
    ? value
    : Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  const amount = Math.round(number * 100);
  return Number.isSafeInteger(amount) && amount >= 100 ? amount : 0;
};

const refundReceipt = (orderId: string, recordId?: string) =>
  `fanzzy-cancel-${createHash("sha256")
    .update(`${orderId}:${recordId || "legacy"}`)
    .digest("hex")
    .slice(0, 20)}`;

const providerAuthorization = () =>
  `Basic ${Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`,
  ).toString("base64")}`;

const usableRefund = (
  value: RazorpayRefund | undefined,
  paymentId: string,
  amount: number,
  receipt: string,
): value is Required<Pick<RazorpayRefund, "id" | "payment_id" | "amount" | "currency">> & RazorpayRefund =>
  Boolean(
    value &&
      refundIdPattern.test(value.id || "") &&
      value.payment_id === paymentId &&
      value.amount === amount &&
      value.currency === "INR" &&
      value.receipt === receipt,
  );

async function existingRefund(paymentId: string, amount: number, receipt: string) {
  try {
    const response = await razorpayRead<{ items?: RazorpayRefund[] }>(
      `payments/${encodeURIComponent(paymentId)}/refunds?count=100`,
    );
    return response.items?.find((refund) => usableRefund(refund, paymentId, amount, receipt));
  } catch {
    // A failed lookup must not hide the original provider error from a new
    // request. The create call below remains the source of truth.
    return undefined;
  }
}

async function createRefund(paymentId: string, amount: number, receipt: string, orderId: string, recordId?: string) {
  const known = await existingRefund(paymentId, amount, receipt);
  if (known) return known;

  let response: Response;
  let result: RazorpayRefund;
  try {
    response = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`,
      {
        method: "POST",
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "content-type": "application/json",
          authorization: providerAuthorization(),
        },
        body: JSON.stringify({
          amount,
          receipt,
          notes: {
            fanzzy_order_id: orderId,
            fanzzy_cancellation_id: recordId || "legacy",
          },
        }),
      },
    );
    result = await response.json() as RazorpayRefund;
  } catch {
    throw new CheckoutError("Razorpay could not be reached. No refund was recorded.", 503);
  }

  if (!response.ok || !usableRefund(result, paymentId, amount, receipt)) {
    // A retry after a provider success but before the local order update can
    // return a duplicate-receipt error. Recover that exact refund safely.
    const duplicate = await existingRefund(paymentId, amount, receipt);
    if (duplicate) return duplicate;
    const message = String(result.error?.description || "Razorpay did not accept this refund.")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    throw new CheckoutError(message || "Razorpay did not accept this refund.", 502);
  }

  return result;
}

const pendingRecordFor = (order: StoredOrder, recordId: string) => {
  const record = order.cancellationRecords?.find((candidate) => candidate.id === recordId);
  if (!record || record.refundStatus !== "Pending" || record.refundReference) {
    throw new CheckoutError("This item cancellation refund is no longer pending.");
  }
  return record;
};

const refundAmountFor = (order: StoredOrder, record?: CustomerCancellationRecord) => {
  const amount = record ? moneyInPaise(record.refundAmount) : moneyInPaise(order.total);
  if (!amount) throw new CheckoutError("The saved refund amount is invalid.");
  const alreadyRefunded = (order.cancellationRecords || [])
    .filter((candidate) => candidate.id !== record?.id && candidate.refundStatus === "Completed")
    .reduce((total, candidate) => total + moneyInPaise(candidate.refundAmount), 0);
  const capturedAmount = moneyInPaise(order.total);
  if (!capturedAmount || alreadyRefunded + amount > capturedAmount) {
    throw new CheckoutError("The saved cancellation amount exceeds the original payment.");
  }
  return amount;
};

/**
 * Sends a refund for a saved customer cancellation. All amount, payment and
 * eligibility checks use the transactional order data, never browser input.
 */
export async function issueCancellationRazorpayRefund(orderId: string, recordId?: string) {
  const configurationError = paymentConfigurationError(process.env);
  if (configurationError) throw new CheckoutError(configurationError, 503);
  if (!orderIdPattern.test(orderId)) throw new CheckoutError("A valid order ID is required.", 400);
  if (recordId !== undefined && (!recordId || recordId.length > 120)) {
    throw new CheckoutError("A valid cancellation record is required.", 400);
  }

  const orders = await readTransactionalOrders();
  const order = orders.find((candidate) => candidate.id === orderId);
  if (!order) throw new CheckoutError("Cancelled order could not be found.", 404);
  if (order.paymentMethod !== "online" || order.paymentStatus !== "paid" || !order.razorpayPaymentId) {
    throw new CheckoutError("Only captured online payments can be refunded through Razorpay.");
  }

  const record = recordId ? pendingRecordFor(order, recordId) : undefined;
  if (!recordId && (order.refundStatus === "Completed" || order.refundStatus === "Refunded" || order.refundReference)) {
    throw new CheckoutError("This cancellation refund has already been recorded.");
  }
  const amount = refundAmountFor(order, record);
  const paymentId = order.razorpayPaymentId.trim();
  if (/^pay_local_/i.test(paymentId)) {
    throw new CheckoutError(
      "This local sample cancellation has no Razorpay Test payment. Choose a captured Test Mode order instead.",
    );
  }
  const payment = await razorpayRead<RazorpayPayment>(`payments/${encodeURIComponent(paymentId)}`);
  assertCapturedPayment(payment, order);

  const receipt = refundReceipt(order.id, record?.id);
  const refund = await createRefund(paymentId, amount, receipt, order.id, record?.id);
  const refundReference = refund.id!;

  if (record) {
    order.cancellationRecords = (order.cancellationRecords || []).map((candidate) =>
      candidate.id === record.id
        ? { ...candidate, refundStatus: "Completed" as const, refundReference }
        : candidate,
    );
    const hasPendingCancellationRefund = order.cancellationRecords.some(
      (candidate) => candidate.refundStatus === "Pending",
    );
    const fullOrderRefunded = !hasPendingCancellationRefund && order.status === "Cancelled";
    order.refundStatus = hasPendingCancellationRefund
      ? "Pending"
      : fullOrderRefunded
        ? "Refunded"
        : "Completed";
    if (fullOrderRefunded) order.returnStatus = "Refunded";
  } else {
    order.refundStatus = "Refunded";
    if (order.status === "Cancelled") order.returnStatus = "Refunded";
    order.refundReference = refundReference;
  }
  await patchTransactionalOrders(orders);
  return {
    order,
    refundReference,
    providerStatus: refund.status || "processed",
  };
}
