import { browserLocalStorage } from "./browser-storage";

const guestCartKey = "fanzzy-cart:guest";
const transferKey = "fanzzy-cart-transfer";

function cartSnapshot(raw: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key, quantity]) =>
      /^[a-z0-9-]{1,128}$/.test(key) && typeof quantity === "number" &&
      Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 999));
  } catch { return {}; }
}

// A full page navigation would lose an in-memory cart. Carry only product IDs
// and quantities in the fragment (never tokens, prices, or customer details).
export function storefrontCartUrl(action: "buy" | "view"): string {
  const target = "/?fanzzy-cart-action=" + action;
  if (typeof window === "undefined") return target;
  const raw = browserLocalStorage.getItem(guestCartKey) || "{}";
  if (browserLocalStorage.isPersistent(guestCartKey)) return target;
  return target + "#" + transferKey + "=" + encodeURIComponent(JSON.stringify(cartSnapshot(raw)));
}

export function receiveTransferredGuestCart(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const raw = fragment.get(transferKey);
  if (raw === null) return;
  const incoming = cartSnapshot(raw);
  const existing = cartSnapshot(browserLocalStorage.getItem(guestCartKey) || "{}");
  for (const [key, quantity] of Object.entries(incoming)) existing[key] = Math.max(existing[key] || 0, quantity);
  browserLocalStorage.setItem(guestCartKey, JSON.stringify(existing));
  url.hash = "";
  window.history.replaceState(window.history.state, "", url.href);
}
