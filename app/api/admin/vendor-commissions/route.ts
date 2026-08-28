import { isAdminSessionValid } from "../../../../lib/admin-auth";
import { deleteVendorCommissionRule, listVendorCommissionRules, saveVendorCommissionRule, VendorDataError } from "../../../../lib/vendor-server";

const result = (body: Record<string, unknown>, status = 200) => Response.json(body, { status });

export async function GET(request: Request) {
  if (!isAdminSessionValid(request)) return result({ error: "Admin authentication required." }, 401);
  try { return result({ rules: await listVendorCommissionRules() }); }
  catch (error) { const status = error instanceof VendorDataError ? error.status : 500; return result({ error: error instanceof VendorDataError ? error.message : "Could not load commission rules." }, status); }
}

export async function POST(request: Request) {
  if (!isAdminSessionValid(request)) return result({ error: "Admin authentication required." }, 401);
  try { return result({ rule: await saveVendorCommissionRule(await request.json() as Record<string, unknown>, "admin-session") }, 201); }
  catch (error) { const status = error instanceof VendorDataError ? error.status : 500; return result({ error: error instanceof VendorDataError ? error.message : "Could not save commission rule." }, status); }
}

export async function DELETE(request: Request) {
  if (!isAdminSessionValid(request)) return result({ error: "Admin authentication required." }, 401);
  try {
    const id = new URL(request.url).searchParams.get("id") || "";
    return result({ deleted: await deleteVendorCommissionRule(id, "admin-session") });
  } catch (error) { const status = error instanceof VendorDataError ? error.status : 500; return result({ error: error instanceof VendorDataError ? error.message : "Could not delete commission rule." }, status); }
}
