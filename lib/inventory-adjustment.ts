export type InventoryOrder = {
  items?: Array<{ name: string; quantity: number; price: string; productId?: string; variantName?: string; size?: string }>;
};

type StoredVariant = { name?: string; size?: string; stock?: number; [key: string]: unknown };

type InventoryAdjustmentConfig = {
  supabaseUrl: string;
  supabaseKey: string;
};

export type InventoryAdjustment = { complete: boolean };

const normalizeSelection = (value?: string) => String(value || "").trim().replace(/^size\s+/i, "").toLowerCase();
const normalizeSku = (value?: string) => String(value || "").trim().replace(/[^a-z0-9]/gi, "").toLowerCase();
const findSettingKey = <T>(settings: Record<string, T>, sku: string) =>
  Object.keys(settings).find((key) => normalizeSku(key) === normalizeSku(sku));
const resolveSettingKey = <T>(settings: Record<string, T>, sku: string) => findSettingKey(settings, sku) || sku;

const apiHeaders = (config: InventoryAdjustmentConfig) => ({
  apikey: config.supabaseKey,
  Authorization: `Bearer ${config.supabaseKey}`,
  "Content-Type": "application/json",
});

async function readJsonSetting<T>(config: InventoryAdjustmentConfig, key: string, fallback: T) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/store_settings?key=eq.${encodeURIComponent(key)}&select=value`, {
    headers: apiHeaders(config),
  });
  if (!response.ok) throw new Error(`Could not read ${key}`);
  const rows = await response.json() as Array<{ value?: string }>;
  try {
    return JSON.parse(rows[0]?.value || "") as T;
  } catch {
    return fallback;
  }
}

async function writeJsonSetting(config: InventoryAdjustmentConfig, key: string, value: unknown) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/store_settings?on_conflict=key`, {
    method: "POST",
    headers: { ...apiHeaders(config), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ key, value: JSON.stringify(value), updated_at: new Date().toISOString() }]),
  });
  if (!response.ok) throw new Error(`Could not update ${key}`);
}

