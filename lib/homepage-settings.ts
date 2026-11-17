import { fetchStoreSettings } from "./supabase/catalog";

type HomepageSettings = Awaited<ReturnType<typeof readHomepageSettings>>;
const readHomepageSettings = () => fetchStoreSettings(["heroSlides", "heroImage", "heroSlideDuration"] as const);
let pending: Promise<HomepageSettings> | undefined;

// The slides and timing effects mount together. Share only their in-flight
// read; later storage/admin events must always see the current settings.
export function fetchHomepageSettings() {
  if (!pending) {
    const request = readHomepageSettings();
    pending = request;
    const clear = () => { if (pending === request) pending = undefined; };
    void request.then(clear, clear);
  }
  return pending;
}
