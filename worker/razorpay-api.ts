import { adjustOrderInventory, type InventoryOrder } from "../lib/inventory-adjustment";

type WorkerEnv = {
  RAZORPAY_KEY_ID: string;
  RAZORPAY_KEY_SECRET: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
};

type StoredOrder = InventoryOrder & {
  id: string;
  paymentStatus?: "pending" | "paid";
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  inventoryReserved?: boolean;
  inventoryReservedAt?: string;
  inventoryReleased?: boolean;
  inventoryAdjusted?: boolean;
};

const defaultSupabaseUrl = "https://pdrcrkxeyqxqgpwfxqpu.supabase.co";
const defaultSupabasePublishableKey = "sb_publishable_OTSfS6G2tlrAGINfyY3VGA_yi_3BPAV";

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

const supabaseConfig = (env: WorkerEnv) => {
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || defaultSupabasePublishableKey;
  return {
    supabaseUrl: (env.SUPABASE_URL || defaultSupabaseUrl).replace(/\/$/, ""),
    supabaseKey,
  };
};

const supabaseHeaders = (env: WorkerEnv) => {
  const { supabaseKey } = supabaseConfig(env);
  return {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
  };
};

const inventoryMutationQueue: { current: Promise<void> } = { current: Promise.resolve() };
const withInventoryMutationLock = async <T>(operation: () => Promise<T>) => {
  const previous = inventoryMutationQueue.current;
  let release!: () => void;
  inventoryMutationQueue.current = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
};

async function readOrders(env: WorkerEnv) {
  const { supabaseUrl } = supabaseConfig(env);
  const response = await fetch(`${supabaseUrl}/rest/v1/store_settings?key=eq.orders&select=value`, {
    headers: supabaseHeaders(env),
  });
  if (!response.ok) throw new Error("Could not read saved orders");
  const rows = await response.json() as Array<{ value?: string }>;
  try {
    const parsed = JSON.parse(rows[0]?.value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed as StoredOrder[] : [];
  } catch {
    return [] as StoredOrder[];
  }
}

async function writeOrders(env: WorkerEnv, orders: StoredOrder[]) {
  const { supabaseUrl } = supabaseConfig(env);
  const response = await fetch(`${supabaseUrl}/rest/v1/store_settings?on_conflict=key`, {
    method: "POST",
    headers: { ...supabaseHeaders(env), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ key: "orders", value: JSON.stringify(orders), updated_at: new Date().toISOString() }]),
  });
  if (!response.ok) throw new Error("Could not save the confirmed payment");
}

async function finalizeOrderInventory(
  env: WorkerEnv,
  payment: { id?: string; order_id?: string; notes?: Record<string, unknown> },
) {
  const orders = await readOrders(env);
  const notedOrderId = typeof payment.notes?.fanzzy_order_id === "string" ? payment.notes.fanzzy_order_id.trim() : "";
  const order = orders.find((candidate) => candidate.razorpayPaymentId === payment.id)
    || orders.find((candidate) => candidate.razorpayOrderId && candidate.razorpayOrderId === payment.order_id)
    || (notedOrderId ? orders.find((candidate) => candidate.id === notedOrderId) : undefined);

  // The order is saved before checkout opens. If it cannot be found, do not
  // touch inventory: the next verified attempt can safely retry it.
  if (!order) return false;
  if (order.paymentStatus === "paid" && order.inventoryAdjusted === true) return true;

  order.paymentStatus = "paid";
  order.razorpayOrderId = payment.order_id || order.razorpayOrderId;
  order.razorpayPaymentId = payment.id || order.razorpayPaymentId;
  order.inventoryAdjusted = order.inventoryReserved === true && order.inventoryReleased !== true;
  await writeOrders(env, orders);

  if (!order.inventoryAdjusted) {
    try {
      const adjustment = await adjustOrderInventory(order, supabaseConfig(env));
      order.inventoryAdjusted = adjustment.complete;
    } catch {
      order.inventoryAdjusted = false;
    }
  }
  await writeOrders(env, orders);
  return order.inventoryAdjusted === true;
}

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

