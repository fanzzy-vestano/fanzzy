import { supabase } from "./client";

export type CatalogStatus = "Published" | "Draft" | "Low stock";
export type ProductVariantType = "normal" | "size";

export type CatalogProduct = {
  name: string;
  sku: string;
  category: string;
  stock: number;
  price: number;
  cost?: number;
  status: CatalogStatus;
  image: string;
  hoverImage?: string;
  compareAt?: number;
  tag?: string;
  tone?: string;
  barcode?: string;
  variants?: Array<{ name: string; size?: string; image: string; stock?: number; price?: number }>;
  sizes?: string[];
  variantType?: ProductVariantType;
};

export type CatalogCategory = {
  name: string;
  pieces: number;
  image?: string;
  sortOrder?: number;
};

const settingKeys = {
  announcement: "announcement",
  heroImage: "hero_image",
  heroSlides: "hero_slides",
  heroSlideDuration: "hero_slide_duration",
  deliveryCharge: "delivery_charge",
  pickupHubs: "pickup_hubs",
  orders: "orders",
  marketingRecords: "marketing_records",
  collections: "collections",
  customers: "customers",
  newsletterSubscribers: "newsletter_subscribers",
  productBarcodes: "product_barcodes",
  productHsnCodes: "product_hsn_codes",
  productBillNames: "product_bill_names",
  productPricing: "product_pricing",
  productVariants: "product_variants",
  productVariantType: "product_variant_type",
  productSizes: "product_sizes",
  productSizeStock: "product_size_stock",
  productImageAdjustments: "product_image_adjustments",
  productDamages: "product_damages",
  promotionalOffers: "promotional_offers",
  printerName: "printer_name",
  billDesign: "bill_design",
} as const;

const asError = (value: unknown) => value instanceof Error ? value : new Error(String(value || "Supabase request failed"));

export const isSupabaseReady = Boolean(supabase);

const asProduct = (row: Record<string, unknown>): CatalogProduct => ({
  name: String(row.name ?? ""),
  sku: String(row.sku ?? ""),
  category: String(row.category ?? "Uncategorised"),
  stock: Number(row.stock ?? 0),
  price: Number(row.price ?? 0),
  cost: row.cost == null ? 0 : Number(row.cost),
  status: (row.status === "Draft" || row.status === "Low stock" ? row.status : "Published") as CatalogStatus,
  image: String(row.image ?? ""),
  hoverImage: typeof row.hover_image === "string" ? row.hover_image : undefined,
  compareAt: row.compare_at == null ? undefined : Number(row.compare_at),
  tag: typeof row.tag === "string" ? row.tag : undefined,
  tone: typeof row.tone === "string" ? row.tone : undefined,
  barcode: typeof row.barcode === "string" ? row.barcode : undefined,
});

const asCategory = (row: Record<string, unknown>): CatalogCategory => ({
  name: String(row.name ?? ""),
  pieces: Number(row.pieces ?? 0),
  image: typeof row.image === "string" ? row.image : undefined,
  sortOrder: Number(row.sort_order ?? 0),
});

export async function fetchCatalogProducts() {
  if (!supabase) return { data: null, error: new Error("Supabase is not configured") };
  const result = await supabase.from("products").select("*,vendors(business_name,slug)").order("created_at", { ascending: true });
  if (!result.error) {
    return { data: result.data?.map((row) => asProduct(row as Record<string, unknown>)) ?? null, error: null };
  }
  // Vendor relations may not exist yet in an older production schema. The
  // catalog itself must remain available while vendor metadata is optional.
  const fallback = await supabase.from("products").select("*").order("created_at", { ascending: true });
  return { data: fallback.data?.map((row) => asProduct(row as Record<string, unknown>)) ?? null, error: fallback.error };
}

export async function saveCatalogProduct(product: CatalogProduct) {
  if (!supabase) return new Error("Supabase is not configured");
  try {
    const { error } = await supabase.from("products").upsert({
      sku: product.sku,
      name: product.name,
      category: product.category,
      stock: product.stock,
      price: product.price,
      cost: product.cost ?? 0,
      status: product.status,
      image: product.image,
      hover_image: product.hoverImage ?? product.image,
      compare_at: product.compareAt ?? null,
      tag: product.tag ?? null,
      tone: product.tone ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "sku" });
    return error;
  } catch (error) {
    return asError(error);
  }
}

