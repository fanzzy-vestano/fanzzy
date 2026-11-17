export const PUBLIC_CATALOG_VERSION = 1;

export type PublicCatalogSection = "normal" | "luxury";
export type PublicProductStatus = "Published" | "Low stock";
export type ProductVariantType = "normal" | "size";

export type PublicImageAdjustments = {
  zoom: number;
  x: number;
  y: number;
  rotate: number;
};

export type PublicCatalogVariant = {
  name: string;
  size?: string;
  image?: string;
  stock?: number;
  adjustments?: PublicImageAdjustments;
};

export type PublicCatalogProduct = {
  sku: string;
  name: string;
  category: string;
  section: PublicCatalogSection;
  stock: number;
  price: number;
  storedCompareAt?: number;
  displayCompareAt: number;
  displayDiscountPercent: number;
  status: PublicProductStatus;
  badges: {
    tag?: string;
    lowStock: boolean;
    soldOut: boolean;
    discountPercent?: number;
    luxury: boolean;
  };
  images: {
    primary: string;
    hover?: string;
    tone?: string;
    adjustments?: PublicImageAdjustments;
    hoverAdjustments?: PublicImageAdjustments;
  };
  variants: PublicCatalogVariant[];
  sizes: string[];
  sizeStock: Record<string, number>;
  variantType: ProductVariantType;
  vendor?: {
    id: string;
    name: string;
    slug: string;
    visible: true;
  };
};

export type PublicCatalogCategory = {
  name: string;
  count: string;
  pieces: number;
  image?: string;
  sortOrder: number;
  section: PublicCatalogSection;
};

export type PublicCatalogVendor = {
  id: string;
  slug: string;
  businessName: string;
  logoUrl?: string;
  coverUrl?: string;
  description?: string;
  featured: boolean;
  visible: true;
};

export type PublicCatalogResponse = {
  version: typeof PUBLIC_CATALOG_VERSION;
  generatedAt: string;
  products: PublicCatalogProduct[];
  categories: PublicCatalogCategory[];
  vendors: PublicCatalogVendor[];
  meta: {
    source: "fanzzy-catalog";
    hasMore: false;
    nextCursor: null;
    unresolved: string[];
  };
};

export type PublicCatalogMapperInput = {
  generatedAt?: string;
  products?: Array<Record<string, unknown>>;
  categories?: Array<Record<string, unknown>>;
  vendors?: Array<Record<string, unknown>>;
  settings?: Partial<Record<PublicCatalogSettingKey, string | null | undefined>>;
};

type PublicCatalogSettingKey =
  | "categoryCatalog"
  | "productVariants"
  | "productVariantType"
  | "productSizes"
  | "productSizeStock"
  | "productImageAdjustments"
  | "vendorCategoryNames";

const demoProductNames = new Set([
  "aurora drop earrings",
  "solstice tennis necklace",
  "muse sculpted cuff",
  "orbital pearl ring",
]);

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const optionalText = (value: unknown) => {
  const normalized = text(value);
  return normalized || undefined;
};

const numberOr = (value: unknown, fallback = 0) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const wholeNumberOr = (value: unknown, fallback = 0) => Math.max(0, Math.floor(numberOr(value, fallback)));

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function normalizePublicImageAdjustments(value: unknown): PublicImageAdjustments {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    zoom: clamp(numberOr(source.zoom, 1), 1, 2),
    x: clamp(numberOr(source.x, 0), -50, 50),
    y: clamp(numberOr(source.y, 0), -50, 50),
    rotate: clamp(numberOr(source.rotate, 0), -180, 180),
  };
}

const parseJsonRecord = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as T : fallback;
  } catch {
    return fallback;
  }
};

const parseJsonArray = <T>(value: string | null | undefined, fallback: T[]): T[] => {
  if (!value) return fallback;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : fallback;
  } catch {
    return fallback;
  }
};

const normalizeProductKey = (value?: string) => String(value || "").trim().replace(/[^a-z0-9]/gi, "").toLowerCase();

const productKey = (row: Record<string, unknown>) => text(row.sku) || text(row.id);

const settingForProduct = <T>(settings: Record<string, T>, row: Record<string, unknown>) => {
  const candidates = [text(row.sku), text(row.id)].filter(Boolean);
  for (const candidate of candidates) {
    if (settings[candidate] !== undefined) return settings[candidate];
  }
  const normalized = new Set(candidates.map(normalizeProductKey).filter(Boolean));
  return Object.entries(settings).find(([key]) => normalized.has(normalizeProductKey(key)))?.[1];
};

