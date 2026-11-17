/** Ownership is independent of publication approval; neither is a merchandising override. */
export type CatalogScope = "all" | "public" | "general" | { vendorId: string };

type VisibilityProduct = {
  vendor_id?: unknown; vendorId?: unknown;
  vendor_status?: unknown; vendorStatus?: unknown;
  public_vendor_visible?: unknown; publicVendorVisible?: unknown;
  status?: unknown;
};

export function isCatalogProductVisible(product: VisibilityProduct, scope: CatalogScope): boolean {
  if (scope === "all") return true;
  if (product.status === "Draft") return false;
  const vendorId = product.vendor_id ?? product.vendorId;
  const owned = typeof vendorId === "string" && Boolean(vendorId.trim());
  if (scope === "general") return !owned;
  if (typeof scope === "object" && (!owned || vendorId !== scope.vendorId)) return false;
  if (!owned) return true;
  return (product.vendor_status ?? product.vendorStatus) === "Approved"
    && (product.public_vendor_visible ?? product.publicVendorVisible) === true;
}

/** Apply before ordering, pagination and category counting, including cached snapshots. */
export function filterCatalogProducts<T extends VisibilityProduct>(products: T[], scope: CatalogScope): T[] {
  return products.filter((product) => isCatalogProductVisible(product, scope));
}
