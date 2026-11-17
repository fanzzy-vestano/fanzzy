import { paymentConfigurationError } from "../../../../lib/payment-policy";
import { getCustomerSession } from "../../../../lib/customer-sms-auth";
import { createOrReadRazorpayOrder } from "../../../../lib/razorpay-provider";
import { CheckoutError } from "../../../../lib/transactional-checkout";

export async function POST(request: Request) {
  const error = paymentConfigurationError(process.env);
  if (error) return Response.json({ error }, { status: 503 });
  const identity = getCustomerSession(request);
  if (!identity) return Response.json({ error: "Please sign in before payment." }, { status: 401 });
  let body: { amount?: unknown; fanzzyOrderId?: unknown };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "Invalid request body" }, { status: 400 }); }
  if (typeof body.fanzzyOrderId !== "string" || !/^#FZ-[A-Z0-9-]{6,36}$/i.test(body.fanzzyOrderId)) return Response.json({ error: "A valid order ID is required." }, { status: 400 });
  try { return Response.json(await createOrReadRazorpayOrder(body.fanzzyOrderId, identity.id, body.amount)); }
  catch (error) { return Response.json({ error: error instanceof CheckoutError ? error.message : "The existing payment attempt requires reconciliation." }, { status: error instanceof CheckoutError ? error.status : 503 }); }
}
