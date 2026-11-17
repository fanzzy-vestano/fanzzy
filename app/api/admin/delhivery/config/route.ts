import { isAdminSessionValid } from "../../../../../lib/admin-auth";
import { loadDelhiveryAdminOptions } from "../../../../../lib/delhivery";

export async function GET(request: Request) {
  if (!isAdminSessionValid(request)) return Response.json({ error: "Admin authentication required." }, { status: 401 });
  try {
    return Response.json(await loadDelhiveryAdminOptions(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Could not load registered Delhivery pickup locations. Check the Delhivery One integration and retry." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
