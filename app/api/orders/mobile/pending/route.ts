import { createPendingCheckout } from "../../../../../lib/checkout-http";
export const POST = (request: Request) => createPendingCheckout(request, false);
