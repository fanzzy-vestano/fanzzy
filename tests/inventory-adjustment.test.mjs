import assert from "node:assert/strict";
import test from "node:test";

import { adjustOrderInventory } from "../lib/inventory-adjustment.ts";

const config = {
  supabaseUrl: "https://inventory.test",
  supabaseKey: "public-test-key",
};

const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});

const installInventoryApi = (t, { variants = {}, sizeStock = {}, variantTypes = {}, products = [] }) => {
  const originalFetch = globalThis.fetch;
  const writes = [];
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method || "GET").toUpperCase();

    if (method === "GET" && url.includes("/store_settings?key=eq.")) {
      const key = decodeURIComponent(url.match(/key=eq\.([^&]+)/)?.[1] || "");
      const values = {
        product_variants: variants,
        product_size_stock: sizeStock,
        product_variant_type: variantTypes,
      };
      return jsonResponse([{ value: JSON.stringify(values[key] || {}) }]);
    }

    if (method === "GET" && url.includes("/products?select=sku,stock")) {
      return jsonResponse(products);
    }

    if (method === "POST" && url.includes("/store_settings?on_conflict=key")) {
      writes.push({ kind: "setting", body: JSON.parse(String(init.body || "[]")) });
      return new Response(null, { status: 204 });
    }

    if (method === "PATCH" && url.includes("/products?sku=eq.")) {
      writes.push({ kind: "product", url, body: JSON.parse(String(init.body || "{}")) });
      return new Response(null, { status: 204 });
    }

    throw new Error(`Unexpected inventory request: ${method} ${url}`);
  };

  return writes;
};

test("normal variant reservation rejects a quantity above its available stock", async (t) => {
  const writes = installInventoryApi(t, {
    variants: { "SKU-RED": [{ name: "Red", stock: 1 }] },
    variantTypes: { "SKU-RED": "normal" },
    products: [{ sku: "SKU-RED", stock: 10 }],
  });

  const result = await adjustOrderInventory({
    items: [{ name: "Ring · Red", productId: "SKU-RED", variantName: "Red", quantity: 2, price: "₹100" }],
  }, config, "decrement", true);

  assert.deepEqual(result, { complete: false, reason: "One or more products do not have enough stock." });
  assert.deepEqual(writes, []);
});

test("normal variant reservation deducts only the selected variant", async (t) => {
  const writes = installInventoryApi(t, {
    variants: { "SKU-RED": [{ name: "Red", stock: 3 }, { name: "Blue", stock: 7 }] },
    variantTypes: { "SKU-RED": "normal" },
    products: [{ sku: "SKU-RED", stock: 10 }],
  });

  const result = await adjustOrderInventory({
    items: [{ name: "Ring · Red", productId: "SKU-RED", variantName: "Red", quantity: 2, price: "₹100" }],
  }, config, "decrement", true);

  assert.deepEqual(result, { complete: true });
  assert.equal(writes.length, 1);
  const savedVariants = JSON.parse(writes[0].body[0].value);
  assert.deepEqual(savedVariants["SKU-RED"], [{ name: "Red", stock: 1 }, { name: "Blue", stock: 7 }]);
});

test("size reservation rejects a quantity above the selected size stock", async (t) => {
  const writes = installInventoryApi(t, {
    variants: { "SKU-SIZE": [{ size: "4", stock: 1 }] },
    sizeStock: { "SKU-SIZE": { "4": 1 } },
    variantTypes: { "SKU-SIZE": "size" },
    products: [{ sku: "SKU-SIZE", stock: 10 }],
  });

  const result = await adjustOrderInventory({
    items: [{ name: "Ring · Size 4", productId: "SKU-SIZE", size: "4", quantity: 2, price: "₹100" }],
  }, config, "decrement", true);

  assert.deepEqual(result, { complete: false, reason: "One or more products do not have enough stock." });
  assert.deepEqual(writes, []);
});

test("base-stock reservation rejects unavailable quantity without changing inventory", async (t) => {
  const writes = installInventoryApi(t, {
    products: [{ sku: "SKU-BASE", stock: 1 }],
  });

  const result = await adjustOrderInventory({
    items: [{ name: "Necklace", productId: "SKU-BASE", quantity: 2, price: "₹100" }],
  }, config, "decrement", true);

  assert.deepEqual(result, { complete: false, reason: "One or more products do not have enough stock." });
  assert.deepEqual(writes, []);
});

test("a failed line prevents partial variant deductions from the same order", async (t) => {
  const writes = installInventoryApi(t, {
    variants: {
      "SKU-OK": [{ name: "Gold", stock: 5 }],
      "SKU-LOW": [{ name: "Silver", stock: 1 }],
    },
    variantTypes: { "SKU-OK": "normal", "SKU-LOW": "normal" },
    products: [{ sku: "SKU-OK", stock: 5 }, { sku: "SKU-LOW", stock: 1 }],
  });

  const result = await adjustOrderInventory({
    items: [
      { name: "Pendant · Gold", productId: "SKU-OK", variantName: "Gold", quantity: 2, price: "₹100" },
      { name: "Pendant · Silver", productId: "SKU-LOW", variantName: "Silver", quantity: 2, price: "₹100" },
    ],
  }, config, "decrement", true);

  assert.equal(result.complete, false);
  assert.deepEqual(writes, []);
});
