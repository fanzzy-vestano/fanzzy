import { randomUUID } from "node:crypto";
import { getCustomerSession } from "./customer-sms-auth";
import { saveMobilePendingOrder, type StoredOrder } from "./razorpay-payment-sync";
import { readTransactionalOrders, CheckoutError } from "./transactional-checkout";

export function publicCheckoutOrder(order: StoredOrder) {
  const result = { ...order } as StoredOrder & { _quote?: unknown };
  delete result._quote;
  return result;
}

export async function customerOrderRecords(request: Request) {
  const identity = getCustomerSession(request);
  if (!identity) throw new CheckoutError("Please sign in to view your orders.", 401);
  const digits = (phone?: string) => String(phone || "").replace(/\D/g, "").slice(-10);
  return (await readTransactionalOrders()).filter((order) => order.userId ? order.userId === identity.id
    : digits(identity.phone).length === 10 && digits(order.userPhone || order.phone) === digits(identity.phone)).map(publicCheckoutOrder);
}

export async function createPendingCheckout(request: Request, website = false) {
  const identity = getCustomerSession(request);
  if (!identity) return Response.json({ error: "Please sign in before placing an order." }, { status: 401 });
  const key = request.headers.get("idempotency-key") || "";
  if (!/^[A-Za-z0-9_:#.-]{8,128}$/.test(key)) return Response.json({ error: "A checkout idempotency key is required." }, { status: 400 });
  let body: { order?: unknown };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "Invalid request body" }, { status: 400 }); }
  if (!body.order || typeof body.order !== "object" || Array.isArray(body.order)) return Response.json({ error: "Valid checkout order is required." }, { status: 400 });
  try {
    const proposed = body.order as Partial<StoredOrder>;
    const id = website && typeof proposed.id === "string" && /^#FZ-[A-Z0-9-]{6,36}$/.test(proposed.id) ? proposed.id : `#FZ-${randomUUID().replace(/-/g, "").toUpperCase()}`;
    const order = await saveMobilePendingOrder({ ...proposed, id }, identity, { requestKey: key, website });
    return Response.json({ saved: true, order: publicCheckoutOrder(order) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Checkout could not be saved." }, { status: error instanceof CheckoutError ? error.status : 409 });
  }
}
