import { getVendorSession, updateVendorProduct, VendorDataError } from "../../../../../lib/vendor-server";

export async function PATCH(request: Request, context: { params: Promise<{ sku: string }> }) {
  try { const session = await getVendorSession(request); if (!session) return Response.json({ error: "Vendor authentication required." }, { status: 401 }); return Response.json({ product: await updateVendorProduct(session.vendorId, (await context.params).sku, await request.json()) }); }
  catch (error) { const status = error instanceof VendorDataError ? error.status : 500; return Response.json({ error: error instanceof VendorDataError ? error.message : "Could not update vendor product." }, { status }); }
}
