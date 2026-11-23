import { adminApiFetch } from "./site-api-client";
import { supabase } from "./supabase/client";

export type PosCheckoutOrder = {
  id: string;
  saleId: string;
  keyId: string;
  amount: number;
  currency: "INR";
};

type PosCheckoutStatus =
  | { status: "waiting" | "pending" }
  | { status: "paid"; paymentId: string; amount: number }
  | { status: "review"; error: string };

type CheckoutOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: "INR";
  name: string;
  description: string;
  prefill: { name: string; contact?: string };
  config: {
    display: {
      blocks: { posupi: { name: string; instruments: { method: "upi" }[] } };
      sequence: string[];
      preferences: { show_default_blocks: false };
    };
  };
  handler: () => void;
  modal: { ondismiss: () => void };
};

type CheckoutConstructor = new (options: CheckoutOptions) => { open: () => void; close: () => void };
let checkoutScript: Promise<CheckoutConstructor> | undefined;

function loadCheckout(): Promise<CheckoutConstructor> {
  const browser = window as Window & { Razorpay?: CheckoutConstructor };
  if (browser.Razorpay) return Promise.resolve(browser.Razorpay);
  checkoutScript ??= new Promise<CheckoutConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    const fail = (message: string) => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error(message));
    };
    const timeout = window.setTimeout(() => fail("Razorpay Checkout took too long to load. Try again."), 15_000);
    script.onload = () => {
      window.clearTimeout(timeout);
      if (browser.Razorpay) resolve(browser.Razorpay);
      else fail("Razorpay Checkout did not load. Try again.");
    };
    script.onerror = () => fail("Razorpay Checkout could not load. Try again.");
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    checkoutScript = undefined;
    throw error;
  });
  return checkoutScript;
}

type PosCheckoutRequest = {
  method: "GET" | "POST";
  signal: AbortSignal;
  body?: { amount: number; saleId: string };
};

async function requestPosCheckout<Payload extends { error?: string }>(
  query: string,
  options: PosCheckoutRequest,
): Promise<{ ok: boolean; payload: Partial<Payload> }> {
  // Vite injects a boolean, while a Next.js environment variable is a string.
  const staticBuild: unknown = process.env.NEXT_PUBLIC_STATIC_BUILD;
  if (staticBuild === true || staticBuild === "true") {
    if (!supabase) throw new Error("POS payment service is unavailable.");
    const { data, error, response } = await supabase.functions.invoke<Payload>(`pos-checkout${query}`, options);
    const payload = data ?? (response ? await response.json().catch(() => ({})) as Partial<Payload> : {});
    return { ok: !error, payload };
  } else {
    const response = await adminApiFetch(`/admin/pos-checkout${query}`, {
      method: options.method,
      signal: options.signal,
      credentials: "include",
      cache: "no-store",
      ...(options.body && {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(options.body),
      }),
    });
    const payload = await response.json().catch(() => ({})) as Partial<Payload>;
    return { ok: response.ok, payload };
  }
}

export async function createPosCheckoutOrder(amount: number): Promise<PosCheckoutOrder> {
  const saleId = `#FZ-POS-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const { ok, payload: order } = await requestPosCheckout<PosCheckoutOrder & { error?: string }>("", {
    method: "POST",
    body: { amount, saleId },
    signal: AbortSignal.timeout(20_000),
  });
  if (!ok || !order.id || !order.keyId || order.saleId !== saleId
    || order.amount !== amount || order.currency !== "INR") {
    throw new Error(order.error || "Razorpay could not prepare this POS bill. Try again.");
  }
  return { id: order.id, saleId, keyId: order.keyId, amount, currency: order.currency };
}

export async function readPosCheckoutStatus(order: PosCheckoutOrder): Promise<PosCheckoutStatus> {
  const params = new URLSearchParams({ id: order.id, saleId: order.saleId });
  const { ok, payload: result } = await requestPosCheckout<{ status?: string; paymentId?: string; amount?: number; error?: string }>(`?${params}`, {
    method: "GET",
    signal: AbortSignal.timeout(35_000),
  });
  if (!ok) throw new Error(result.error || "Razorpay could not confirm the payment status.");
  if (result.status === "paid" && result.paymentId && result.amount === order.amount) {
    return { status: "paid", paymentId: result.paymentId, amount: result.amount };
  }
  if (result.status === "waiting" || result.status === "pending") return { status: result.status };
  return { status: "review", error: result.error || "The Razorpay payment could not be matched to this bill." };
}

export async function preparePosCheckout(
  order: PosCheckoutOrder,
  customer: { name: string; phone: string },
  onPaid: () => void,
  onDismiss: () => void,
) {
  const Razorpay = await loadCheckout();
  const digits = customer.phone.replace(/\D/g, "");
  return new Razorpay({
    key: order.keyId,
    order_id: order.id,
    amount: order.amount,
    currency: order.currency,
    name: "Fanzzy",
    description: `POS sale ${order.saleId}`,
    prefill: { name: customer.name.trim() || "Walk-in customer", ...(digits.length === 10 ? { contact: `+91${digits}` } : {}) },
    config: {
      display: {
        blocks: { posupi: { name: "UPI", instruments: [{ method: "upi" }] } },
        sequence: ["block.posupi"],
        preferences: { show_default_blocks: false },
      },
    },
    // Checkout completion triggers a server lookup. Its callback payload is not proof of payment.
    handler: onPaid,
    modal: { ondismiss: onDismiss },
  });
}
