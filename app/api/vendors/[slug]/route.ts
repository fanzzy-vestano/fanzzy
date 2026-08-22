import { getPublicVendor, VendorDataError } from "../../../../lib/vendor-server";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  try { return Response.json(await getPublicVendor((await context.params).slug)); }
  catch (error) { const status = error instanceof VendorDataError ? error.status : 500; return Response.json({ error: error instanceof VendorDataError ? error.message : "Could not load vendor store." }, { status }); }
}
