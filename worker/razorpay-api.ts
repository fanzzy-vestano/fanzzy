import { POST as createPaymentOrder } from "../app/api/razorpay/order/route";
import { POST as verifyCapturedPayment } from "../app/api/razorpay/verify/route";
import { POST as reserveSavedOrderStock } from "../app/api/razorpay/reserve-stock/route";
import { POST as releaseSavedOrderStock } from "../app/api/razorpay/release-stock/route";
import { paymentConfigurationError } from "../lib/payment-policy";
import { assertLocalTestServerSafety } from "../lib/runtime-safety";

type WorkerEnv = {
  [key: string]: string | undefined;
  FANZZY_ENV?: string;
  NEXT_PUBLIC_FANZZY_ENV?: string;
  RAZORPAY_KEY_ID: string;
  RAZORPAY_KEY_SECRET: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
};

const allowedOrigins = new Set([
  "https://fanzzy.in",
  "https://www.fanzzy.in",
  "http://localhost:3000",
  "http://localhost:5173",
]);

const headersFor = (request: Request) => ({
  "content-type": "application/json",
  "access-control-allow-origin": allowedOrigins.has(request.headers.get("origin") || "")
    ? request.headers.get("origin") || "https://fanzzy.in"
    : "https://fanzzy.in",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-max-age": "86400",
});

const json = (request: Request, body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: headersFor(request) });

const razorpayAuth = (env: WorkerEnv) => `Basic ${btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)}`;

type RazorpayQrPayment = {
  id?: string;
  amount?: number;
  status?: string;
  method?: string;
  captured?: boolean;
};

const posQrId = (request: Request) => {
  const id = new URL(request.url).searchParams.get("id")?.trim() || "";
  return /^qr_[A-Za-z0-9]+$/.test(id) ? id : "";
};

const createPosQr = async (request: Request, env: WorkerEnv) => {
  let body: { amount?: unknown; reference?: unknown; orderId?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json(request, { error: "Invalid QR request" }, 400);
  }
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount < 100 || amount > 1_000_000_000) {
    return json(request, { error: "UPI QR amount must be between ₹1 and ₹10,000,000" }, 400);
  }
  const reference = typeof body.reference === "string" && body.reference.trim()
    ? body.reference.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)
    : `POS-${Date.now()}`;
  const orderId = typeof body.orderId === "string" && /^#FZ-POS-[A-Z0-9-]+$/i.test(body.orderId.trim())
    ? body.orderId.trim()
    : "";
  const closeBy = Math.floor(Date.now() / 1000) + 20 * 60;
  try {
    const response = await fetch("https://api.razorpay.com/v1/payments/qr_codes", {
      method: "POST",
      headers: { Authorization: razorpayAuth(env), "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "upi_qr",
        name: `Fanzzy ${reference}`,
        usage: "single_use",
        fixed_amount: true,
        payment_amount: amount,
        description: `Fanzzy counter sale ${reference}`,
        close_by: closeBy,
        notes: { fanzzy_pos_reference: reference, ...(orderId ? { fanzzy_order_id: orderId } : {}) },
      }),
    });
    const result = await response.json() as { id?: string; image_url?: string; payment_amount?: number; status?: string; close_by?: number; error?: { description?: string } };
    if (response.ok && result.id && result.image_url) {
      return json(request, { id: result.id, imageUrl: result.image_url, amount: result.payment_amount || amount, status: result.status || "active", closeBy: result.close_by || closeBy, mode: "native_qr" });
    }

    const fallbackResponse = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: { Authorization: razorpayAuth(env), "Content-Type": "application/json" },
      body: JSON.stringify({
        amount,
        currency: "INR",
        accept_partial: false,
        reference_id: reference,
        description: `Fanzzy counter sale ${reference}`,
        expire_by: closeBy,
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes: { fanzzy_pos_reference: reference, fanzzy_payment_source: "pos_qr_fallback", ...(orderId ? { fanzzy_order_id: orderId } : {}) },
      }),
    });
    const fallback = await fallbackResponse.json() as { id?: string; short_url?: string; amount?: number; status?: string; expire_by?: number; error?: { description?: string } };
    if (!fallbackResponse.ok || !fallback.id || !fallback.short_url) {
      return json(request, { error: fallback.error?.description || result.error?.description || "Razorpay could not create a payment QR" }, 502);
    }
    return json(request, { id: fallback.id, paymentUrl: fallback.short_url, amount: fallback.amount || amount, status: fallback.status || "created", closeBy: fallback.expire_by || closeBy, mode: "payment_link" });
  } catch {
    return json(request, { error: "Razorpay UPI QR is temporarily unavailable" }, 502);
  }
};

const getPosQrStatus = async (request: Request, env: WorkerEnv) => {
  const id = posQrId(request);
  if (!id) return json(request, { error: "A valid Razorpay payment QR id is required" }, 400);
  try {
    const response = await fetch(`https://api.razorpay.com/v1/payments/qr_codes/${encodeURIComponent(id)}/payments?count=10`, {
      headers: { Authorization: razorpayAuth(env) },
    });
    const result = await response.json() as { items?: RazorpayQrPayment[]; error?: { description?: string } };
    if (!response.ok) return json(request, { error: result.error?.description || "Could not check the UPI payment" }, 502);
    const payments = Array.isArray(result.items) ? result.items : [];
    const paid = payments.find((payment) => payment.status === "captured" && payment.captured !== false && payment.method === "upi");
    const processing = payments.find((payment) => payment.status === "authorized" || payment.status === "created");
    return json(request, { paid: Boolean(paid), paymentId: paid?.id, amount: paid?.amount, status: paid ? "captured" : processing?.status || "waiting" });
  } catch {
    return json(request, { error: "Could not check the Razorpay UPI payment" }, 502);
  }
};

const closePosQr = async (request: Request, env: WorkerEnv) => {
  const id = posQrId(request);
  if (!id) return json(request, { error: "A valid Razorpay payment QR id is required" }, 400);
  try {
    const closeUrl = `https://api.razorpay.com/v1/payments/qr_codes/${encodeURIComponent(id)}/close`;
    const response = await fetch(closeUrl, {
      method: "POST",
      headers: { Authorization: razorpayAuth(env) },
    });
    const result = await response.json() as { status?: string; error?: { description?: string } };
    if (!response.ok) return json(request, { error: result.error?.description || "Could not close the payment QR" }, 502);
    return json(request, { closed: true, status: result.status || "closed" });
  } catch {
    return json(request, { error: "Could not close the Razorpay payment QR" }, 502);
  }
};


export default {
  async fetch(request: Request, env: WorkerEnv) {
    assertLocalTestServerSafety(env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headersFor(request) });
    const path = new URL(request.url).pathname.replace(/\/$/, "").split("/").pop();
    if (path === "pos-qr") {
      const error = paymentConfigurationError(env);
      if (error) return json(request, { error }, 503);
    }
    if (path === "pos-qr" && request.method === "GET") return getPosQrStatus(request, env);
    if (path === "pos-qr" && request.method === "DELETE") return closePosQr(request, env);
    if (request.method === "GET") return json(request, { ok: true, service: "razorpay-api" });
    if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
    if (path === "order") return createPaymentOrder(request);
    if (path === "pos-qr") return createPosQr(request, env);
    if (path === "reserve-stock") return reserveSavedOrderStock(request);
    if (path === "release-stock") return releaseSavedOrderStock(request);
    if (path === "verify") return verifyCapturedPayment(request);
    return json(request, { error: "Not found" }, 404);
  },
};
