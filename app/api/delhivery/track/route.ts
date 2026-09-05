import { trackDelhiveryShipment } from "../../../../lib/delhivery";
import { refreshDelhiveryOrderTracking } from "../../../../lib/razorpay-payment-sync";

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const waybill = url.searchParams.get("waybill")?.trim() || "";
  const orderId = url.searchParams.get("orderId")?.trim() || undefined;
  if (!waybill || !/^[A-Za-z0-9-]{6,40}$/.test(waybill)) return json({ error: "A valid Delhivery waybill is required." }, 400);
  try {
    return json({ tracking: await trackDelhiveryShipment(waybill, orderId) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not retrieve Delhivery tracking." }, 502);
  }
}

export async function POST(request: Request) {
  let body: { orderId?: unknown; waybill?: unknown };
  try {
    body = await request.json() as { orderId?: unknown; waybill?: unknown };
  } catch {
    return json({ error: "Invalid tracking request body." }, 400);
  }
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const waybill = typeof body.waybill === "string" ? body.waybill.trim() : "";
  if (!orderId || orderId.length > 80 || !waybill || !/^[A-Za-z0-9-]{6,40}$/.test(waybill)) return json({ error: "A valid order ID and Delhivery waybill are required." }, 400);
  try {
    return json({ tracking: await refreshDelhiveryOrderTracking(orderId, waybill) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not update Delhivery tracking." }, 502);
  }
}