const baseCategory = (category: string) => category.replace(/\s*·\s*lx\s*$/i, "").trim();

const categoryFilterKey = (name: string) =>
  baseCategory(name)
    .toLowerCase()
    .replace(/\b(luxury|luxurious|premium)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const makeCategoryIdentity = (name: string, section: PublicCatalogSection) =>
  `${categoryFilterKey(name) || baseCategory(name).toLowerCase()}::${section}`;

const isDemoProduct = (product: { name?: unknown; sku?: unknown }) =>
  demoProductNames.has(String(product.name ?? "").trim().toLowerCase()) ||
  /^LST-(AUR|SOL|MUS|ORB)-\d+$/i.test(String(product.sku ?? ""));

const getDisplayDiscountPercent = (product: { id?: string; sku?: string; price: number }) => {
  const salePrice = Number(product.price);
  if (!Number.isFinite(salePrice) || salePrice <= 0) return 0;
  const key = normalizeProductKey(product.id || product.sku);
  const maxExclusive = salePrice < 100 ? 9 : 10;
  const hash = Array.from(key).reduce((total, character) => (total * 31 + character.charCodeAt(0)) % maxExclusive, 0);
  return (salePrice < 100 ? 68 : 51) + hash;
};

const getDisplayComparePrice = (product: { id?: string; sku?: string; price: number }) => {
  const salePrice = Number(product.price);
  const discount = getDisplayDiscountPercent(product);
  if (!Number.isFinite(salePrice) || salePrice <= 0 || discount <= 0) return salePrice;
  const idealMrp = Math.max(salePrice + 1, Math.ceil(salePrice / (1 - discount / 100)));
  for (let mrp = Math.max(salePrice + 1, idealMrp - 2); mrp <= idealMrp + 2; mrp += 1) {
    if (Math.round(((mrp - salePrice) / mrp) * 100) === discount) return mrp;
  }
  return idealMrp;
};

const storedCompareAt = (value: unknown) => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = numberOr(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const mapVisibleVendors = (vendors: Array<Record<string, unknown>>) => {
  const map = new Map<string, PublicCatalogVendor>();
  for (const vendor of vendors) {
    if (text(vendor.status) !== "Active" || text(vendor.store_visibility) !== "Visible") continue;
    const id = text(vendor.id);
    const slug = text(vendor.slug);
    const businessName = text(vendor.business_name);
    if (!id || !slug || !businessName) continue;
    map.set(id, {
      id,
      slug,
      businessName,
      logoUrl: optionalText(vendor.logo_url),
      coverUrl: optionalText(vendor.cover_url),
      description: optionalText(vendor.description),
      featured: vendor.featured === true,
      visible: true,
    });
  }
  return map;
};

const inferLegacyCategorySections = (categories: PublicCatalogCategory[]) => {
  if (categories.some((category) => category.section === "luxury")) return categories;
  const luxuryNames = new Set(
    categories
      .filter((category) => /luxur|premium/i.test(category.name.trim()))
      .slice(0, 2)
      .map((category) => category.name.trim().toLowerCase()),
  );
  if (!luxuryNames.size) return categories;
  return categories.map((category) => ({
    ...category,
    section: luxuryNames.has(category.name.trim().toLowerCase()) ? "luxury" as const : category.section,
  }));
};

const mapCategories = (
  rows: Array<Record<string, unknown>>,
  sharedCategorySetting: string | null | undefined,
): PublicCatalogCategory[] => {
  const shared = parseJsonArray<Record<string, unknown>>(sharedCategorySetting, []);
  const categories: PublicCatalogCategory[] = [];
  [...rows, ...shared].forEach((row, index) => {
    const name = text(row.name);
    if (!name) return;
    const section: PublicCatalogSection = row.section === "luxury" ? "luxury" : "normal";
    const identity = makeCategoryIdentity(name, section);
    const pieces = wholeNumberOr(row.pieces);
    const nextCategory: PublicCatalogCategory = {
      name,
      pieces,
      count: `${pieces} pieces`,
      image: optionalText(row.image),
      sortOrder: wholeNumberOr(row.sort_order ?? row.sortOrder, index),
      section,
    };
    const existingIndex = categories.findIndex((category) => makeCategoryIdentity(category.name, category.section) === identity);
    if (existingIndex >= 0) {
      const previous = categories[existingIndex];
      categories[existingIndex] = {
        ...previous,
        image: previous.image || nextCategory.image,
        pieces: previous.pieces || nextCategory.pieces,
        count: previous.pieces ? previous.count : nextCategory.count,
        sortOrder: Math.min(previous.sortOrder, nextCategory.sortOrder),
      };
      return;
    }
    categories.push(nextCategory);
  });
  return inferLegacyCategorySections(categories).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
};

const isLuxuryCategory = (category: string, knownCategories: PublicCatalogCategory[]) => {
  if (/\s*·\s*lx\s*$/i.test(category)) return true;
  const exact = baseCategory(category).toLowerCase();
  if (knownCategories.some((item) => baseCategory(item.name).toLowerCase() === exact && item.section === "luxury")) return true;
  const key = categoryFilterKey(category) || exact;
  const matches = knownCategories.filter((item) => (categoryFilterKey(item.name) || baseCategory(item.name).toLowerCase()) === key);
  return matches.length === 1 && matches[0].section === "luxury";
};

const isPublicProduct = (row: Record<string, unknown>, vendors: Map<string, PublicCatalogVendor>) => {
  if (isDemoProduct(row)) return false;
  const status = text(row.status) || "Published";
  if (status === "Draft") return false;
  const vendorId = text(row.vendor_id);
  if (!vendorId) return true;
  return text(row.vendor_status) === "Approved" && row.public_vendor_visible === true && vendors.has(vendorId);
};

const mapVariant = (value: unknown, adjustments?: PublicImageAdjustments): PublicCatalogVariant | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const name = text(row.name);
  const size = optionalText(row.size);
  const image = optionalText(row.image);
  const stock = row.stock === undefined || row.stock === null || row.stock === "" ? undefined : wholeNumberOr(row.stock);
  if (!name && !size && !image) return null;
  return {
    name: name || size || "Option",
    size,
    image,
    stock,
    adjustments: adjustments || normalizePublicImageAdjustments(row.adjustments),
  };
};

export function buildPublicCatalogResponse(input: PublicCatalogMapperInput): PublicCatalogResponse {
  const settings = input.settings || {};
  const vendors = mapVisibleVendors(input.vendors || []);
  const initialCategories = mapCategories(input.categories || [], settings.categoryCatalog);
  const variantMap = parseJsonRecord<Record<string, unknown[]>>(settings.productVariants, {});
  const variantTypeMap = parseJsonRecord<Record<string, ProductVariantType>>(settings.productVariantType, {});
  const sizesMap = parseJsonRecord<Record<string, string[]>>(settings.productSizes, {});
  const sizeStockMap = parseJsonRecord<Record<string, Record<string, number>>>(settings.productSizeStock, {});
  const adjustmentsMap = parseJsonRecord<Record<string, { image?: unknown; hoverImage?: unknown; variants?: unknown[] }>>(settings.productImageAdjustments, {});
  const vendorCategoryNames = parseJsonArray<string>(settings.vendorCategoryNames, []);
  const vendorCategoryKeys = new Set(
    vendorCategoryNames
      .map((name) => categoryFilterKey(String(name)) || baseCategory(String(name)).toLowerCase())
      .filter(Boolean),
  );

  const products = (input.products || [])
    .filter((row) => isPublicProduct(row, vendors))
    .map((row): PublicCatalogProduct | null => {
      const sku = productKey(row);
      const name = text(row.name);
      if (!sku || !name) return null;
      const category = text(row.category) || "Uncategorised";
      const stock = wholeNumberOr(row.stock);
      const price = numberOr(row.price);
      const savedAdjustments = settingForProduct(adjustmentsMap, row);
      const rawVariants = settingForProduct(variantMap, row) || [];
      const variants = Array.isArray(rawVariants)
        ? rawVariants.map((variant, index) => mapVariant(variant, savedAdjustments?.variants?.[index] ? normalizePublicImageAdjustments(savedAdjustments.variants[index]) : undefined)).filter((variant): variant is PublicCatalogVariant => Boolean(variant))
        : [];
      const sizes = (settingForProduct(sizesMap, row) || []).filter((size): size is string => typeof size === "string" && Boolean(size.trim()));
      const sizeStock = Object.fromEntries(
        Object.entries(settingForProduct(sizeStockMap, row) || {}).map(([size, value]) => [size, wholeNumberOr(value)]),
      );
      const inferredSizes = sizes.length ? sizes : Array.from(new Set(variants.map((variant) => variant.size).filter((size): size is string => Boolean(size))));
      const inferredSizeStock = Object.keys(sizeStock).length
        ? sizeStock
        : Object.fromEntries(variants.filter((variant) => variant.size && variant.stock !== undefined).map((variant) => [variant.size!, variant.stock!]));
      const variantType = settingForProduct(variantTypeMap, row) || (inferredSizes.length ? "size" : "normal");
      const displayStock = variantType === "size" && inferredSizes.length
        ? inferredSizes.reduce((total, size) => total + wholeNumberOr(inferredSizeStock[size], 0), 0)
        : variantType === "normal" && variants.length
          ? variants.reduce((total, variant) => total + wholeNumberOr(variant.stock, 0), 0)
          : stock;
      const section: PublicCatalogSection = isLuxuryCategory(category, initialCategories) ? "luxury" : "normal";
      const soldOut = variantType === "size" && inferredSizes.length
        ? inferredSizes.every((size) => wholeNumberOr(inferredSizeStock[size], stock) <= 0)
        : variantType === "normal" && variants.length
          ? variants.every((variant) => wholeNumberOr(variant.stock, stock) <= 0)
          : stock <= 0;
      const vendorId = text(row.vendor_id);
      const vendor = vendorId ? vendors.get(vendorId) : undefined;
      const displayDiscountPercent = getDisplayDiscountPercent({ id: text(row.id), sku: text(row.sku), price });
      const displayCompareAt = getDisplayComparePrice({ id: text(row.id), sku: text(row.sku), price });

      return {
        sku,
        name,
        category,
        section,
        stock: displayStock,
        price,
        storedCompareAt: storedCompareAt(row.compare_at),
        displayCompareAt,
        displayDiscountPercent,
        status: row.status === "Low stock" ? "Low stock" : "Published",
        badges: {
          tag: optionalText(row.tag),
          lowStock: row.status === "Low stock" || displayStock === 1,
          soldOut,
          discountPercent: displayDiscountPercent,
          luxury: section === "luxury",
        },
        images: {
          primary: text(row.image),
          hover: optionalText(row.hover_image) || optionalText(row.image),
          tone: optionalText(row.tone),
          adjustments: savedAdjustments?.image ? normalizePublicImageAdjustments(savedAdjustments.image) : undefined,
          hoverAdjustments: savedAdjustments?.hoverImage ? normalizePublicImageAdjustments(savedAdjustments.hoverImage) : undefined,
        },
        variants,
        sizes: inferredSizes,
        sizeStock: inferredSizeStock,
        variantType,
        vendor: vendor ? { id: vendor.id, name: vendor.businessName, slug: vendor.slug, visible: true } : undefined,
      };
    })
    .filter((product): product is PublicCatalogProduct => Boolean(product));

  const productCounts = new Map<string, number>();
  const categoryByIdentity = new Map(initialCategories.map((category) => [makeCategoryIdentity(category.name, category.section), category]));
  for (const product of products) {
    const base = baseCategory(product.category);
    const baseKey = categoryFilterKey(base) || base.toLowerCase();
    if (product.vendor || vendorCategoryKeys.has(baseKey)) continue;
    const identity = makeCategoryIdentity(base, product.section);
    productCounts.set(identity, (productCounts.get(identity) || 0) + 1);
    if (!categoryByIdentity.has(identity)) {
      categoryByIdentity.set(identity, {
        name: base,
        pieces: 0,
        count: "0 pieces",
        sortOrder: initialCategories.length + categoryByIdentity.size,
        section: product.section,
      });
    }
  }

  const categories = [...categoryByIdentity.values()].map((category) => {
    const count = productCounts.get(makeCategoryIdentity(category.name, category.section));
    return count === undefined ? category : { ...category, pieces: count, count: `${count} pieces` };
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  return {
    version: PUBLIC_CATALOG_VERSION,
    generatedAt: input.generatedAt || new Date(0).toISOString(),
    products,
    categories,
    vendors: [...vendors.values()],
    meta: {
      source: "fanzzy-catalog",
      hasMore: false,
      nextCursor: null,
      unresolved: [
        "Exact production image-host allowlist must be approved before live mobile use.",
        "Invoice display names are intentionally excluded until classified as public-safe or internal.",
        "Offer shaping is intentionally excluded from this base catalog contract.",
      ],
    },
  };
}
