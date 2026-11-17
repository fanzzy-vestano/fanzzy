import { createHash, randomUUID } from "node:crypto";
import { assertLocalTestServerSafety } from "./runtime-safety";
import type { StoredOrder, RazorpayPayment } from "./razorpay-payment-sync";
import type { CustomerCancellationReason } from "./customer-cancellation";

export class CheckoutError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

/** Server-only RPC. There is deliberately no legacy REST-write fallback. */
export async function checkoutRpc<T>(action: string, orderId = "", actor = "", data: unknown = {}): Promise<T> {
  assertLocalTestServerSafety(process.env);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new CheckoutError("Server checkout database configuration is required.", 503);
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/fanzzy_checkout`, {
    method: "POST", cache: "no-store", redirect: "manual",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ p_action: action, p_order_id: orderId, p_actor: actor, p_data: data }),
  });
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 404 || body.code === "PGRST202") throw new CheckoutError("Checkout database migration is required. Checkout is disabled.", 503);
    throw new CheckoutError(body.code === "P0001" ? String(body.message).slice(0, 240) : "Checkout transaction could not be committed.", response.status >= 500 ? 503 : 409);
  }
  return body as T;
}

const snapshots = new WeakMap<StoredOrder[], Map<string, string>>();
const remember = (orders: StoredOrder[]) => {
  snapshots.set(orders, new Map(orders.map((order) => [order.id, JSON.stringify(order)])));
  return orders;
};

export async function readTransactionalOrders() {
  return remember(await checkoutRpc<StoredOrder[]>("list"));
}

/** Compare only changed fields, inside the DB transaction. No stale array replacement. */
export async function patchTransactionalOrders(orders: StoredOrder[]) {
  const before = snapshots.get(orders);
  if (!before) throw new CheckoutError("An order snapshot is required before saving.");
  const patches = orders.flatMap((order) => {
    const prior = before.get(order.id);
    if (!prior) throw new CheckoutError("New orders must use the checkout creation transaction.");
    const old = JSON.parse(prior) as Record<string, unknown>;
    const current = order as unknown as Record<string, unknown>;
    const changes: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(old), ...Object.keys(current)])) {
      if (JSON.stringify(old[key]) !== JSON.stringify(current[key])) {
        changes[key] = current[key] ?? null;
        expected[key] = old[key] ?? null;
      }
    }
    return Object.keys(changes).length ? [{ id: order.id, changes, before: expected }] : [];
  });
  if (!patches.length) return;
  const updated = await checkoutRpc<StoredOrder[]>("patch", "", "", { patches });
  for (const order of orders) {
    const saved = updated.find((row) => row.id === order.id);
    if (saved) Object.assign(order, saved);
  }
  remember(orders);
}

export type CheckoutQuote = { expiresAt: string; settings: Record<string, string>; prices: Record<string, number>; firstPurchase?: boolean; salesOfferId?: string; promotions?: Array<{ id: string; sets: number; maxTotalUsage: number; perCustomerLimit: number; usageCount: number }> };
export function checkoutRequestHash(order: StoredOrder) {
  const { id: _id, date: _date, createdAt: _created, ...content } = order;
  void _id; void _date; void _created;
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}
export async function createTransactionalOrder(order: StoredOrder, actor: string, requestKey: string, quote: CheckoutQuote, requestHash = checkoutRequestHash(order)) {
  return checkoutRpc<StoredOrder>("save", order.id, actor, { order, requestKey, requestHash, quote });
}

export type PaymentAttempt = { order_id: string; token: string; state: "creating" | "ambiguous" | "rejected" | "bound"; provider_order_id?: string; receipt: string; amount: number };
export function claimPaymentAttempt(orderId: string, actor: string) {
  return checkoutRpc<{ order: StoredOrder; attempt: PaymentAttempt; claimed: boolean }>("claim_attempt", orderId, actor, { token: randomUUID() });
}
export function bindPaymentAttempt(orderId: string, token: string, providerOrderId: string) {
  return checkoutRpc<StoredOrder>("bind_attempt", orderId, "", { token, providerOrderId });
}
export function markPaymentAttempt(orderId: string, token: string, definitiveRejection = false) {
  return checkoutRpc<StoredOrder>(definitiveRejection ? "reject_attempt" : "ambiguous_attempt", orderId, "", { token });
}

export function cancelTransactionalOrder(
  orderId: string,
  actor: string,
  cancellation: {
    reason: CustomerCancellationReason;
    description?: string;
    itemIndexes: number[];
  },
) {
  return checkoutRpc<StoredOrder>("cancel", orderId, actor, {
    cancellationReason: cancellation.reason,
    cancellationDescription: cancellation.description || "",
    itemIndexes: cancellation.itemIndexes,
  });
}

export function captureTransactionalPayment(orderId: string, payment: RazorpayPayment, callback?: { key: string; hash: string }) {
  // Callback event deduplication and payment-id deduplication are separate.
  // Browser verification and multiple provider events may report one capture.
  const hash = createHash("sha256").update(JSON.stringify({ id: payment.id, order_id: payment.order_id, amount: payment.amount, currency: payment.currency, status: payment.status, captured: payment.captured })).digest("hex");
  return checkoutRpc<StoredOrder>("capture", orderId, "", { payment, eventKey: callback?.key || `payment:${payment.id}`, eventHash: callback?.hash || hash });
}
