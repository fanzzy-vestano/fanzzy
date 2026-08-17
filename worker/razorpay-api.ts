type WorkerEnv = {
  RAZORPAY_KEY_ID: string;
  RAZORPAY_KEY_SECRET: string;
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
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "86400",
});

const json = (request: Request, body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: headersFor(request) });

const razorpayAuth = (env: WorkerEnv) => `Basic ${btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)}`;

const createOrder = async (request: Request, env: WorkerEnv) => {
  let body: { amount?: unknown; receipt?: unknown; fanzzyOrderId?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json(request, { error: "Invalid order request" }, 400);
  }

  const amount = Number(body.amount);
  const receipt = typeof body.receipt === "string" ? body.receipt.trim() : "";
  if (!Number.isInteger(amount) || amount < 100 || amount > 1000000000) {
    return json(request, { error: "Amount must be an integer between ₹1 and ₹10,000,000" }, 400);
  }
  if (!receipt) return json(request, { error: "Receipt is required" }, 400);

  try {
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: razorpayAuth(env), "Content-Type": "application/json" },
      body: JSON.stringify({ amount, currency: "INR", receipt, notes: { fanzzy_order_id: body.fanzzyOrderId || receipt } }),
    });
    const result = await response.json() as { id?: string; amount?: number; currency?: string; error?: { description?: string } };
    if (!response.ok || !result.id) return json(request, { error: result.error?.description || "Razorpay could not create an order" }, 502);
    return json(request, { id: result.id, amount: result.amount, currency: result.currency || "INR", keyId: env.RAZORPAY_KEY_ID });
  } catch {
    return json(request, { error: "Razorpay is temporarily unavailable" }, 502);
  }
};

const verifySignature = async (orderId: string, paymentId: string, signature: string, secret: string) => {
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const received = new Uint8Array(signature.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) || []);
  // Razorpay returns the HMAC as a hexadecimal SHA-256 string, not base64.
  return crypto.subtle.verify("HMAC", key, received, new TextEncoder().encode(`${orderId}|${paymentId}`));
};

const verifyPayment = async (request: Request, env: WorkerEnv) => {
  let body: { razorpayOrderId?: unknown; razorpayPaymentId?: unknown; razorpaySignature?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json(request, { error: "Invalid payment verification request" }, 400);
  }
  const orderId = typeof body.razorpayOrderId === "string" ? body.razorpayOrderId.trim() : "";
  const paymentId = typeof body.razorpayPaymentId === "string" ? body.razorpayPaymentId.trim() : "";
  const signature = typeof body.razorpaySignature === "string" ? body.razorpaySignature.trim() : "";
  if (!orderId || !paymentId || !signature) return json(request, { error: "Payment verification details are incomplete" }, 400);
  if (!await verifySignature(orderId, paymentId, signature, env.RAZORPAY_KEY_SECRET)) return json(request, { error: "Payment signature could not be verified" }, 400);

  try {
    const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: razorpayAuth(env) } });
    const payment = await response.json() as { id?: string; order_id?: string; status?: string; error?: { description?: string } };
    if (!response.ok || payment.id !== paymentId || payment.order_id !== orderId) {
      return json(request, { error: payment.error?.description || "Razorpay payment could not be confirmed" }, 502);
    }
    return json(request, { verified: true, razorpayOrderId: orderId, razorpayPaymentId: paymentId });
  } catch {
    return json(request, { error: "Razorpay payment confirmation is temporarily unavailable" }, 502);
  }
};

export default {
  async fetch(request: Request, env: WorkerEnv) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headersFor(request) });
    if (request.method === "GET") return json(request, { ok: true, service: "razorpay-api" });
    if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
    const path = new URL(request.url).pathname.replace(/\/$/, "").split("/").pop();
    if (path === "order") return createOrder(request, env);
    if (path === "verify") return verifyPayment(request, env);
    return json(request, { error: "Not found" }, 404);
  },
};