export async function adjustOrderInventory(order: InventoryOrder, config: InventoryAdjustmentConfig): Promise<InventoryAdjustment> {
  const [savedVariants, savedSizeStock, savedVariantTypes] = await Promise.all([
    readJsonSetting<Record<string, StoredVariant[]>>(config, "product_variants", {}),
    readJsonSetting<Record<string, Record<string, number>>>(config, "product_size_stock", {}),
    readJsonSetting<Record<string, "normal" | "size">>(config, "product_variant_type", {}),
  ]);
  const variants = structuredClone(savedVariants);
  const sizeStock = structuredClone(savedSizeStock);
  const baseQuantities = new Map<string, number>();
  let variantsChanged = false;
  let sizeStockChanged = false;
  const unresolvedProductIds = new Set<string>();
  const headers = apiHeaders(config);

  // Checkout may store a normalized product id while Admin keys inventory by
  // the original SKU. Resolve each order line to that canonical SKU first.
  let productRows: Array<{ sku?: string; stock?: number }> = [];
  try {
    const productResponse = await fetch(`${config.supabaseUrl}/rest/v1/products?select=sku,stock`, { headers });
    if (productResponse.ok) productRows = await productResponse.json() as Array<{ sku?: string; stock?: number }>;
  } catch {
    productRows = [];
  }
  const resolveProductSku = (rawSku: string) =>
    productRows.find((product) => normalizeSku(product.sku) === normalizeSku(rawSku))?.sku?.trim()
      || findSettingKey(savedVariants, rawSku)
      || findSettingKey(savedSizeStock, rawSku)
      || findSettingKey(savedVariantTypes, rawSku)
      || rawSku;

  order.items?.forEach((item) => {
    const rawSku = String(item.productId || "").trim();
    const sku = resolveProductSku(rawSku);
    const quantity = Math.floor(Number(item.quantity) || 0);
    if (!sku || quantity <= 0) return;
    const product = productRows.find((candidate) => normalizeSku(candidate.sku) === normalizeSku(sku));
    const hasBaseStock = Number.isFinite(Number(product?.stock));

    const variantTypeKey = resolveSettingKey(savedVariantTypes, sku);
    // Checkout records which exact inventory bucket the customer selected.
    const selectionType = item.size ? "size" : item.variantName ? "normal" : savedVariantTypes[variantTypeKey];
    if (selectionType === "size" && item.size) {
      const normalizedSize = normalizeSelection(item.size);
      const sizeStockKey = resolveSettingKey(sizeStock, sku);
      const currentSizeStock = sizeStock[sizeStockKey] || {};
      const sizeKey = Object.keys(currentSizeStock).find((key) => normalizeSelection(key) === normalizedSize) || item.size;
      const variantsKey = resolveSettingKey(variants, sku);
      const productVariants = variants[variantsKey] || [];
      const variantIndex = productVariants.findIndex((variant) => normalizeSelection(variant.size || variant.name) === normalizedSize);
      const sizeVariant = variantIndex >= 0 ? productVariants[variantIndex] : undefined;
      const configuredSizeStock = currentSizeStock[sizeKey];
      const variantAvailable = Number(sizeVariant?.stock);
      const hasConfiguredSizeStock = configuredSizeStock !== undefined && Number.isFinite(Number(configuredSizeStock));
      const hasVariantStock = Number.isFinite(variantAvailable);

      if (!hasConfiguredSizeStock && !hasVariantStock) {
        if (!hasBaseStock || Number(product?.stock) <= 0) unresolvedProductIds.add(rawSku || sku);
        else baseQuantities.set(sku, (baseQuantities.get(sku) || 0) + quantity);
        return;
      }
      if (hasConfiguredSizeStock) {
        sizeStock[sizeStockKey] = {
          ...currentSizeStock,
          [sizeKey]: Math.max(0, Math.floor(Number(configuredSizeStock) - quantity)),
        };
        sizeStockChanged = true;
      }
      if (hasVariantStock && sizeVariant) {
        variants[variantsKey] = productVariants.map((variant, index) => index === variantIndex
          ? { ...variant, stock: Math.max(0, Math.floor(Number(variant.stock) - quantity)) }
          : variant);
        variantsChanged = true;
      }
      return;
    }

    if (selectionType === "normal" && item.variantName) {
      const normalizedVariant = normalizeSelection(item.variantName);
      const variantsKey = resolveSettingKey(variants, sku);
      const productVariants = variants[variantsKey] || [];
      const variantIndex = productVariants.findIndex((variant) => normalizeSelection(variant.name) === normalizedVariant);
      const selectedVariant = variantIndex >= 0 ? productVariants[variantIndex] : undefined;
      if (!selectedVariant || !Number.isFinite(Number(selectedVariant.stock))) {
        if (!hasBaseStock) unresolvedProductIds.add(rawSku || sku);
        else baseQuantities.set(sku, (baseQuantities.get(sku) || 0) + quantity);
        return;
      }
      variants[variantsKey] = productVariants.map((variant, index) => index === variantIndex
        ? { ...variant, stock: Math.max(0, Math.floor(Number(variant.stock) - quantity)) }
        : variant);
      variantsChanged = true;
      return;
    }

    if (!hasBaseStock) unresolvedProductIds.add(rawSku || sku);
    else baseQuantities.set(sku, (baseQuantities.get(sku) || 0) + quantity);
  });

  // Do not partially deduct an order. An unresolved line stays pending so a
  // later retry cannot reduce the rest of the order a second time.
  if (unresolvedProductIds.size > 0) return { complete: false };

  if (sizeStockChanged) await writeJsonSetting(config, "product_size_stock", sizeStock);
  if (variantsChanged) await writeJsonSetting(config, "product_variants", variants);

  for (const [sku, quantity] of baseQuantities) {
    const currentStock = Number(productRows.find((product) => normalizeSku(product.sku) === normalizeSku(sku))?.stock);
    if (!Number.isFinite(currentStock)) return { complete: false };
    const updateResponse = await fetch(`${config.supabaseUrl}/rest/v1/products?sku=eq.${encodeURIComponent(sku)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ stock: Math.max(0, currentStock - quantity), updated_at: new Date().toISOString() }),
    });
    if (!updateResponse.ok) throw new Error("Could not update product inventory");
  }
  return { complete: true };
}
