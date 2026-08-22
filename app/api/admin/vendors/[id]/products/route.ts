import { isAdminSessionValid } from "../../../../../../lib/admin-auth";
import { getVendorProducts, VendorDataError } from "../../../../../../lib/vendor-server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminSessionValid(request)) return Response.json({ error: "Admin authentication required." }, { status: 401 });
  try { return Response.json({ products: await getVendorProducts((await context.params).id) }); }
  catch (error) { const status = error instanceof VendorDataError ? error.status : 500; return Response.json({ error: error instanceof VendorDataError ? error.message : "Could not load vendor products." }, { status }); }
}
