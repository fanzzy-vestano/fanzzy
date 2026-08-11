import { supabase } from "./client";

export type CatalogStatus = "Published" | "Draft" | "Low stock";

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
  marketingRecords: "marketing_records",
  collections: "collections",
  customers: "customers",
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
});

const asCategory = (row: Record<string, unknown>): CatalogCategory => ({
  name: String(row.name ?? ""),
  pieces: Number(row.pieces ?? 0),
  image: typeof row.image === "string" ? row.image : undefined,
  sortOrder: Number(row.sort_order ?? 0),
});

export async function fetchCatalogProducts() {
  if (!supabase) return { data: null, error: new Error("Supabase is not configured") };
  const result = await supabase.from("products").select("*").order("created_at", { ascending: true });
  return { data: result.data?.map((row) => asProduct(row as Record<string, unknown>)) ?? null, error: result.error };
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
