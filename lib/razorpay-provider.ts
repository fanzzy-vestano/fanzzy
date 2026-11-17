import { CheckoutError, checkoutRpc, claimPaymentAttempt, bindPaymentAttempt, markPaymentAttempt } from "./transactional-checkout";
import type { PaymentAttempt } from "./transactional-checkout";
import type { StoredOrder, RazorpayPayment } from "./razorpay-payment-sync";

type ProviderOrder = { id: string; amount: number; currency: string; receipt: string; notes?: Record<string, string>; status?: string };

export async function razorpayRead<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
    cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64")}` },
  });
  if (!response.ok) throw new CheckoutError("Razorpay status could not be confirmed. The order is awaiting reconciliation.", 503);
  return response.json() as Promise<T>;
}

export async function createOrReadRazorpayOrder(orderId: string, actor: string, requestedAmount?: unknown) {
  if (requestedAmount !== undefined) {
    const orders = await checkoutRpc<StoredOrder[]>("list");
    const order = orders.find((row) => row.id === orderId && row.userId === actor);
    const amount = order ? Math.round(Number(order.total.replace(/[^0-9.]/g, "")) * 100) : NaN;
    if (!order || Number(requestedAmount) !== amount) throw new CheckoutError("Checkout total has changed.");
  }
  const claimed = await claimPaymentAttempt(orderId, actor);
  const attempt = claimed.attempt;
  const matches = (order: ProviderOrder) => order.amount === attempt.amount && order.currency === "INR" && order.receipt === attempt.receipt;
  if (!claimed.claimed) {
    if (attempt.state !== "bound" || !attempt.provider_order_id) throw new CheckoutError("An earlier payment attempt requires reconciliation. Do not start another payment.");
    const order = await razorpayRead<ProviderOrder>(`orders/${encodeURIComponent(attempt.provider_order_id)}`);
    if (!matches(order)) throw new CheckoutError("Saved Razorpay order configuration does not match.");
    return { id: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID };
  }
  let definitiveRejection = false;
  try {
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST", cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64")}` },
      body: JSON.stringify({ amount: attempt.amount, currency: "INR", receipt: attempt.receipt, notes: { fanzzy_order_id: orderId, fanzzy_attempt: attempt.token } }),
    });
    definitiveRejection = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status);
    const order = await response.json() as ProviderOrder;
    if (!response.ok || !order.id || !matches(order)) throw new Error("Provider creation did not complete");
    await bindPaymentAttempt(orderId, attempt.token, order.id);
    return { id: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID };
  } catch {
    await markPaymentAttempt(orderId, attempt.token, definitiveRejection).catch(() => undefined);
    throw new CheckoutError(definitiveRejection ? "Razorpay rejected this payment attempt. No payment was started." : "Payment attempt outcome is uncertain. Check the existing order before retrying.", 503);
  }
}

export async function recoverCapturedOrderBinding(order: StoredOrder, payment: RazorpayPayment) {
  if (!payment.order_id) throw new CheckoutError("Provider order is missing.");
  const attempt = await checkoutRpc<PaymentAttempt | null>("attempt", order.id);
  if (!attempt || !["creating", "ambiguous", "bound"].includes(attempt.state)) throw new CheckoutError("Saved payment attempt requires manual reconciliation.");
  const proof = await razorpayRead<ProviderOrder>(`orders/${encodeURIComponent(payment.order_id)}`);
  if (proof.id !== payment.order_id || proof.currency !== "INR" || proof.amount !== attempt.amount || proof.receipt !== attempt.receipt || proof.notes?.fanzzy_order_id !== order.id || proof.notes?.fanzzy_attempt !== attempt.token) throw new CheckoutError("Provider order proof does not match the saved payment attempt.");
  return bindPaymentAttempt(order.id, attempt.token, proof.id);
}

export async function reconcileRazorpayAttempts() {
  const orders = await checkoutRpc<StoredOrder[]>("list");
  let captured = 0; let pending = 0;
  for (const order of orders) {
    if (order.paymentStatus !== "pending" || !order.inventoryReserved || order.inventoryReleased) continue;
    const attempt = await checkoutRpc<PaymentAttempt | null>("attempt", order.id);
    let providerId = attempt?.provider_order_id || order.razorpayOrderId;
    if (!providerId && attempt && ["creating", "ambiguous"].includes(attempt.state)) {
      const result = await razorpayRead<{ items?: ProviderOrder[] }>(`orders?receipt=${encodeURIComponent(attempt.receipt)}&count=100`);
      const matches = result.items?.filter((row) => row.receipt === attempt.receipt && row.amount === attempt.amount && row.currency === "INR" && row.notes?.fanzzy_order_id === order.id && row.notes?.fanzzy_attempt === attempt.token) || [];
      if (matches.length === 1) { await bindPaymentAttempt(order.id, attempt.token, matches[0].id); providerId = matches[0].id; }
    }
    if (!providerId) { pending++; continue; }
    const result = await razorpayRead<{ items?: RazorpayPayment[] }>(`orders/${encodeURIComponent(providerId)}/payments`);
    for (const payment of result.items || []) {
      if (payment.status !== "captured" || payment.captured !== true || payment.currency !== "INR") continue;
      const { finalizeRazorpayPayment } = await import("./razorpay-payment-sync");
      await finalizeRazorpayPayment(payment); captured++;
    }
  }
  return { captured, pending };
}
