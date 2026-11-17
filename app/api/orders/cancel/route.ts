import { getCustomerSession } from "../../../../lib/customer-sms-auth";
import { cancelTransactionalOrder, CheckoutError } from "../../../../lib/transactional-checkout";
import { publicCheckoutOrder } from "../../../../lib/checkout-http";
import { isCustomerCancellationReason } from "../../../../lib/customer-cancellation";

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  const identity = getCustomerSession(request);
  if (!identity) return json({ error: "Please sign in before cancelling an order." }, 401);

  let body: {
    orderId?: unknown;
    cancellationReason?: unknown;
    cancellationDescription?: unknown;
    itemIndexes?: unknown;
  };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!/^#FZ-[A-Z0-9-]{6,64}$/i.test(orderId))
    return json({ error: "A valid order ID is required." }, 400);

  if (!isCustomerCancellationReason(body.cancellationReason))
    return json({ error: "Please select a cancellation reason." }, 400);
  if (
    body.cancellationDescription !== undefined &&
    typeof body.cancellationDescription !== "string"
  )
    return json({ error: "Cancellation description is invalid." }, 400);
  const cancellationDescription =
    typeof body.cancellationDescription === "string"
      ? body.cancellationDescription.trim().replace(/\s+/g, " ")
      : "";
  if (cancellationDescription.length > 500)
    return json({ error: "Cancellation description must be 500 characters or fewer." }, 400);
  if (body.cancellationReason === "Other" && !cancellationDescription)
    return json({ error: "Please describe why you want to cancel this order." }, 400);
  if (
    !Array.isArray(body.itemIndexes) ||
    !body.itemIndexes.length ||
    body.itemIndexes.length > 100 ||
    body.itemIndexes.some(
      (index) => !Number.isInteger(index) || index < 0,
    ) ||
    new Set(body.itemIndexes).size !== body.itemIndexes.length
  )
    return json({ error: "Please select one or more order items to cancel." }, 400);

  try {
    const order = await cancelTransactionalOrder(orderId, identity.id, {
      reason: body.cancellationReason,
      description: cancellationDescription || undefined,
      itemIndexes: body.itemIndexes,
    });
    return json({ cancelled: true, order: publicCheckoutOrder(order) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not cancel the order.";
    const status = /does not belong/i.test(message)
      ? 403
      : error instanceof CheckoutError
        ? error.status
        : 409;
    return json({ error: message }, status);
  }
}
