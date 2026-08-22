import { clearVendorSessionCookie, getVendorSession, logoutVendor } from "../../../../lib/vendor-server";

export async function POST(request: Request) {
  await logoutVendor(request).catch(() => undefined);
  await getVendorSession(request).catch(() => null);
  return Response.json({ authenticated: false }, { headers: { "set-cookie": clearVendorSessionCookie() } });
}
