import { isAdminSessionValid } from "../../../../lib/admin-auth";
import { issueCancellationRazorpayRefund } from "../../../../lib/cancellation-razorpay-refunds";
import { publicCheckoutOrder } from "../../../../lib/checkout-http";
import { CheckoutError } from "../../../../lib/transactional-checkout";

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  if (!isAdminSessionValid(request)) {
    return json({ error: "Admin authentication required." }, 401);
  }

  let body: { orderId?: unknown; cancellationRecordId?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const cancellationRecordId = typeof body.cancellationRecordId === "string"
    ? body.cancellationRecordId.trim()
    : undefined;

  try {
    const result = await issueCancellationRazorpayRefund(orderId, cancellationRecordId);
    return json({
      order: publicCheckoutOrder(result.order),
      refundReference: result.refundReference,
      providerStatus: result.providerStatus,
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Could not issue the Razorpay refund.";
    return json(
      { error: message },
      error instanceof CheckoutError ? error.status : 502,
    );
  }
}
