import { createHmac, timingSafeEqual } from "node:crypto";
import { finalizeRazorpayPayment, type RazorpayPayment } from "../../../../lib/razorpay-payment-sync";

type VerifyPaymentRequest = {
  razorpayOrderId?: unknown;
  razorpayPaymentId?: unknown;
  razorpaySignature?: unknown;
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export async function POST(request: Request) {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) return json({ error: "Razorpay is not configured on the server" }, 503);

  let body: VerifyPaymentRequest;
  try {
    body = await request.json() as VerifyPaymentRequest;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const orderId = typeof body.razorpayOrderId === "string" ? body.razorpayOrderId : "";
  const paymentId = typeof body.razorpayPaymentId === "string" ? body.razorpayPaymentId : "";
  const receivedSignature = typeof body.razorpaySignature === "string" ? body.razorpaySignature : "";
  if (!orderId || !paymentId || !receivedSignature) {
    return json({ error: "Incomplete payment response" }, 400);
  }

  const expectedSignature = createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  const expected = Buffer.from(expectedSignature, "utf8");
  const received = Buffer.from(receivedSignature, "utf8");
  const valid = expected.length === received.length && timingSafeEqual(expected, received);
  if (!valid) return json({ error: "Payment verification failed" }, 400);

  try {
    const paymentResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID || ""}:${keySecret}`).toString("base64")}` },
    });
    const payment = await paymentResponse.json() as RazorpayPayment & { error?: { description?: string } };
    if (!paymentResponse.ok || payment.order_id !== orderId) {
      return json({ error: payment.error?.description || "Razorpay payment could not be confirmed" }, 502);
    }
    const order = await finalizeRazorpayPayment(payment);
    return json({
      verified: true,
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      inventoryAdjusted: order.inventoryAdjusted === true,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not save the confirmed payment" }, 502);
  }
}
