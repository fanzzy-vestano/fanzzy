import { trackDelhiveryShipment } from "../../../../lib/delhivery";

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
