const saleIdPattern = /^#FZ-POS-[A-Z0-9-]{6,32}$/i;
const providerOrderIdPattern = /^order_[A-Za-z0-9]+$/;
const checkoutSource = "pos_checkout";
const validAmount = (amount: unknown): amount is number =>
  typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 100 && amount <= 1_000_000_000;

type RazorpayCredentials = { keyId: string; keySecret: string };

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

export const posCheckoutResponse = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

function callRazorpay(path: string, credentials: RazorpayCredentials, body?: Record<string, unknown>) {
  return fetch(`https://api.razorpay.com/v1/${path}`, {
    ...(body && { method: "POST", body: JSON.stringify(body) }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      authorization: `Basic ${btoa(`${credentials.keyId}:${credentials.keySecret}`)}`,
      ...(body && { "content-type": "application/json" }),
    },
  });
}

async function readRazorpay<Data>(path: string, credentials: RazorpayCredentials): Promise<Data> {
  const response = await callRazorpay(path, credentials);
  if (!response.ok) throw new Error("Razorpay could not return the payment status.");
  return response.json();
}

export async function createPosCheckout(request: Request, credentials: RazorpayCredentials) {
  const body = await request.json().catch(() => null) as { saleId?: unknown; amount?: unknown } | null;
  const saleId = body?.saleId;
  const amount = body?.amount;
  if (typeof saleId !== "string" || !saleIdPattern.test(saleId) || !validAmount(amount)) {
    return posCheckoutResponse({ error: "A valid POS sale reference and bill amount are required." }, 400);
  }

  const receipt = saleId.slice(1);
  try {
    const response = await callRazorpay("orders", credentials, {
      amount,
      currency: "INR",
      receipt,
      partial_payment: false,
      notes: { fanzzy_order_id: saleId, fanzzy_payment_source: checkoutSource },
    });
    const order = await response.json() as ProviderOrder;
    if (!response.ok) {
      return posCheckoutResponse({ error: order.error?.description || "Razorpay could not prepare the POS payment." }, 502);
    }
    if (!order.id || !providerOrderIdPattern.test(order.id) || order.amount !== amount
      || order.currency !== "INR" || order.receipt !== receipt) {
      return posCheckoutResponse({ error: "The Razorpay order did not match this POS bill." }, 502);
    }
    return posCheckoutResponse({ id: order.id, amount, currency: order.currency, keyId: credentials.keyId, saleId });
  } catch {
    return posCheckoutResponse({ error: "Razorpay Checkout could not prepare this bill. Try again." }, 502);
  }
}

export async function readPosCheckout(request: Request, credentials: RazorpayCredentials) {
  const params = new URL(request.url).searchParams;
  const saleId = params.get("saleId") || "";
  const id = params.get("id") || "";
  if (!saleIdPattern.test(saleId) || !providerOrderIdPattern.test(id)) {
    return posCheckoutResponse({ error: "A valid POS sale and Razorpay order are required." }, 400);
  }

  try {
    const order = await readRazorpay<ProviderOrder>(`orders/${id}`, credentials);
    if (order.id !== id || order.receipt !== saleId.slice(1) || order.currency !== "INR"
      || !validAmount(order.amount) || order.notes?.fanzzy_order_id !== saleId
      || order.notes.fanzzy_payment_source !== checkoutSource) {
      return posCheckoutResponse({ error: "The Razorpay order does not belong to this POS bill." }, 409);
    }

    const { items } = await readRazorpay<{ items: ProviderPayment[] }>(`orders/${id}/payments`, credentials);
    const payments = items.filter((payment) => payment.order_id === id);
    const captured = payments.find((payment) => payment.status === "captured");
    if (captured) {
      if (!captured.id || captured.captured !== true || captured.method !== "upi"
        || captured.currency !== "INR" || captured.amount !== order.amount) {
        return posCheckoutResponse({ status: "review", error: "Razorpay reported a payment that does not match this UPI bill. Check it before taking another payment." });
      }
      return posCheckoutResponse({ status: "paid", paymentId: captured.id, amount: captured.amount });
    }
    const processing = order.status === "paid" || payments.some((payment) =>
      payment.status === "authorized" || payment.status === "created");
    return posCheckoutResponse({ status: processing ? "pending" : "waiting" });
  } catch {
    return posCheckoutResponse({ error: "Razorpay could not confirm this payment yet. Check its status again." }, 502);
  }
}
