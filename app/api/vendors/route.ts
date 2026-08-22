import { isAdminSessionValid } from "../../../lib/admin-auth";
import { createVendor, listPublicVendors, VendorDataError } from "../../../lib/vendor-server";

const json = (body: Record<string, unknown>, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export async function GET() {
  try { return json({ vendors: await listPublicVendors() }); }
  catch (error) { const status = error instanceof VendorDataError ? error.status : 500; return json({ error: error instanceof VendorDataError ? error.message : "Could not load vendors." }, status); }
}

export async function POST(request: Request) {
  if (!isAdminSessionValid(request)) return json({ error: "Admin authentication required." }, 401);
  try {
    const body = await request.json() as Record<string, unknown>;
    const vendor = await createVendor(body, "admin-session");
    return json({ vendor }, 201);
  } catch (error) {
    const status = error instanceof VendorDataError ? error.status : 500;
    return json({ error: error instanceof VendorDataError ? error.message : "Could not create vendor." }, status);
  }
}
