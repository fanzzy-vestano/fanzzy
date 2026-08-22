import { isAdminSessionValid } from "../../../../../../../lib/admin-auth";
import { reviewVendorProduct, VendorDataError } from "../../../../../../../lib/vendor-server";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; sku: string }> }) {
  if (!isAdminSessionValid(request)) return Response.json({ error: "Admin authentication required." }, { status: 401 });
  try { const params = await context.params; const body = await request.json() as { decision?: unknown; reason?: unknown }; if (!["Approved", "Rejected", "Inactive"].includes(String(body.decision))) return Response.json({ error: "Decision must be Approved, Rejected, or Inactive." }, { status: 400 }); return Response.json({ product: await reviewVendorProduct(params.id, params.sku, body.decision as "Approved" | "Rejected" | "Inactive", typeof body.reason === "string" ? body.reason : undefined, "admin-session") }); }
  catch (error) { const status = error instanceof VendorDataError ? error.status : 500; return Response.json({ error: error instanceof VendorDataError ? error.message : "Could not review vendor product." }, { status }); }
}
