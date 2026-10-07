import { isAdminSessionValid } from "../../../../../lib/admin-auth";
import { getDelhiveryAdminOptions } from "../../../../../lib/delhivery";

export async function GET(request: Request) {
  if (!isAdminSessionValid(request)) return Response.json({ error: "Admin authentication required." }, { status: 401 });
  return Response.json(getDelhiveryAdminOptions());
}
