import { customerOrderRecords } from "../../../lib/checkout-http";
import { CheckoutError } from "../../../lib/transactional-checkout";
export async function GET(request: Request) {
  try { return Response.json({ orders: await customerOrderRecords(request) }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Orders unavailable." }, { status: error instanceof CheckoutError ? error.status : 503 }); }
}
