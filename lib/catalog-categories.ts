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
