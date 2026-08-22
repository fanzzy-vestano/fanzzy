import { VendorDataError, loginVendor } from "../../../../lib/vendor-server";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: unknown; password?: unknown };
    const result = await loginVendor(typeof body.email === "string" ? body.email : "", typeof body.password === "string" ? body.password : "", request);
    return Response.json({ authenticated: true, vendor: { id: result.vendor.id, slug: result.vendor.slug, businessName: result.vendor.business_name } }, { headers: { "set-cookie": result.cookie } });
  } catch (error) {
    const status = error instanceof VendorDataError ? error.status : 500;
    return Response.json({ error: error instanceof VendorDataError ? error.message : "Vendor login is temporarily unavailable." }, { status });
  }
}
