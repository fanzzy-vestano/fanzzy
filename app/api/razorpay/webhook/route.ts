import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { finalizeRazorpayPayment, type RazorpayPayment } from "../../../../lib/razorpay-payment-sync";

import { checkoutRpc, readTransactionalOrders } from "../../../../lib/transactional-checkout";

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

export async function POST(request: Request) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
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
    if (!["payment.captured", "order.paid", "payment.failed"].includes(event.event || "")) return json({ received: true });
    const payment = event.payload?.payment?.entity;
    if (!payment?.id) return json({ error: "Webhook payment data is incomplete" }, 400);
    const hash = createHash("sha256").update(rawBody).digest("hex");
    const eventId = request.headers.get("x-razorpay-event-id") || hash;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) return json({ error: "Invalid callback identity" }, 400);
    const callback = { key: "webhook:" + eventId, hash };
    if (event.event === "payment.failed") {
      const order = (await readTransactionalOrders()).find((row) => row.razorpayOrderId && row.razorpayOrderId === payment.order_id);
      if (order) await checkoutRpc("payment_failed", order.id, "", { payment, eventKey: callback.key, eventHash: callback.hash });
      return json({ received: true });
    }
    const order = await finalizeRazorpayPayment(payment, event.payload?.order?.entity?.receipt, callback);
    if (!order) return json({ error: "Saved order is awaiting reconciliation." }, 409);
    return json({ received: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not process Razorpay webhook" }, 500);
  }
}
