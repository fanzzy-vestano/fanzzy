import { isAdminSessionValid } from "../../../../lib/admin-auth";
import { paymentConfigurationError } from "../../../../lib/payment-policy";
import {
  createPosCheckout,
  posCheckoutResponse,
  readPosCheckout,
} from "../../../../supabase/functions/_shared/pos-checkout";

function posCheckout(request: Request) {
  if (!isAdminSessionValid(request)) return posCheckoutResponse({ error: "Admin authentication required." }, 401);
  const error = paymentConfigurationError(process.env);
  if (error) return posCheckoutResponse({ error }, 503);

  const credentials = {
    keyId: process.env.RAZORPAY_KEY_ID || "",
    keySecret: process.env.RAZORPAY_KEY_SECRET || "",
  };
  return request.method === "POST" ? createPosCheckout(request, credentials) : readPosCheckout(request, credentials);
}

export const GET = posCheckout;
export const POST = posCheckout;
