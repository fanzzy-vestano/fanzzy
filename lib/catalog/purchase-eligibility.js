/** Base catalogue eligibility is independent of a promotion's allocated line price. */
/** @param {unknown} value */
export function hasValidSellingPrice(value) {
  if (typeof value !== "number" && typeof value !== "string") return false;
  if (typeof value === "string" && !value.trim()) return false;
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

/**
 * @param {Array<{productId?: string, quantity: number}> | undefined} items
 * @param {Array<{sku?: string, price?: unknown}>} products
 */
export function hasUnavailablePurchasePrice(items, products) {
  const key = (value) => String(value || "").trim().replace(/[^a-z0-9]/gi, "").toLowerCase();
  const bySku = new Map(products.map((product) => [key(product.sku), product]));
  return (items || []).some((item) => Number(item.quantity) > 0
    && !hasValidSellingPrice(bySku.get(key(item.productId))?.price));
}
