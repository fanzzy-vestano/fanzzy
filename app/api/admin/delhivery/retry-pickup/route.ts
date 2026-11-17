import { isAdminSessionValid } from "../../../../../lib/admin-auth";
import { retryAdminDelhiveryPickup } from "../../../../../lib/razorpay-payment-sync";
import { selectedPickupSchedule } from "../../../../../lib/delhivery-pickup-date";

export async function POST(request: Request) {
  if (!isAdminSessionValid(request)) return Response.json({ error: "Admin authentication required." }, { status: 401 });
  let body: { orderId?: unknown; pickupDate?: unknown; pickupTime?: unknown };
  try { body = await request.json() as typeof body; } catch {
    return Response.json({ error: "Invalid pickup retry request." }, { status: 400 });
  }
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid pickup retry request." }, { status: 400 });
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const pickupDate = typeof body.pickupDate === "string" ? body.pickupDate.trim() : "";
  const pickupTime = typeof body.pickupTime === "string" ? body.pickupTime.trim() : "";
  if (!/^#FZ-[A-Z0-9-]+$/i.test(orderId)) return Response.json({ error: "A valid Fanzzy order ID is required." }, { status: 400 });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(pickupTime)) return Response.json({ error: "Enter a valid Delhivery pickup time." }, { status: 400 });
  try { selectedPickupSchedule(pickupDate, pickupTime); } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Select a valid pickup date and time." }, { status: 400 });
  }
  try {
    return Response.json({ order: await retryAdminDelhiveryPickup(orderId, pickupDate, pickupTime) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not retry the pickup." }, { status: 409 });
  }
}
