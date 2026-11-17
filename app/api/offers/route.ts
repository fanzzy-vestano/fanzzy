import { getCustomerSession } from "../../../lib/customer-sms-auth";
import { websitePromotionCustomerContext } from "../../../lib/razorpay-payment-sync";
import { parseSalesPromotions } from "../../../lib/sales-promotions";

export async function GET(request: Request) {
  const headers = { "cache-control": "private, no-store", "content-type": "application/json" };
  try {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !key) throw new Error("Store offers are unavailable.");
    const response = await fetch(`${base}/rest/v1/store_settings?key=eq.sales_promotions&select=value`, { cache: "no-store", headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!response.ok) throw new Error("Store offers are unavailable.");
    const rows = await response.json() as Array<{ value: string }>;
    const requestedCoupon = new URL(request.url).searchParams.get("coupon")?.trim().toUpperCase();
    const promotions = parseSalesPromotions(rows[0]?.value || null).filter((promotion) => (promotion.status === "Active" || promotion.status === "Scheduled") && (promotion.type !== "coupon" || promotion.couponCode.toUpperCase() === requestedCoupon));
    const identity = getCustomerSession(request);
    let firstPurchaseEligible = false;
    if (identity && promotions.some((promotion) => promotion.type === "first")) {
      try { const context = await websitePromotionCustomerContext(identity); firstPurchaseEligible = context.historyAvailable && context.previousCustomerPhones.length === 0; } catch { /* First-purchase eligibility requires authoritative history. */ }
    }
    return new Response(JSON.stringify({ promotions, firstPurchaseEligible }), { headers });
  } catch {
    return new Response(JSON.stringify({ error: "Store offers could not be loaded." }), { status: 503, headers });
  }
}
