import { createHmac, timingSafeEqual } from "node:crypto";
import { finalizeRazorpayPayment, type RazorpayPayment } from "../../../../lib/razorpay-payment-sync";

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

export async function POST(request: Request) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;
  if (!webhookSecret) return json({ error: "Razorpay webhook is not configured" }, 503);
  const signature = request.headers.get("x-razorpay-signature") || "";
  const rawBody = await request.text();
  const expected = Buffer.from(createHmac("sha256", webhookSecret).update(rawBody).digest("hex"), "utf8");
  const received = Buffer.from(signature, "utf8");
  if (!signature || expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return json({ error: "Invalid webhook signature" }, 400);
  }

  try {
    const event = JSON.parse(rawBody) as {
      event?: string;
      payload?: { payment?: { entity?: RazorpayPayment }; order?: { entity?: { receipt?: string } } };
    };
    if (event.event !== "payment.captured" && event.event !== "order.paid") return json({ received: true });
    const payment = event.payload?.payment?.entity;
    if (!payment?.id) return json({ error: "Webhook payment data is incomplete" }, 400);
    await finalizeRazorpayPayment(payment, event.payload?.order?.entity?.receipt);
    return json({ received: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not process Razorpay webhook" }, 500);
  }
}
