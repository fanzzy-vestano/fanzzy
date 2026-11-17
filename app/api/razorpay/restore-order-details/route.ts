import { finalizeRazorpayPayment, type RazorpayPayment } from "../../../../lib/razorpay-payment-sync";
import { isAdminSessionValid } from "../../../../lib/admin-auth";
import { razorpayRead } from "../../../../lib/razorpay-provider";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function POST(request: Request) {
  if (!isAdminSessionValid(request)) return json({ error: "Admin authentication required." }, 401);
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return json({ error: "Razorpay is not configured on the server" }, 503);

  let paymentId = "";
  try {
    const body = await request.json() as { razorpayPaymentId?: unknown };
    paymentId = typeof body.razorpayPaymentId === "string" ? body.razorpayPaymentId.trim() : "";
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (!/^pay_[a-zA-Z0-9]{1,64}$/.test(paymentId)) return json({ error: "A valid Razorpay payment ID is required" }, 400);

  try {
    const payment = await razorpayRead<RazorpayPayment>(`payments/${encodeURIComponent(paymentId)}`);
    if (payment.id !== paymentId || payment.status !== "captured" || payment.captured !== true || payment.currency !== "INR") return json({ error: "This Razorpay payment has not been captured in INR" }, 409);
    const order = await finalizeRazorpayPayment(payment);
    if (!order) return json({ error: "The payment is captured, but its POS order has not been saved yet." }, 409);
    return json({ restored: true, orderId: order.id, address: order.address || null, phone: order.phone || null, email: order.email || null });
  } catch {
    return json({ error: "Could not verify and restore the saved payment details. Reconciliation is required." }, 503);
  }
}
