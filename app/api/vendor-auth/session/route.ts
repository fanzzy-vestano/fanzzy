import { getVendorSession, VendorDataError } from "../../../../lib/vendor-server";

export async function GET(request: Request) {
  try {
    const session = await getVendorSession(request);
    if (!session) return Response.json({ authenticated: false }, { status: 401 });
    return Response.json({ authenticated: true, vendor: { id: session.vendor.id, slug: session.vendor.slug, businessName: session.vendor.business_name, status: session.vendor.status } });
  } catch (error) {
    const status = error instanceof VendorDataError ? error.status : 500;
    return Response.json({ error: error instanceof VendorDataError ? error.message : "Could not validate vendor session." }, { status });
  }
}
