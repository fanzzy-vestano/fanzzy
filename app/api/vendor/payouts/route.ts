import { getVendorSession, listVendorPayouts, VendorDataError } from "../../../../lib/vendor-server";

export async function GET(request: Request) {
  try { const session = await getVendorSession(request); if (!session) return Response.json({ error: "Vendor authentication required." }, { status: 401 }); return Response.json({ payouts: await listVendorPayouts(session.vendorId) }); }
  catch (error) { const status = error instanceof VendorDataError ? error.status : 500; return Response.json({ error: error instanceof VendorDataError ? error.message : "Could not load payouts." }, { status }); }
}
