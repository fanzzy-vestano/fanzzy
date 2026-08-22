import { isAdminSessionValid } from "../../../../../lib/admin-auth";
import { forceLogoutVendor, resetVendorPassword, VendorDataError } from "../../../../../lib/vendor-server";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminSessionValid(request)) return Response.json({ error: "Admin authentication required." }, { status: 401 });
  const id = (await context.params).id;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "reset-password") { await resetVendorPassword(id, String(body.password || ""), "admin-session", true); return Response.json({ updated: true }); }
    if (body.action === "force-logout") { await forceLogoutVendor(id, "admin-session"); return Response.json({ updated: true }); }
    const { updateVendorAdmin } = await import("../../../../../lib/vendor-server");
    const vendor = await updateVendorAdmin(id, body, "admin-session");
    return Response.json({ vendor });
  } catch (error) { const status = error instanceof VendorDataError ? error.status : 500; return Response.json({ error: error instanceof VendorDataError ? error.message : "Could not update vendor." }, { status }); }
}