export async function decrementCatalogStock(lines: Array<{ sku: string; quantity: number }>) {
  const client = supabase;
  if (!client) return { data: null, error: new Error("Supabase is not configured") };
  const quantities = new Map<string, number>();
  lines.forEach(({ sku, quantity }) => {
    const normalizedSku = sku.trim();
    if (!normalizedSku || !Number.isFinite(quantity) || quantity <= 0) return;
    quantities.set(normalizedSku, (quantities.get(normalizedSku) ?? 0) + Math.floor(quantity));
  });
  if (!quantities.size) return { data: [] as CatalogProduct[], error: null };

  const currentProducts = await Promise.all(
    Array.from(quantities.keys()).map(async (sku) => {
      const result = await client.from("products").select("*").eq("sku", sku).maybeSingle();
      return { sku, data: result.data ? asProduct(result.data as Record<string, unknown>) : null, error: result.error };
    }),
  );
  const invalidLine = currentProducts.find(({ sku, data, error }) => error || !data || data.stock < (quantities.get(sku) ?? 0));
  if (invalidLine) {
    return { data: null, error: invalidLine.error || new Error("One or more items are no longer available") };
  }

  const updates = await Promise.all(currentProducts.map(async ({ sku, data }) => {
    const stock = Math.max(0, data!.stock - (quantities.get(sku) ?? 0));
    const result = await client.from("products")
      .update({ stock, updated_at: new Date().toISOString() })
      .eq("sku", sku)
      .select("*")
      .single();
    return { data: result.data ? asProduct(result.data as Record<string, unknown>) : null, error: result.error };
  }));
  const failedUpdate = updates.find(({ error, data }) => error || !data);
  return {
    data: updates.flatMap(({ data }) => data ? [data] : []),
    error: failedUpdate?.error || null,
  };
}

export async function removeCatalogProduct(sku: string) {
  if (!supabase) return new Error("Supabase is not configured");
  const { error } = await supabase.from("products").delete().eq("sku", sku);
  return error;
}

export async function fetchCatalogCategories() {
  if (!supabase) return { data: null, error: new Error("Supabase is not configured") };
  const result = await supabase.from("categories").select("*").order("sort_order", { ascending: true }).order("name", { ascending: true });
  return { data: result.data?.map((row) => asCategory(row as Record<string, unknown>)) ?? null, error: result.error };
}

export async function saveCatalogCategory(category: CatalogCategory) {
  if (!supabase) return new Error("Supabase is not configured");
  const { error } = await supabase.from("categories").upsert({
    name: category.name,
    pieces: category.pieces,
    image: category.image ?? null,
    sort_order: category.sortOrder ?? 0,
  }, { onConflict: "name" });
  return error;
}

export async function removeCatalogCategory(name: string) {
  if (!supabase) return new Error("Supabase is not configured");
  const { error } = await supabase.from("categories").delete().eq("name", name);
  return error;
}

export async function renameCatalogCategory(previousName: string, category: CatalogCategory) {
  if (!supabase) return new Error("Supabase is not configured");
  const { error } = await supabase.from("categories").update({
    name: category.name,
    pieces: category.pieces,
    image: category.image ?? null,
    sort_order: category.sortOrder ?? 0,
  }).eq("name", previousName);
  return error;
}

export async function fetchStoreSetting(key: keyof typeof settingKeys) {
  if (!supabase) return { value: null, error: new Error("Supabase is not configured") };
  const result = await supabase.from("store_settings").select("value").eq("key", settingKeys[key]).maybeSingle();
  return { value: typeof result.data?.value === "string" ? result.data.value : null, error: result.error };
}

export async function saveStoreSetting(key: keyof typeof settingKeys, value: string) {
  if (!supabase) return new Error("Supabase is not configured");
  const { error } = await supabase.from("store_settings").upsert({ key: settingKeys[key], value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return error;
}

export async function fetchStoreOrders<T>() {
  const remote = await fetchStoreSetting("orders");
  if (remote.error || !remote.value) return { data: null as T[] | null, error: remote.error };
  try {
    const parsed: unknown = JSON.parse(remote.value);
    return { data: Array.isArray(parsed) ? parsed as T[] : null, error: null };
  } catch (error) {
    return { data: null as T[] | null, error: asError(error) };
  }
}

export async function saveStoreOrders(orders: unknown[]) {
  return saveStoreSetting("orders", JSON.stringify(orders));
}

export function subscribeToStoreSetting(key: keyof typeof settingKeys, onChange: () => void) {
  const client = supabase;
  if (!client) return () => undefined;
  const channel = client
    .channel(`fanzzy-${settingKeys[key]}-live`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "store_settings",
      filter: `key=eq.${settingKeys[key]}`,
    }, onChange)
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

export async function uploadStoreImage(file: File, folder: "products" | "homepage" | "categories") {
  if (!supabase) return { url: null, error: new Error("Supabase is not configured") };
  try {
    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const uniqueId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const path = `${folder}/${uniqueId}.${extension}`;
    const upload = await supabase.storage.from("fanzzy-assets").upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
    if (upload.error) return { url: null, error: upload.error };
    const { data } = supabase.storage.from("fanzzy-assets").getPublicUrl(path);
    return { url: data.publicUrl, error: null };
  } catch (error) {
    return { url: null, error: asError(error) };
  }
}
