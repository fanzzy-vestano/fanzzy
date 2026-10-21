// Browser persistence is an optimization. Checkout state remains in React
// memory when storage is full, blocked, or unavailable.
export function writeOptionalBrowserCache(key: string, value: unknown): boolean {
  try {
    if (typeof window === "undefined") return false;
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeOptionalBrowserCache(key: string): void {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
  } catch {
    // Removing an obsolete cart cache must not interrupt an in-memory cart.
  }
}
