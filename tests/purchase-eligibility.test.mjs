import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { hasValidSellingPrice, hasUnavailablePurchasePrice } from "../lib/catalog/purchase-eligibility.js";

test("purchase eligibility rejects missing, zero, negative and invalid prices without changing them", () => {
  for (const price of [0, -1, NaN, Infinity, null, undefined, "", " ", "invalid", false, true]) {
    assert.equal(hasValidSellingPrice(price), false);
  }
  for (const price of [0.01, 59, 100, "59.50"]) assert.equal(hasValidSellingPrice(price), true);
});

test("free promotion lines use the underlying catalogue price and support normalized SKU keys", () => {
  const products = [{ sku: "FZ-PAID-1", price: 59 }, { sku: "FZ-GIFT-1", price: 99 }];
  const items = [{ productId: "fz-paid-1", quantity: 1, price: "₹59" }, { productId: "fz-gift-1", quantity: 1, price: "₹0" }];
  const before = structuredClone(products);
  assert.equal(hasUnavailablePurchasePrice(items, products), false);
  assert.equal(hasUnavailablePurchasePrice(items, [{ ...products[0], price: 0 }, products[1]]), true);
  assert.equal(hasUnavailablePurchasePrice(items, []), true);
  assert.deepEqual(products, before);
});

test("server-side COD and online reservation validation rejects a zero-price item before any writes", async () => {
  const source = await readFile(new URL("../lib/razorpay-payment-sync.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("payment.ts", source, ts.ScriptTarget.Latest, true);
  const adjustment = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "adjustInventory");
  assert.ok(adjustment);
  const js = ts.transpileModule(`${adjustment.getText(ast)}\nreturn adjustInventory(order, "decrement", true);`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const requests = [];
  const fetchFixture = async (url, init = {}) => {
    requests.push(init.method || "GET");
    assert.equal(init.method || "GET", "GET");
    return new Response(JSON.stringify([{ sku: "ZERO", price: 0, stock: 10 }]));
  };
  const order = { items: [{ productId: "ZERO", quantity: 1, price: "₹0" }] };
  const result = await new Function("hasUnavailablePurchasePrice", "readJsonSetting", "fetch", "supabaseUrl", "headers", "order", js)(
    hasUnavailablePurchasePrice, async () => ({}), fetchFixture, "https://fixture.test", {}, order,
  );
  assert.deepEqual(result, { complete: false, reason: "One or more products are currently unavailable for purchase." });
  assert.deepEqual(requests, ["GET"]);
});

test("server inventory preflights a later shortage before writing an earlier product", async () => {
  const source = await readFile(new URL("../lib/razorpay-payment-sync.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("payment.ts", source, ts.ScriptTarget.Latest, true);
  const adjustment = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "adjustInventory");
  const js = ts.transpileModule(`${adjustment.getText(ast)}\nreturn adjustInventory(order, "decrement", true);`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const rows = [{ sku: "FIRST", price: 100, stock: 5 }, { sku: "LAST", price: 100, stock: 1 }];
  const requests = [];
  const dependencies = {
    hasUnavailablePurchasePrice, readJsonSetting: async () => ({}),
    fetch: async (url, init = {}) => {
      requests.push(init.method || "GET");
      assert.equal(init.method || "GET", "GET");
      return new Response(JSON.stringify(rows));
    },
    supabaseUrl: "https://fixture.test", headers: {},
    normalizeSku: (value) => String(value || "").toLowerCase(),
    resolveSettingKey: (settings, sku) => sku,
    order: { items: [{ productId: "FIRST", quantity: 1 }, { productId: "LAST", quantity: 2 }] },
  };
  const result = await new Function(...Object.keys(dependencies), js)(...Object.values(dependencies));
  assert.deepEqual(result, { complete: false, reason: "One or more products do not have enough stock." });
  assert.deepEqual(requests, ["GET"]);
});

test("the stock reservation endpoint reports purchase ineligibility as a conflict", async () => {
  const source = await readFile(new URL("../app/api/razorpay/reserve-stock/route.ts", import.meta.url), "utf8");
  const isolated = source.replace(/^import .*;\r?\n/, 'const reserveOrderInventory = async () => { throw new Error("One or more products are currently unavailable for purchase."); };\n');
  const js = ts.transpileModule(isolated, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const { POST } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  const response = await POST(new Request("https://fixture.test/api/razorpay/reserve-stock", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fanzzyOrderId: "#FZ-TEST-1" }),
  }));
  assert.equal(response.status, 409);
});
