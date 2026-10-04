import { deleteVendorCategory, getVendorSession, saveVendorCategory, VendorDataError } from "../../../../lib/vendor-server";

const errorResponse = (error: unknown, fallback: string) => {
  const status = error instanceof VendorDataError ? error.status : 500;
  return Response.json({ error: error instanceof VendorDataError ? error.message : fallback }, { status });
};

export async function POST(request: Request) {
  try {
    const session = await getVendorSession(request);
    if (!session) return Response.json({ error: "Vendor authentication required." }, { status: 401 });
    return Response.json({ categories: await saveVendorCategory(session.vendorId, await request.json()) });
  } catch (error) {
    return errorResponse(error, "Could not save vendor category.");
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getVendorSession(request);
    if (!session) return Response.json({ error: "Vendor authentication required." }, { status: 401 });
    const body = await request.json() as { name?: string };
    return Response.json({ categories: await deleteVendorCategory(session.vendorId, body.name || "") });
  } catch (error) {
    return errorResponse(error, "Could not delete vendor category.");
  }
}
