import { isAdminSessionValid } from "../../../../lib/admin-auth";
import { readTransactionalOrders, checkoutRpc, CheckoutError } from "../../../../lib/transactional-checkout";
import { publicCheckoutOrder } from "../../../../lib/checkout-http";
export async function GET(request: Request) {
  if (!isAdminSessionValid(request)) return Response.json({ error: "Admin authentication required." }, { status: 401 });
  try { return Response.json({ orders: (await readTransactionalOrders()).map(publicCheckoutOrder) }, { headers: { "cache-control": "no-store" } }); }
  catch (error) {
    if (process.env.FANZZY_ENV === "local-test") console.error("Local orders backend:", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Orders unavailable." }, { status: 503 });
  }
}
export async function PATCH(request: Request) {
  if (!isAdminSessionValid(request)) return Response.json({ error: "Admin authentication required." }, { status: 401 });
  try {
    const data = await request.json() as { patches?: unknown; created?: unknown };
    const orders = await checkoutRpc<Array<Parameters<typeof publicCheckoutOrder>[0]>>("admin_patch", "", "", data);
    return Response.json({ saved: true, orders: orders.map(publicCheckoutOrder) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Order changes could not be saved." }, { status: error instanceof CheckoutError ? error.status : 409 }); }
}
