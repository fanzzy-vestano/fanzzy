import { isAdminSessionValid } from "../../../../lib/admin-auth";
import { paymentConfigurationError } from "../../../../lib/payment-policy";
import { razorpayRead } from "../../../../lib/razorpay-provider";

const saleIdPattern = /^#FZ-POS-[A-Z0-9-]{6,32}$/i;
const providerOrderIdPattern = /^order_[A-Za-z0-9]+$/;
const checkoutSource = "pos_checkout";
const validAmount = (amount: unknown): amount is number =>
  typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 100 && amount <= 1_000_000_000;

type ProviderOrder = {
  id?: string;
  amount?: number;
  currency?: string;
  receipt?: string;
  status?: string;
  notes?: { fanzzy_order_id?: string; fanzzy_payment_source?: string };
  error?: { description?: string };
};

type ProviderPayment = {
  id?: string;
  order_id?: string;
  status?: string;
  captured?: boolean;
  method?: string;
  currency?: string;
  amount?: number;
};

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const checkAccess = (request: Request) => {
  if (!isAdminSessionValid(request)) return json({ error: "Admin authentication required." }, 401);
  const error = paymentConfigurationError(process.env);
  return error ? json({ error }, 503) : null;
};

export async function POST(request: Request) {
  const accessError = checkAccess(request);
  if (accessError) return accessError;

  const body = await request.json().catch(() => null) as { saleId?: unknown; amount?: unknown } | null;
  const saleId = body?.saleId;
  const amount = body?.amount;
  if (typeof saleId !== "string" || !saleIdPattern.test(saleId) || !validAmount(amount)) {
    return json({ error: "A valid POS sale reference and bill amount are required." }, 400);
  }

  const receipt = saleId.slice(1);
  const keyId = process.env.RAZORPAY_KEY_ID;
  const authorization = `Basic ${Buffer.from(`${keyId}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64")}`;
  try {
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({
        amount,
        currency: "INR",
        receipt,
        partial_payment: false,
        notes: { fanzzy_order_id: saleId, fanzzy_payment_source: checkoutSource },
      }),
    });
    const order = await response.json() as ProviderOrder;
    if (!response.ok) {
      return json({ error: order.error?.description || "Razorpay could not prepare the POS payment." }, 502);
    }
    if (!order.id || !providerOrderIdPattern.test(order.id) || order.amount !== amount
      || order.currency !== "INR" || order.receipt !== receipt) {
      return json({ error: "The Razorpay order did not match this POS bill." }, 502);
    }
    return json({ id: order.id, amount, currency: order.currency, keyId, saleId });
  } catch {
    return json({ error: "Razorpay Checkout could not prepare this bill. Try again." }, 502);
  }
}

export async function GET(request: Request) {
  const accessError = checkAccess(request);
  if (accessError) return accessError;

  const params = new URL(request.url).searchParams;
  const saleId = params.get("saleId") || "";
  const id = params.get("id") || "";
  if (!saleIdPattern.test(saleId) || !providerOrderIdPattern.test(id)) {
    return json({ error: "A valid POS sale and Razorpay order are required." }, 400);
  }

  try {
    const order = await razorpayRead<ProviderOrder>(`orders/${id}`);
    if (order.id !== id || order.receipt !== saleId.slice(1) || order.currency !== "INR"
      || !validAmount(order.amount) || order.notes?.fanzzy_order_id !== saleId
      || order.notes.fanzzy_payment_source !== checkoutSource) {
      return json({ error: "The Razorpay order does not belong to this POS bill." }, 409);
    }

    const { items } = await razorpayRead<{ items: ProviderPayment[] }>(`orders/${id}/payments`);
    const payments = items.filter((payment) => payment.order_id === id);
    const captured = payments.find((payment) => payment.status === "captured");
    if (captured) {
      if (!captured.id || captured.captured !== true || captured.method !== "upi"
        || captured.currency !== "INR" || captured.amount !== order.amount) {
        return json({ status: "review", error: "Razorpay reported a payment that does not match this UPI bill. Check it before taking another payment." });
      }
      return json({ status: "paid", paymentId: captured.id, amount: captured.amount });
    }
    const processing = order.status === "paid" || payments.some((payment) =>
      payment.status === "authorized" || payment.status === "created");
    return json({ status: processing ? "pending" : "waiting" });
  } catch {
    return json({ error: "Razorpay could not confirm this payment yet. Check its status again." }, 502);
  }
}
