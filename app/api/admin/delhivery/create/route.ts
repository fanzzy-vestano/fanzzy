import { isAdminSessionValid } from "../../../../../lib/admin-auth";
import { createAdminDelhiveryShipment } from "../../../../../lib/razorpay-payment-sync";

const json = (body: Record<string, unknown>, status = 200) => Response.json(body, { status });

export async function POST(request: Request) {
  if (!isAdminSessionValid(request)) return json({ error: "Admin authentication required." }, 401);

  let body: { orderId?: unknown; weightGrams?: unknown; pickupLocation?: unknown; pickupTime?: unknown };
  try {
    body = await request.json() as { orderId?: unknown; weightGrams?: unknown; pickupLocation?: unknown; pickupTime?: unknown };
  } catch {
    return json({ error: "Invalid shipment request body." }, 400);
  }

  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const weightGrams = Number(body.weightGrams);
  const pickupLocation = typeof body.pickupLocation === "string" ? body.pickupLocation.trim() : "";
  const pickupTime = typeof body.pickupTime === "string" ? body.pickupTime.trim() : "";
  if (!/^#FZ-[A-Z0-9-]+$/i.test(orderId)) return json({ error: "A valid Fanzzy order ID is required." }, 400);
  if (!Number.isFinite(weightGrams) || weightGrams < 500 || weightGrams > 30_000) return json({ error: "Packed parcel weight must be between 500 and 30,000 grams." }, 400);
  if (!pickupLocation) return json({ error: "Select a Delhivery pickup location." }, 400);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(pickupTime)) return json({ error: "Enter a valid Delhivery pickup time." }, 400);

  try {
    const order = await createAdminDelhiveryShipment(orderId, weightGrams, pickupLocation, pickupTime);
    return json({ created: Boolean(order.delhiveryAwb), order });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not create the Delhivery shipment." }, 502);
  }
}
