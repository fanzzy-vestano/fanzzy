import { customerApiFetch } from "./site-api-client";

// Customer order history is authoritative only on the authenticated backend.
// Never merge browser order records or select an admin session for this view.
export async function fetchCustomerOrders<T>() {
  try {
    const response = await customerApiFetch("/orders", { credentials: "include", cache: "no-store" });
    const body = await response.json() as { orders?: T[]; error?: string };
    if (!response.ok || !Array.isArray(body.orders)) throw new Error(body.error || "Orders are unavailable.");
    return { data: body.orders, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error("Orders are unavailable.") };
  }
}

export async function savePendingCustomerOrder<T extends { id: string }>(order: T): Promise<T> {
  const response = await customerApiFetch("/orders/pending", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", "idempotency-key": order.id },
    body: JSON.stringify({ order }),
  });
  const body = await response.json() as { saved?: boolean; order?: T; error?: string };
  if (!response.ok || body.saved !== true || !body.order || body.order.id !== order.id) {
    throw new Error(body.error || "The order was not saved on the server. Checkout has stopped.");
  }
  return body.order;
}
