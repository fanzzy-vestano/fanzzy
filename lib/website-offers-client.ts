import { fetchStoreOrders, fetchStoreSetting } from "./supabase/catalog";
import { parseSalesPromotions, type PromotionBillContext, type SalesPromotion } from "./sales-promotions";

export type WebsiteOffersSnapshot = {
  promotions: SalesPromotion[];
  context: PromotionBillContext;
};

/** Read shared settings only. Never use admin/device caches as live offers. */
export async function loadWebsiteOffers(customer?: { id: string; phone: string } | null): Promise<WebsiteOffersSnapshot> {
  const remote = await fetchStoreSetting("salesPromotions");
  if (remote.error) throw new Error("Offers could not be checked. Please try again.");
  const promotions = parseSalesPromotions(remote.value);
  const context: PromotionBillContext = { customerPhone: customer?.phone, historyAvailable: false };
  if (customer && promotions.some((promotion) => promotion.type === "first")) {
    const history = await fetchStoreOrders<{ userId?: string; userPhone?: string; phone?: string; paymentStatus?: string; razorpayPaymentId?: string }>({ includeDeleted: true });
    if (!history.error && history.data) {
      const phone = (value?: string) => (value || "").replace(/\D/g, "").slice(-10);
      const purchased = history.data.some((order) =>
        (order.userId === customer.id || [order.userPhone, order.phone].some((value) => phone(value).length === 10 && phone(value) === phone(customer.phone)))
        && (["paid", "cod_pending", "cod_collected"].includes(order.paymentStatus || "") || Boolean(order.razorpayPaymentId)));
      context.historyAvailable = true;
      context.previousCustomerPhones = purchased ? [customer.phone] : [];
    }
  }
  return { promotions, context };
}
