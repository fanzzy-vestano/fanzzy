import { getCustomerSession } from "../../../../lib/customer-sms-auth";
import { listCustomerOrders } from "../../../../lib/razorpay-payment-sync";

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

export async function GET(request: Request) {
  const identity = getCustomerSession(request);
  if (!identity) return json({ error: "Please sign in to view your orders." }, 401);
  try {
    return json({ orders: await listCustomerOrders(identity) });
  } catch {
    return json({ error: "Your orders could not be loaded. Please try again." }, 502);
  }
}
