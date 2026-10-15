import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { filterCatalogProducts } from "../lib/catalog/catalog-visibility.ts";
import { countProductsByCategoryKey } from "../lib/catalog-categories.ts";

export const products = [
  { sku: "GENERAL", name: "General earrings", category: "Earrings", vendor_id: null, status: "Published", stock: 3, price: 100, compare_at: 300, image: "/general.png" },
  { sku: "LUXURY", name: "General luxury", category: "Rings · LX", status: "Published", stock: 2, price: 500 },
  { sku: "VENDOR-A", name: "Vendor earrings", category: "Earrings", vendor_id: "a", vendor_status: "Approved", public_vendor_visible: true, status: "Published", stock: 3, price: 50 },
  { sku: "VENDOR-B", name: "Vendor luxury", category: "Rings · LX", vendor_id: "b", vendor_status: "Approved", public_vendor_visible: true, status: "Published", stock: 4, price: 60 },
  { sku: "DRAFT", name: "Draft", category: "Earrings", status: "Draft", stock: 3, price: 20 },
  { sku: "SOLD", name: "Sold out earrings", category: "Earrings", status: "Low stock", stock: 0, price: 80 },
  { sku: "VENDOR-DRAFT", vendor_id: "a", vendor_status: "Approved", public_vendor_visible: true, status: "Draft" },
  { sku: "PENDING", vendor_id: "a", vendor_status: "Pending Approval", public_vendor_visible: true, status: "Published" },
];
const skus = (rows) => rows.map((row) => row.sku);

test("ownership separates both homepage sections, grid, search, sorting, pages and counts", () => {
  const general = filterCatalogProducts(products, "general");
  assert.deepEqual(skus(general), ["GENERAL", "LUXURY", "SOLD"]);
  const search = general.filter((row) => row.name.includes("earrings")).sort((a, b) => a.price - b.price);
  assert.equal(search.length, 2);
  assert.deepEqual(skus(search.slice(0, 1)), ["SOLD"]);
  assert.deepEqual(skus(search.slice(1, 2)), ["GENERAL"]);
  assert.deepEqual(countProductsByCategoryKey(general), { earrings: 2, "rings · lx": 1, rings: 1, __luxury__: 1 });
  assert.equal(general[0], products[0]); // Pricing, stock, images and MRP pass through untouched.
  assert.equal(new Set(skus(general)).size, general.length);
});

test("vendor scopes preserve approved sold-out items and isolate owners", () => {
  const rows = [...products, { ...products[2], sku: "VENDOR-SOLD", stock: 0 }];
  assert.deepEqual(skus(filterCatalogProducts(rows, { vendorId: "a" })), ["VENDOR-A", "VENDOR-SOLD"]);
  assert.deepEqual(skus(filterCatalogProducts(rows, { vendorId: "b" })), ["VENDOR-B"]);
  assert.deepEqual(filterCatalogProducts(rows, { vendorId: "empty" }), []);
  assert.equal(filterCatalogProducts(rows, "all").length, rows.length);
});

test("mapped caches use ownership and draft status, never names or category names", () => {
  const rows = products.map((row) => ({ ...row, vendor_id: undefined, vendorId: row.vendor_id }));
  assert.deepEqual(skus(filterCatalogProducts(rows, "general")), ["GENERAL", "LUXURY", "SOLD"]);
});

