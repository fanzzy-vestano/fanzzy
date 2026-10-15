export type CatalogCategorySection = "normal" | "luxury";

export type CategoryCountCategory = {
  name: string;
  section?: CatalogCategorySection;
};

export type CategoryCountProduct = {
  category: string;
  vendorId?: unknown;
  vendor_id?: unknown;
};

export const isLuxuryProductCategory = (category: string) => /\s*·\s*lx\s*$/i.test(category.trim());
export const baseProductCategory = (category: string) => category.replace(/\s*·\s*lx\s*$/i, "").trim();

export const productCategorySection = (
  productCategory: string,
  categories: CategoryCountCategory[],
): CatalogCategorySection => {
  if (isLuxuryProductCategory(productCategory)) return "luxury";
  const categoryName = baseProductCategory(productCategory).toLowerCase();
  const matchingSections = new Set(
    categories
      .filter((category) => baseProductCategory(category.name).toLowerCase() === categoryName)
      .map((category) => category.section || "normal"),
  );
  return matchingSections.size === 1 && matchingSections.has("luxury") ? "luxury" : "normal";
};

export const countAdminCategoryProducts = (
  category: CategoryCountCategory,
  categories: CategoryCountCategory[],
  products: CategoryCountProduct[],
) => products.filter((product) => {
  const vendorId = product.vendorId ?? product.vendor_id;
  if (typeof vendorId === "string" && vendorId.trim()) return false;
  return baseProductCategory(product.category).toLowerCase() === baseProductCategory(category.name).toLowerCase() &&
    productCategorySection(product.category, categories) === (category.section || "normal");
}).length;
