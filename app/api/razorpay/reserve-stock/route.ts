import { reserveOrderInventory } from "../../../../lib/razorpay-payment-sync";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function POST(request: Request) {
  let body: { fanzzyOrderId?: unknown };
  try {
    body = await request.json() as { fanzzyOrderId?: unknown };
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const orderId = typeof body.fanzzyOrderId === "string" ? body.fanzzyOrderId.trim() : "";
  if (!/^#FZ-[A-Z0-9-]+$/i.test(orderId)) return json({ error: "A valid order id is required" }, 400);

  try {
    const order = await reserveOrderInventory(orderId);
    return json({ reserved: order.inventoryReserved === true, reservedAt: order.inventoryReservedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reserve product stock";
    return json({ error: message }, /not have enough stock|no longer available|inventory changed while/i.test(message) ? 409 : 502);
  }
}