const orderIdFromRequest = async (request: Request) => {
  let body: { fanzzyOrderId?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return { orderId: "", error: "Invalid stock request" };
  }
  const orderId = typeof body.fanzzyOrderId === "string" ? body.fanzzyOrderId.trim() : "";
  if (!/^#FZ-[A-Z0-9-]+$/i.test(orderId)) return { orderId: "", error: "A valid order id is required" };
  return { orderId };
};

const reserveStock = async (request: Request, env: WorkerEnv) => {
  const parsed = await orderIdFromRequest(request);
  if (parsed.error) return json(request, { error: parsed.error }, 400);
  try {
    return await withInventoryMutationLock(async () => {
      const orders = await readOrders(env);
      const order = orders.find((candidate) => candidate.id === parsed.orderId);
      if (!order) return json(request, { error: "Order could not be found for stock reservation." }, 404);
      if (order.paymentStatus === "paid" || (order.inventoryReserved === true && order.inventoryReleased !== true)) {
        return json(request, { reserved: order.inventoryReserved === true, reservedAt: order.inventoryReservedAt });
      }
      const adjustment = await adjustOrderInventory(order, supabaseConfig(env), "decrement", true);
      if (!adjustment.complete) return json(request, { error: adjustment.reason || "One or more products do not have enough stock." }, 409);
      order.inventoryReserved = true;
      order.inventoryReservedAt = new Date().toISOString();
      order.inventoryReleased = false;
      order.inventoryAdjusted = false;
      await writeOrders(env, orders);
      return json(request, { reserved: true, reservedAt: order.inventoryReservedAt });
    });
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : "Could not reserve product stock" }, 502);
  }
};

const releaseStock = async (request: Request, env: WorkerEnv) => {
  const parsed = await orderIdFromRequest(request);
  if (parsed.error) return json(request, { error: parsed.error }, 400);
  try {
    return await withInventoryMutationLock(async () => {
      const orders = await readOrders(env);
      const order = orders.find((candidate) => candidate.id === parsed.orderId);
      if (!order) return json(request, { error: "Order could not be found for stock release." }, 404);
      if (order.paymentStatus === "paid" || order.inventoryReserved !== true || order.inventoryReleased === true) {
        return json(request, { released: order.inventoryReleased === true });
      }
      const adjustment = await adjustOrderInventory(order, supabaseConfig(env), "release");
      if (!adjustment.complete) return json(request, { error: "Reserved stock could not be released." }, 502);
      order.inventoryReleased = true;
      order.inventoryAdjusted = false;
      await writeOrders(env, orders);
      return json(request, { released: true });
    });
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : "Could not release reserved stock" }, 502);
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
    const payment = await response.json() as { id?: string; order_id?: string; status?: string; notes?: Record<string, unknown>; error?: { description?: string } };
    if (!response.ok || payment.id !== paymentId || payment.order_id !== orderId) {
      return json(request, { error: payment.error?.description || "Razorpay payment could not be confirmed" }, 502);
    }
    const inventoryAdjusted = await withInventoryMutationLock(() => finalizeOrderInventory(env, payment));
    return json(request, { verified: true, razorpayOrderId: orderId, razorpayPaymentId: paymentId, inventoryAdjusted });
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : "Razorpay payment confirmation is temporarily unavailable" }, 502);
  }
};

export default {
  async fetch(request: Request, env: WorkerEnv) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headersFor(request) });
    if (request.method === "GET") return json(request, { ok: true, service: "razorpay-api" });
    if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
    const path = new URL(request.url).pathname.replace(/\/$/, "").split("/").pop();
    if (path === "order") return createOrder(request, env);
    if (path === "reserve-stock") return reserveStock(request, env);
    if (path === "release-stock") return releaseStock(request, env);
    if (path === "verify") return verifyPayment(request, env);
    return json(request, { error: "Not found" }, 404);
  },
};
