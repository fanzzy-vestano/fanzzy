import { isAdminSessionValid } from "../../../../lib/admin-auth";
import { createVendorPayout, listVendorPayouts, VendorDataError } from "../../../../lib/vendor-server";

export async function GET(request: Request) {
  if (!isAdminSessionValid(request)) return Response.json({ error: "Admin authentication required." }, { status: 401 });
  const vendorId = new URL(request.url).searchParams.get("vendorId") || "";
  if (!vendorId) return Response.json({ error: "vendorId is required." }, { status: 400 });
  try { return Response.json({ payouts: await listVendorPayouts(vendorId) }); }
  catch (error) { const status = error instanceof VendorDataError ? error.status : 500; return Response.json({ error: error instanceof VendorDataError ? error.message : "Could not load payouts." }, { status }); }
}

export async function POST(request: Request) {
  if (!isAdminSessionValid(request)) return Response.json({ error: "Admin authentication required." }, { status: 401 });
  try { const body = await request.json() as { vendorId?: unknown; orderIds?: unknown; paymentMethod?: unknown; transactionReference?: unknown; amount?: unknown; adjustmentAmount?: unknown; adjustmentReason?: unknown; status?: unknown }; if (typeof body.vendorId !== "string" || !Array.isArray(body.orderIds)) return Response.json({ error: "vendorId and orderIds are required." }, { status: 400 }); return Response.json({ payout: await createVendorPayout(body.vendorId, body.orderIds.filter((id): id is string => typeof id === "string"), { paymentMethod: typeof body.paymentMethod === "string" ? body.paymentMethod : undefined, transactionReference: typeof body.transactionReference === "string" ? body.transactionReference : undefined, amount: Number(body.amount) || undefined, adjustmentAmount: Number(body.adjustmentAmount) || undefined, adjustmentReason: typeof body.adjustmentReason === "string" ? body.adjustmentReason : undefined, status: typeof body.status === "string" ? body.status : undefined }, "admin-session") }, { status: 201 }); }
  catch (error) { const status = error instanceof VendorDataError ? error.status : 500; return Response.json({ error: error instanceof VendorDataError ? error.message : "Could not create payout." }, { status }); }
}
