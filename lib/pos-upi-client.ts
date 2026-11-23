import { adminApiFetch } from "./site-api-client";

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

const endpoint = "/admin/pos-checkout";

export async function createPosCheckoutOrder(amount: number): Promise<PosCheckoutOrder> {
  const saleId = `#FZ-POS-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const response = await adminApiFetch(endpoint, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount, saleId }),
    signal: AbortSignal.timeout(20_000),
  });
  const order = await response.json().catch(() => ({})) as Partial<PosCheckoutOrder> & { error?: string };
  if (!response.ok || !order.id || !order.keyId || order.saleId !== saleId
    || order.amount !== amount || order.currency !== "INR") {
    throw new Error(order.error || "Razorpay could not prepare this POS bill. Try again.");
  }
  return { id: order.id, saleId, keyId: order.keyId, amount, currency: order.currency };
}

export async function readPosCheckoutStatus(order: PosCheckoutOrder): Promise<PosCheckoutStatus> {
  const params = new URLSearchParams({ id: order.id, saleId: order.saleId });
  const response = await adminApiFetch(`${endpoint}?${params}`, {
    credentials: "include",
    cache: "no-store",
    signal: AbortSignal.timeout(35_000),
  });
  const result = await response.json().catch(() => ({})) as { status?: string; paymentId?: string; amount?: number; error?: string };
  if (!response.ok) throw new Error(result.error || "Razorpay could not confirm the payment status.");
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
