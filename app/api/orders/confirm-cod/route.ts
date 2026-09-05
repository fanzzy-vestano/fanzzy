import { getCustomerSession } from "../../../../lib/customer-sms-auth";
import { confirmCashOnDeliveryOrder } from "../../../../lib/razorpay-payment-sync";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function POST(request: Request) {
  const identity = getCustomerSession(request);
  if (!identity) return json({ error: "Please sign in before placing a COD order." }, 401);

  let body: { fanzzyOrderId?: unknown };
  try {
    body = await request.json() as { fanzzyOrderId?: unknown };
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const orderId = typeof body.fanzzyOrderId === "string" ? body.fanzzyOrderId.trim() : "";
  if (!/^#FZ-[A-Z0-9-]+$/i.test(orderId)) return json({ error: "A valid order id is required" }, 400);

  try {
    const order = await confirmCashOnDeliveryOrder(orderId, identity);
    return json({ confirmed: true, order });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not confirm the COD order";
    return json({ error: message }, /not have enough stock|no longer available|currently unavailable|does not belong/i.test(message) ? 409 : 502);
  }
}
