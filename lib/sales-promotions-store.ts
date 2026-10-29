import { browserLocalStorage } from "./browser-storage";
import { fetchStoreSetting, saveStoreSetting } from "./supabase/catalog";
import { parseSalesPromotions, type SalesPromotion } from "./sales-promotions";
export const salesPromotionsCacheKey = "fanzzy-sales-promotions";
export async function loadSalesPromotions() {
  const remote = await fetchStoreSetting("salesPromotions");
  let cached: string | null = null;
  try { cached = browserLocalStorage.getItem(salesPromotionsCacheKey); } catch { /* Shared settings can still load. */ }
  const promotions = parseSalesPromotions(remote.error ? cached : remote.value || cached);
  if (!remote.error && remote.value !== null) { try { browserLocalStorage.setItem(salesPromotionsCacheKey, JSON.stringify(promotions)); } catch { /* The shared store remains authoritative. */ } }
  return { promotions, local: Boolean(remote.error) };
}
export async function saveSalesPromotions(promotions: SalesPromotion[]) {
  const error = await saveStoreSetting("salesPromotions", JSON.stringify(promotions));
  if (error && process.env.NEXT_PUBLIC_FANZZY_ENV !== "local-test") throw new Error("Could not save promotions to the store. Please try again.");
  try { browserLocalStorage.setItem(salesPromotionsCacheKey, JSON.stringify(promotions)); } catch { if (error) throw new Error("Could not save promotions on this device."); }
  window.dispatchEvent(new Event("fanzzy-sales-promotions-updated"));
  return { local: Boolean(error) };
}
