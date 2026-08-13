import { finalizeRazorpayPayment, type RazorpayPayment } from "../../../../lib/razorpay-payment-sync";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function POST(request: Request) {
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
  if (!paymentId) return json({ error: "Razorpay payment ID is required" }, 400);

  try {
    const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` },
    });
    const payment = await response.json() as RazorpayPayment & { status?: string; error?: { description?: string } };
    if (!response.ok) return json({ error: payment.error?.description || "Could not read this Razorpay payment" }, 502);
    if (payment.status !== "captured") return json({ error: "This Razorpay payment has not been captured" }, 409);
    const order = await finalizeRazorpayPayment(payment);
    return json({ restored: true, orderId: order.id, address: order.address || null, phone: order.phone || null, email: order.email || null });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not restore the payment details" }, 502);
  }
}
