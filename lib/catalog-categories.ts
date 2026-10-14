type CategoryRecord = {
  name: string;
  section?: "normal" | "luxury";
  image?: string;
};

/** Preserve the first source's metadata, filling missing images from later copies. */
export function mergeCatalogCategories<T extends CategoryRecord>(...sources: T[][]): T[] {
  const categories = new Map<string, T>();
  for (const source of sources) {
    for (const category of source) {
      if (!category || typeof category.name !== "string" || !category.name.trim()) continue;
      const name = category.name.trim();
      const section = category.section === "luxury" ? "luxury" : "normal";
      const key = `${name.toLowerCase()}::${section}`;
      const previous = categories.get(key);
      if (!previous) categories.set(key, { ...category, name, section });
      else if (!previous.image && category.image) categories.set(key, { ...previous, image: category.image });
    }
  }
  return [...categories.values()];
}

const baseCategory = (name: string) => name.replace(/\s*·\s*lx\s*$/i, "").trim();

const categoryFilterKey = (name: string) =>
  baseCategory(name)
    .toLowerCase()
    .replace(/\b(luxury|luxurious|premium)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const isGenericLuxuryCategoryName = (name: string) => {
  const key = baseCategory(name).toLowerCase().replace(/[^a-z0-9]+/g, "");
  return ["luxury", "luxurious", "luxuary", "luxuaries", "premium"].includes(key);
};

export const countProductsByCategoryKey = (products: Array<{ category: string }>) => products.reduce<Record<string, number>>((counts, product) => {
  const rawCategory = product.category.trim();
  const keys = new Set([
    rawCategory.toLowerCase(),
    baseCategory(rawCategory).toLowerCase(),
    categoryFilterKey(rawCategory),
  ].filter(Boolean));
  if (/\s*·\s*lx\s*$/i.test(rawCategory)) keys.add("__luxury__");
  keys.forEach((key) => { counts[key] = (counts[key] || 0) + 1; });
  return counts;
}, {});

/** Build once per category snapshot; each product lookup is then constant-time. */
export function createProductCategoryResolver(categories: CategoryRecord[]) {
  const sections = new Map<string, Set<string>>();
  for (const category of categories) {
    const key = baseCategory(category.name).toLowerCase();
    let values = sections.get(key);
    if (!values) sections.set(key, values = new Set());
    values.add(category.section || "normal");
  }
  return (category: string) => {
    const name = baseCategory(category);
    if (!name) return "";
    const values = sections.get(name.toLowerCase());
    const luxury = /\s*·\s*lx\s*$/i.test(category.trim()) || (values?.size === 1 && values.has("luxury"));
    return luxury ? `${name} · LX` : name;
  };
}