test("actual public vendor handlers retain cards and query only the selected vendor's eligible products", async () => {
  const source = await readFile(new URL("../lib/vendor-server.ts", import.meta.url), "utf8");
  const handlers = source.slice(source.indexOf("export async function listPublicVendors"), source.indexOf("export async function listVendorsForAdmin"));
  const vendors = ["a", "b", "empty"].map((id) => ({ id, slug: id, business_name: `Maker ${id}`, status: "Active", store_visibility: "Visible", logo_url: `/${id}.png` }));
  const calls = [];
  globalThis.__visibilityTestRest = async (table, query) => {
    calls.push({ table, query });
    const params = new URLSearchParams(query);
    return (table === "vendors" ? vendors : products).filter((row) => [...params].every(([key, value]) => {
      if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
      if (value.startsWith("neq.")) return String(row[key]) !== value.slice(4);
      return true;
    }));
  };
  const js = ts.transpileModule(`const rest = globalThis.__visibilityTestRest; class VendorDataError extends Error {}\n${handlers}`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  try {
    const { listPublicVendors, getPublicVendor } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
    const cards = await listPublicVendors();
    assert.equal(cards.length, 3);
    assert.equal(cards[0].logoUrl, "/a.png");
    assert.equal(cards[0].slug, "a");
    assert.deepEqual(skus((await getPublicVendor("a")).products), ["VENDOR-A"]);
    assert.deepEqual(skus((await getPublicVendor("b")).products), ["VENDOR-B"]);
    assert.deepEqual((await getPublicVendor("empty")).products, []);
    assert.ok(calls.filter(({ table }) => table === "products").every(({ query }) => query.includes("status=neq.Draft")));
  } finally { delete globalThis.__visibilityTestRest; }
});

test("query scopes and relation fallback preserve ownership filters before mapping", async () => {
  const source = await readFile(new URL("../lib/supabase/catalog.ts", import.meta.url), "utf8");
  const calls = [];
  let failRelation = false;
  const client = { from() {
    const filters = [];
    let select;
    const query = {
      select(value) { select = value; return query; },
      neq(key, value) { filters.push([key, (actual) => actual !== value]); return query; },
      eq(key, value) { filters.push([key, (actual) => actual === value]); return query; },
      is(key, value) { filters.push([key, (actual) => (actual ?? null) === value]); return query; },
      order() {
        calls.push({ select, filters: filters.map(([key]) => key) });
        return Promise.resolve(failRelation && select.includes("vendors")
          ? { data: null, error: new Error("relation missing") }
          : { data: products.filter((row) => filters.every(([key, match]) => match(row[key]))), error: null });
      },
    };
    return query;
  } };
  globalThis.__visibilityTestClient = client;
  globalThis.__visibilityTestFilter = filterCatalogProducts;
  const isolated = source.replace(/^import .*;\r?\n/gm, "")
    .replace("export type CatalogStatus", "const supabase = globalThis.__visibilityTestClient; const filterCatalogProducts = globalThis.__visibilityTestFilter; const countProductsByCategoryKey = () => ({});\nexport type CatalogStatus");
  const js = ts.transpileModule(isolated, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  try {
    const { fetchCatalogProducts } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
    assert.deepEqual(skus((await fetchCatalogProducts("general")).data), ["GENERAL", "LUXURY", "SOLD"]);
    failRelation = true;
    assert.deepEqual(skus((await fetchCatalogProducts("general")).data), ["GENERAL", "LUXURY", "SOLD"]);
    assert.ok(calls.every((call) => call.filters.includes("vendor_id") && call.filters.includes("status")));
    assert.deepEqual(skus((await fetchCatalogProducts({ vendorId: "a" })).data), ["VENDOR-A"]);
    assert.equal((await fetchCatalogProducts()).data.length, products.length);
    assert.deepEqual(skus((await fetchCatalogProducts("public")).data), ["GENERAL", "LUXURY", "VENDOR-A", "VENDOR-B", "SOLD"]);
  } finally {
    delete globalThis.__visibilityTestClient;
    delete globalThis.__visibilityTestFilter;
  }
});

test("public storefront catalog uses a narrow projection while admin scopes keep full rows", async () => {
  const source = await readFile(new URL("../lib/supabase/catalog.ts", import.meta.url), "utf8");
  assert.match(source, /const publicProductSelect = "sku,name,created_at,category,stock,price,status,image,hover_image,compare_at,tag,tone,vendor_id,vendor_status,public_vendor_visible,vendors\(business_name,slug\)"/);
  assert.match(source, /scope === "public" \? publicProductSelect : "\*,vendors\(business_name,slug\)"/);
  assert.match(source, /scope === "public" \? publicProductSelect\.replace\(.*vendors\(business_name,slug\)/);
});
