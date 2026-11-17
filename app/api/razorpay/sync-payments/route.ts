import { isAdminSessionValid } from "../../../../lib/admin-auth";
import { reconcileRazorpayAttempts } from "../../../../lib/razorpay-provider";
import { processCheckoutOutbox, reconcilePendingOrderInventory } from "../../../../lib/razorpay-payment-sync";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function POST(request: Request) {
  if (!isAdminSessionValid(request)) return json({ error: "Admin authentication required." }, 401);
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return json({ error: "Razorpay is not configured on the server" }, 503);
  try {
    // Inspect saved attempts only; never import unrelated account payments or
    // repeat provider creation after an ambiguous result.
    const payments = await reconcileRazorpayAttempts();
    const inventory = await reconcilePendingOrderInventory();
    const fulfillment = await processCheckoutOutbox();
    return json({ synced: payments.captured, payments, inventory, fulfillment });
  } catch {
    return json({ error: "Payment reconciliation could not complete. Saved attempts remain available for review." }, 503);
  }
}
