import { buildPublicCatalogResponse, type PublicCatalogResponse } from "../../../../lib/catalog/public-catalog-mapper";

type CatalogRows = {
  products: Array<Record<string, unknown>>;
  categories: Array<Record<string, unknown>>;
  vendors: Array<Record<string, unknown>>;
  settings: {
    categoryCatalog?: string | null;
    productVariants?: string | null;
    productVariantType?: string | null;
    productSizes?: string | null;
    productSizeStock?: string | null;
    productImageAdjustments?: string | null;
    vendorCategoryNames?: string | null;
  };
};

type DataLoader = () => Promise<CatalogRows>;
type CatalogReadOperation =
  | "products"
  | "categoriesFull"
  | "categoriesWithoutSection"
  | "categoriesBase"
  | "vendors"
  | "settings"
  | "vendorCategories"
  | "configuration"
  | "mapping";

const localTestReadTimeoutMs = 8_000;

const PRODUCT_SELECT = [
  "sku",
  "name",
  "category",
  "stock",
  "price",
  "status",
  "image",
  "hover_image",
  "compare_at",
  "tag",
  "tone",
  "vendor_id",
  "vendor_status",
  "public_vendor_visible",
].join(",");

const CATEGORY_SELECT = "name,pieces,image,sort_order,section";
const CATEGORY_SELECT_WITHOUT_SECTION = "name,pieces,image,sort_order";
const CATEGORY_SELECT_BASE = "name";
const VENDOR_SELECT = "id,slug,business_name,logo_url,cover_url,description,featured,status,store_visibility";

const settingKeyMap = {
  category_catalog: "categoryCatalog",
  product_variants: "productVariants",
  product_variant_type: "productVariantType",
  product_sizes: "productSizes",
  product_size_stock: "productSizeStock",
  product_image_adjustments: "productImageAdjustments",
} as const;

const catalogCacheHeaders = {
  "content-type": "application/json",
  // Product stock changes as orders are reserved or released. Caching this
  // response makes storefront and mobile stock counts appear unchanged.
  "cache-control": "no-store, max-age=0",
};

const imageHost = "pdrcrkxeyqxqgpwfxqpu.supabase.co";
const imagePathPrefix = "/storage/v1/object/public/fanzzy-assets/";

const safePublicImageUrl = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.host !== imageHost || !url.pathname.startsWith(imagePathPrefix)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
};

const parseVendorCategoryNames = (rows: Array<Record<string, unknown>>) => {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of rows) {
    if (typeof row.value !== "string") continue;
    try {
      const parsed: unknown = JSON.parse(row.value);
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        const name = typeof item === "string"
          ? item.trim()
          : item && typeof item === "object" && !Array.isArray(item)
            ? String((item as Record<string, unknown>).name || "").trim()
            : "";
        const key = name.toLowerCase();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        names.push(name);
      }
    } catch {
      continue;
    }
  }
  return JSON.stringify(names);
};

const publicSettingsFromRows = (
  settingRows: Array<Record<string, unknown>>,
  vendorCategoryRows: Array<Record<string, unknown>>,
): CatalogRows["settings"] => {
  const settings: CatalogRows["settings"] = {};
  for (const row of settingRows) {
    const key = typeof row.key === "string" ? row.key : "";
    const mapped = settingKeyMap[key as keyof typeof settingKeyMap];
    if (!mapped) continue;
    settings[mapped] = typeof row.value === "string" ? row.value : null;
  }
  settings.vendorCategoryNames = parseVendorCategoryNames(vendorCategoryRows);
  return settings;
};

const isLocalTestDiagnosticsEnabled = () => process.env.FANZZY_ENV === "local-test";

const errorCategory = (error: unknown) => {
  if (!error || typeof error !== "object") return "unknown";
  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : "";
  if (code.startsWith("PGRST")) return "postgrest";
  if (code.startsWith("42")) return "schema";
  if (code.startsWith("28") || code === "42501") return "permission";
  if (typeof record.status === "number") return `http-${record.status}`;
  if (typeof record.name === "string") return record.name;
  return "unknown";
};

const logCatalogDiagnostic = (operation: CatalogReadOperation, category: string, elapsedMs?: number) => {
  if (!isLocalTestDiagnosticsEnabled()) return;
  console.error(`[public-catalog:local-test] operation=${operation} category=${category}${elapsedMs === undefined ? "" : ` elapsedMs=${elapsedMs}`}`);
};

const publicCatalogReadError = (operation: CatalogReadOperation, error: unknown) => {
  logCatalogDiagnostic(operation, errorCategory(error));
  return new Error(`Public catalog read failed at ${operation}.`);
};

const throwOnError = (operation: CatalogReadOperation, result: { error?: unknown }) => {
  if (result.error) throw publicCatalogReadError(operation, result.error);
};

const isSchemaError = (result: { error?: unknown }) => errorCategory(result.error) === "schema";

