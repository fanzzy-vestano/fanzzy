import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { loadBrowserStorage } from "./helpers/browser-storage-fixture.mjs";

const source = await readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("admin.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = (root, name) => {
  const matches = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
};
const helperNames = ["parseMoney", "formatMoney", "calculatePricing", "calculateMarkupFromSellingPrice", "normalizeWholeSellingPrice", "barcodeHash", "isFiveDigitBarcode", "createProductBarcode", "ensureProductBarcodes"];
const helpers = helperNames.map((name) => `const ${declarations(ast, name)[0].getText(ast)};`).join("\n");
const workspace = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "ProductLibraryWorkspace");
const loader = declarations(workspace, "loadProducts")[0].initializer.getText(ast);
const compiled = ts.transpileModule(`${helpers}\nreturn (${loader})();`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const fixtures = [
  { sku: "MARKUP-20", name: "Saved 20 percent", price: 160, cost: 100, category: "Earrings", stock: 2, status: "Published", barcode: "10001" },
  { sku: "MARKUP-ZERO", name: "Saved zero markup", price: 135, cost: 100, category: "Earrings", stock: 0, status: "Low stock", barcode: "10002" },
  { sku: "MARKUP-LUXURY", name: "Saved luxury markup", price: 900, cost: 200, category: "Rings · LX", stock: 2, status: "Published", barcode: "10003" },
  { sku: "MARKUP-MISSING", name: "Legacy missing markup", price: 240, cost: 100, category: "Earrings", stock: 2, status: "Published", barcode: "10004" },
];
const settings = { "MARKUP-20": { markup: 20, gstRate: 0 }, "MARKUP-ZERO": { markup: 0, gstRate: 0 }, "MARKUP-LUXURY": { markup: 125, gstRate: 0 } };

async function load({ offline = false, cached = fixtures, pricing = settings } = {}) {
  let loaded;
  const writes = [];
  const cache = new Map([["fanzzy-products", JSON.stringify(cached)]]);
  const dependencies = {
    active: true,
    fetchCatalogProducts: async () => offline ? { error: new Error("offline"), data: null } : { error: null, data: structuredClone(fixtures) },
    fetchStoreSetting: async (key) => ({ value: key === "productPricing" ? JSON.stringify(pricing) : null }),
    window: { localStorage: { getItem: (key) => cache.get(key) ?? null, removeItem: (key) => cache.delete(key) } },
    promotionStorageKey: "offers", localProductVariantsKey: "variants", adminPlaceholderImage: "/test.png",
    normalizeImageAdjustments: (value) => value,
    normalizePromotionOffer: (value) => value,
    isDemoProduct: () => false,
    setPromotionOffers: () => {},
    setProducts: (rows) => { loaded = rows; },
    persistCatalog: () => {},
    formatAdminCurrency: (value) => `₹${value}`,
    saveProductBarcodes: async () => { writes.push("barcodes"); },
    saveProductPricing: async () => { writes.push("pricing"); },
    saveCatalogProduct: async () => { writes.push("product"); },
    saveStoreSetting: async (key) => { writes.push(key); },
  };
  dependencies.browserLocalStorage = loadBrowserStorage(dependencies.window).browserLocalStorage;
  await new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
  return { loaded, writes };
}

test("admin catalogue loading preserves saved markup, including zero, without forcing 50 percent", async () => {
  const before = structuredClone(fixtures);
  const { loaded, writes } = await load();
  assert.deepEqual(loaded.map((row) => row.markup), [20, 0, 125, 140]);
  assert.deepEqual(loaded.map((row) => Number(row.price.slice(1))), fixtures.map((row) => row.price));
  assert.deepEqual(writes, []);
  assert.deepEqual(fixtures, before);
});

test("offline admin loading preserves cached prices and explicit markup without saving products", async () => {
  const cached = fixtures.map((row, index) => ({ ...row, markup: [33, 0, 175, 140][index] }));
  const { loaded, writes } = await load({ offline: true, cached });
  assert.deepEqual(loaded.map((row) => row.markup), [33, 0, 175, 140]);
  assert.deepEqual(loaded.map((row) => Number(row.price.slice(1))), fixtures.map((row) => row.price));
  assert.deepEqual(writes, []);
});

test("missing barcodes can still trigger the existing barcode-only repair, never price writes", async () => {
  const cached = fixtures.map((row) => ({ ...row, barcode: "" }));
  const { loaded, writes } = await load({ offline: true, cached });
  assert.deepEqual(writes, ["barcodes"]);
  assert.deepEqual(loaded.map((row) => Number(row.price.slice(1))), fixtures.map((row) => row.price));
});
