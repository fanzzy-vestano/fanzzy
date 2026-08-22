import { getVendorSession, VendorDataError, updateVendorOrder } from "../../../../lib/vendor-server";

export async function GET(request: Request) {
  try { const session = await getVendorSession(request); if (!session) return Response.json({ error: "Vendor authentication required." }, { status: 401 }); const url = new URL(request.url); const dashboard = await (await import("../../../../lib/vendor-server")).getVendorDashboard(session.vendorId); return Response.json({ orders: dashboard.orders.filter((order) => !url.searchParams.get("status") || order.status === url.searchParams.get("status")) }); }
  catch (error) { const status = error instanceof VendorDataError ? error.status : 500; return Response.json({ error: error instanceof VendorDataError ? error.message : "Could not load vendor orders." }, { status }); }
}

export async function PATCH(request: Request) {
  try { const session = await getVendorSession(request); if (!session) return Response.json({ error: "Vendor authentication required." }, { status: 401 }); const body = await request.json() as { id?: unknown; status?: unknown; courierName?: unknown; trackingNumber?: unknown; trackingUrl?: unknown }; if (typeof body.id !== "string" || typeof body.status !== "string") return Response.json({ error: "Order ID and status are required." }, { status: 400 }); return Response.json({ order: await updateVendorOrder(session.vendorId, body.id, body.status as never, { name: typeof body.courierName === "string" ? body.courierName : undefined, awb: typeof body.trackingNumber === "string" ? body.trackingNumber : undefined, url: typeof body.trackingUrl === "string" ? body.trackingUrl : undefined }) }); }
  catch (error) { const status = error instanceof VendorDataError ? error.status : 500; return Response.json({ error: error instanceof VendorDataError ? error.message : "Could not update vendor order." }, { status }); }
}