export async function withCatalogStageTimeout<T>(
  operation: CatalogReadOperation,
  promise: PromiseLike<T>,
  timeoutMs = isLocalTestDiagnosticsEnabled() ? localTestReadTimeoutMs : 0,
): Promise<T> {
  const startedAt = Date.now();
  const pending = Promise.resolve(promise);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!timeoutMs) return await pending;
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const elapsedMs = Date.now() - startedAt;
          logCatalogDiagnostic(operation, "timeout", elapsedMs);
          reject(new Error(`Public catalog read timed out at ${operation}.`));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if ((error as Error).message?.includes("timed out")) throw error;
    logCatalogDiagnostic(operation, errorCategory(error), Date.now() - startedAt);
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readCategories(supabase: NonNullable<(typeof import("../../../../lib/supabase/client"))["supabase"]>) {
  const full = await withCatalogStageTimeout(
    "categoriesFull",
    supabase
      .from("categories")
      .select(CATEGORY_SELECT)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
  );
  if (!isSchemaError(full)) return full;
  logCatalogDiagnostic("categoriesFull", "schema");

  const withoutSection = await withCatalogStageTimeout(
    "categoriesWithoutSection",
    supabase
      .from("categories")
      .select(CATEGORY_SELECT_WITHOUT_SECTION)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
  );
  if (!isSchemaError(withoutSection)) return withoutSection;
  logCatalogDiagnostic("categoriesWithoutSection", "schema");

  return withCatalogStageTimeout(
    "categoriesBase",
    supabase
      .from("categories")
      .select(CATEGORY_SELECT_BASE)
      .order("name", { ascending: true }),
  );
}

export async function loadPublicCatalogRows(): Promise<CatalogRows> {
  const { supabase } = await withCatalogStageTimeout(
    "configuration",
    import("../../../../lib/supabase/client"),
  );
  if (!supabase) {
    logCatalogDiagnostic("configuration", "missing-client");
    throw new Error("Public catalog is not configured.");
  }

  const [products, categories, vendors, settings, vendorCategories] = await Promise.all([
    withCatalogStageTimeout(
      "products",
      supabase
        .from("products")
        .select(PRODUCT_SELECT)
        .neq("status", "Draft")
        .order("created_at", { ascending: true }),
    ),
    readCategories(supabase),
    withCatalogStageTimeout(
      "vendors",
      supabase
        .from("vendors")
        .select(VENDOR_SELECT)
        .eq("status", "Active")
        .eq("store_visibility", "Visible")
        .order("featured", { ascending: false })
        .order("business_name", { ascending: true }),
    ),
    withCatalogStageTimeout(
      "settings",
      supabase
        .from("store_settings")
        .select("key,value")
        .in("key", Object.keys(settingKeyMap)),
    ),
    withCatalogStageTimeout(
      "vendorCategories",
      supabase
        .from("store_settings")
        .select("key,value")
        .like("key", "vendor_categories:%"),
    ),
  ]);

  throwOnError("products", products);
  throwOnError("categoriesBase", categories);
  throwOnError("vendors", vendors);
  throwOnError("settings", settings);
  throwOnError("vendorCategories", vendorCategories);

  return {
    products: ((products.data || []) as unknown) as Array<Record<string, unknown>>,
    categories: ((categories.data || []) as unknown) as Array<Record<string, unknown>>,
    vendors: ((vendors.data || []) as unknown) as Array<Record<string, unknown>>,
    settings: publicSettingsFromRows(
      ((settings.data || []) as unknown) as Array<Record<string, unknown>>,
      ((vendorCategories.data || []) as unknown) as Array<Record<string, unknown>>,
    ),
  };
}

export function sanitizePublicCatalogImages(response: PublicCatalogResponse): PublicCatalogResponse {
  return {
    ...response,
    products: response.products.map((product) => ({
      ...product,
      images: {
        ...product.images,
        primary: safePublicImageUrl(product.images.primary) || "",
        hover: safePublicImageUrl(product.images.hover),
      },
      variants: product.variants.map((variant) => ({
        ...variant,
        image: safePublicImageUrl(variant.image),
      })),
    })),
    categories: response.categories.map((category) => ({
      ...category,
      image: safePublicImageUrl(category.image),
    })),
    vendors: response.vendors.map((vendor) => ({
      ...vendor,
      logoUrl: safePublicImageUrl(vendor.logoUrl),
      coverUrl: safePublicImageUrl(vendor.coverUrl),
    })),
  };
}

const json = (body: unknown, status = 200, headers: HeadersInit = catalogCacheHeaders) =>
  new Response(JSON.stringify(body), { status, headers });

export function createPublicCatalogGET(loadRows: DataLoader = loadPublicCatalogRows) {
  return async function GET() {
    try {
      const rows = await loadRows();
      const response = sanitizePublicCatalogImages(buildPublicCatalogResponse({
        generatedAt: new Date().toISOString(),
        products: rows.products,
        categories: rows.categories,
        vendors: rows.vendors,
        settings: rows.settings,
      }));
      return json(response);
    } catch {
      logCatalogDiagnostic("mapping", "failed");
      return json({ error: "Could not load public catalog." }, 500, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
    }
  };
}

export const GET = createPublicCatalogGET();

export async function POST() {
  return json({ error: "Method not allowed." }, 405, {
    "content-type": "application/json",
    allow: "GET",
    "cache-control": "no-store",
  });
}
