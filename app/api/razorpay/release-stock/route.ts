import { releaseReservedOrderInventory } from "../../../../lib/razorpay-payment-sync";

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
    const order = await releaseReservedOrderInventory(orderId);
    return json({ released: order.inventoryReleased === true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not release reserved stock" }, 502);
  }
}
