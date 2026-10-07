import { getVendorOrderDetails, getVendorSession, VendorDataError } from "../../../../../../lib/vendor-server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getVendorSession(request);
    if (!session) return Response.json({ error: "Vendor authentication required." }, { status: 401 });
    const { id } = await context.params;
    return Response.json(await getVendorOrderDetails(session.vendorId, id));
  } catch (error) {
    const status = error instanceof VendorDataError ? error.status : 500;
    return Response.json({ error: error instanceof VendorDataError ? error.message : "Could not load order details." }, { status });
  }
}
