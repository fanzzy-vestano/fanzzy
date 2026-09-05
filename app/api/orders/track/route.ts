import { lookupPublicOrderTracking } from "../../../../lib/razorpay-payment-sync";

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

export async function POST(request: Request) {
  let body: { orderId?: unknown; phone?: unknown };
  try {
    body = await request.json() as { orderId?: unknown; phone?: unknown };
  } catch {
    return json({ error: "Enter your order number and mobile number." }, 400);
  }

  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const normalizedPhone = phone.replace(/\D/g, "");
  if (!/^#?FZ-[A-Z0-9-]{3,60}$/i.test(orderId) || normalizedPhone.slice(-10).length !== 10) {
    return json({ error: "Enter a valid Fanzzy order number and 10-digit mobile number." }, 400);
  }

  try {
    const tracking = await lookupPublicOrderTracking(orderId, phone);
    if (!tracking) return json({ error: "We could not find that order. Check the order number and mobile number." }, 404);
    return json({ tracking });
  } catch {
    return json({ error: "Tracking is temporarily unavailable. Please try again in a moment." }, 502);
  }
}
