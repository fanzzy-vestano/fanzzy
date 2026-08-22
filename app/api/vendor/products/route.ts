import { getVendorProducts, getVendorSession, saveVendorProduct, VendorDataError } from "../../../../lib/vendor-server";

export async function GET(request: Request) {
  try { const session = await getVendorSession(request); if (!session) return Response.json({ error: "Vendor authentication required." }, { status: 401 }); return Response.json({ products: await getVendorProducts(session.vendorId) }); }
  catch (error) { const status = error instanceof VendorDataError ? error.status : 500; return Response.json({ error: error instanceof VendorDataError ? error.message : "Could not load vendor products." }, { status }); }
}

export async function POST(request: Request) {
  try { const session = await getVendorSession(request); if (!session) return Response.json({ error: "Vendor authentication required." }, { status: 401 }); return Response.json({ product: await saveVendorProduct(session.vendorId, await request.json()) }, { status: 201 }); }
  catch (error) { const status = error instanceof VendorDataError ? error.status : 500; return Response.json({ error: error instanceof VendorDataError ? error.message : "Could not save vendor product." }, { status }); }
}
