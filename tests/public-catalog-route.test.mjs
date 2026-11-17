import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const routeSource = await readFile(new URL("../app/api/catalog/public/route.ts", import.meta.url), "utf8");
const mapperUrl = new URL("../lib/catalog/public-catalog-mapper.ts", import.meta.url).href;
const routeForNode = routeSource.replace(
  "\"../../../../lib/catalog/public-catalog-mapper\"",
  JSON.stringify(mapperUrl),
);
const transpiledRoute = ts.transpileModule(routeForNode, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { createPublicCatalogGET, POST, withCatalogStageTimeout } = await import(`data:text/javascript;base64,${Buffer.from(transpiledRoute).toString("base64")}`);

const allowedImage = "https://pdrcrkxeyqxqgpwfxqpu.supabase.co/storage/v1/object/public/fanzzy-assets/products/pub.webp";
const allowedHover = "https://pdrcrkxeyqxqgpwfxqpu.supabase.co/storage/v1/object/public/fanzzy-assets/products/pub-hover.webp";
const allowedVendorLogo = "https://pdrcrkxeyqxqgpwfxqpu.supabase.co/storage/v1/object/public/fanzzy-assets/vendors/logo.webp";
const allowedCategoryImage = "https://pdrcrkxeyqxqgpwfxqpu.supabase.co/storage/v1/object/public/fanzzy-assets/categories/earrings.webp";

const fixtureRows = () => ({
  vendors: [
    {
      id: "vendor-public",
      slug: "public-store",
      business_name: "Public Store",
      logo_url: allowedVendorLogo,
      cover_url: "https://images.unsplash.com/private-cover.jpg",
      description: "Public vendor",
      featured: true,
      status: "Active",
      store_visibility: "Visible",
      login_email: "private-vendor@example.test",
      account_number: "PRIVATE-BANK",
    },
    { id: "vendor-hidden", slug: "hidden-store", business_name: "Hidden Store", status: "Active", store_visibility: "Hidden" },
    { id: "vendor-inactive", slug: "inactive-store", business_name: "Inactive Store", status: "Inactive", store_visibility: "Visible" },
  ],
  categories: [
    { name: "Earrings", pieces: 0, sort_order: 1, image: allowedCategoryImage, section: "normal" },
    { name: "Blocked Category", pieces: 0, sort_order: 2, image: "https://images.unsplash.com/category.jpg", section: "normal" },
  ],
  products: [
    {
      id: "PUB-1",
      sku: "PUB-1",
      name: "Published Earrings",
      category: "Earrings",
      stock: 4,
      price: 1000,
      status: "Published",
      image: allowedImage,
      hover_image: allowedHover,
      compare_at: 1999,
      tag: "New",
      tone: "#fff",
      cost: 10,
      barcode: "12345",
      supplierName: "Secret Supplier",
      billName: "Private Bill Name",
      customer_email: "customer@example.test",
      coupon_code: "PRIVATE-COUPON",
    },
    { sku: "LOW-1", name: "Low Stock", category: "Earrings", stock: 1, price: 500, status: "Low stock", image: "http://not-secure.test/image.jpg" },
    { sku: "SOLD-1", name: "Sold Out", category: "Earrings", stock: 0, price: 500, status: "Published", image: "data:image/png;base64,private" },
    { sku: "DRAFT-1", name: "Draft Product", category: "Earrings", stock: 2, price: 500, status: "Draft", image: allowedImage },
    { sku: "LST-AUR-01", name: "Aurora Drop Earrings", category: "Earrings", stock: 2, price: 500, status: "Published", image: allowedImage },
    { sku: "VENDOR-1", name: "Vendor Public", category: "Vendor Secret", stock: 3, price: 700, status: "Published", image: "https://cdn.example/vendor.jpg", vendor_id: "vendor-public", vendor_status: "Approved", public_vendor_visible: true, vendor_rejection_reason: "PRIVATE-REJECTION" },
    { sku: "VENDOR-2", name: "Vendor Hidden", category: "Vendor Secret", stock: 3, price: 700, status: "Published", vendor_id: "vendor-hidden", vendor_status: "Approved", public_vendor_visible: true },
    { sku: "VENDOR-3", name: "Vendor Pending", category: "Vendor Secret", stock: 3, price: 700, status: "Published", vendor_id: "vendor-public", vendor_status: "Pending Approval", public_vendor_visible: true },
    { sku: "VENDOR-4", name: "Vendor Rejected", category: "Vendor Secret", stock: 3, price: 700, status: "Published", vendor_id: "vendor-public", vendor_status: "Rejected", public_vendor_visible: true },
    { sku: "VENDOR-5", name: "Vendor Private", category: "Vendor Secret", stock: 3, price: 700, status: "Published", vendor_id: "vendor-public", vendor_status: "Approved", public_vendor_visible: false },
  ],
  settings: {
    productVariants: JSON.stringify({
      "PUB-1": [
        { name: "Gold", image: "https://pdrcrkxeyqxqgpwfxqpu.supabase.co/storage/v1/object/public/fanzzy-assets/products/gold.webp", stock: 2 },
        { name: "Blocked", image: "https://cdn.example/blocked.webp", stock: 1 },
      ],
    }),
    productVariantType: JSON.stringify({ "PUB-1": "normal" }),
    productImageAdjustments: JSON.stringify({ "PUB-1": { image: { zoom: 3, x: 75, y: -75, rotate: 250 } } }),
    categoryCatalog: JSON.stringify([{ name: "Archive", pieces: 0, sortOrder: 8, image: "https://example.com/archive.jpg", section: "normal" }]),
    vendorCategoryNames: JSON.stringify(["Vendor Secret"]),
  },
});

const loadFixture = async () => fixtureRows();

const body = async (response) => response.json();

test("GET returns the public catalog schema with cache headers", async () => {
  const response = await createPublicCatalogGET(loadFixture)();
  const payload = await body(response);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(payload.version, 1);
  assert.equal(payload.meta.source, "fanzzy-catalog");
  assert.ok(Array.isArray(payload.products));
  assert.ok(Array.isArray(payload.categories));
  assert.ok(Array.isArray(payload.vendors));
});

test("product projection uses sku as the product identifier", () => {
  const productSelect = routeSource.match(/const PRODUCT_SELECT = \[([\s\S]*?)\]\.join\(","\);/)?.[1] || "";

  assert.match(productSelect, /"sku"/);
  assert.doesNotMatch(productSelect, /"id"/);
});

test("category projections keep metadata optional with a name-only fallback", () => {
  assert.match(routeSource, /const CATEGORY_SELECT = "name,pieces,image,sort_order,section"/);
  assert.match(routeSource, /const CATEGORY_SELECT_WITHOUT_SECTION = "name,pieces,image,sort_order"/);
  assert.match(routeSource, /const CATEGORY_SELECT_BASE = "name"/);
});

test("unsupported methods are rejected", async () => {
  const response = await POST();
  const payload = await body(response);

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(payload.error, "Method not allowed.");
});

test("GET excludes draft, demo, hidden vendor, pending, rejected, and private products", async () => {
  const payload = await body(await createPublicCatalogGET(loadFixture)());
  const skus = payload.products.map((product) => product.sku);

  assert.deepEqual(skus.sort(), ["LOW-1", "PUB-1", "SOLD-1", "VENDOR-1"].sort());
});

test("GET maps sku-only product rows without a products.id column", async () => {
  const payload = await body(await createPublicCatalogGET(loadFixture)());
  const low = payload.products.find((product) => product.sku === "LOW-1");

  assert.equal(low.sku, "LOW-1");
  assert.equal(low.name, "Low Stock");
});

test("GET maps category rows when optional metadata is unavailable", async () => {
  const response = await createPublicCatalogGET(async () => ({
    ...fixtureRows(),
    categories: [{ name: "Earrings" }],
  }))();
  const payload = await body(response);
  const earrings = payload.categories.find((category) => category.name === "Earrings");

  assert.equal(response.status, 200);
  assert.equal(earrings.section, "normal");
  assert.equal(earrings.sortOrder, 0);
  assert.equal(earrings.image, undefined);
});

test("GET excludes sensitive fields and private fixture values", async () => {
  const payload = await body(await createPublicCatalogGET(loadFixture)());
  const serialized = JSON.stringify(payload);
  const forbidden = [
    "cost",
    "barcode",
    "supplier",
    "Secret Supplier",
    "billName",
    "Private Bill Name",
    "customer",
    "customer@example.test",
    "coupon",
    "PRIVATE-COUPON",
    "login_email",
    "private-vendor@example.test",
    "account_number",
    "PRIVATE-BANK",
    "vendor_rejection_reason",
    "PRIVATE-REJECTION",
    "Hidden Store",
    "Inactive Store",
    "Pending Approval",
    "Rejected",
  ];

  for (const value of forbidden) {
    assert.equal(serialized.includes(value), false, `Leaked forbidden value: ${value}`);
  }
});

test("GET handles malformed settings safely", async () => {
  const response = await createPublicCatalogGET(async () => ({
    ...fixtureRows(),
    settings: {
      productVariants: "{bad json",
      productVariantType: "[]",
      productImageAdjustments: "false",
      categoryCatalog: "{bad",
      vendorCategoryNames: "{bad",
    },
  }))();
  const payload = await body(response);
  const product = payload.products.find((item) => item.sku === "PUB-1");

  assert.equal(response.status, 200);
  assert.deepEqual(product.variants, []);
  assert.equal(product.variantType, "normal");
});

test("GET returns a generic no-store error response", async () => {
  const response = await createPublicCatalogGET(async () => {
    throw new Error("raw database failure with private row content");
  })();
  const payload = await body(response);

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(payload.error, "Could not load public catalog.");
  assert.equal(JSON.stringify(payload).includes("raw database failure"), false);
});

test("catalog stage timeout logs only sanitized local-test diagnostics", async () => {
  const originalEnv = process.env.FANZZY_ENV;
  const originalConsoleError = console.error;
  const logs = [];
  process.env.FANZZY_ENV = "local-test";
  console.error = (message) => logs.push(String(message));

  try {
    await assert.rejects(
      withCatalogStageTimeout("products", new Promise(() => {}), 5),
      /timed out at products/,
    );
  } finally {
    console.error = originalConsoleError;
    if (originalEnv === undefined) delete process.env.FANZZY_ENV;
    else process.env.FANZZY_ENV = originalEnv;
  }

  assert.equal(logs.length, 1);
  assert.match(logs[0], /operation=products/);
  assert.match(logs[0], /category=timeout/);
  assert.match(logs[0], /elapsedMs=\d+/);
  assert.equal(/key|token|secret|password|raw database|private row/i.test(logs[0]), false);
});

test("GET enforces the approved production image URL allowlist", async () => {
  const payload = await body(await createPublicCatalogGET(loadFixture)());
  const pub = payload.products.find((product) => product.sku === "PUB-1");
  const low = payload.products.find((product) => product.sku === "LOW-1");
  const sold = payload.products.find((product) => product.sku === "SOLD-1");
  const vendor = payload.products.find((product) => product.sku === "VENDOR-1");
  const archive = payload.categories.find((category) => category.name === "Archive");
  const blockedCategory = payload.categories.find((category) => category.name === "Blocked Category");

  assert.equal(pub.images.primary, allowedImage);
  assert.equal(pub.images.hover, allowedHover);
  assert.equal(pub.variants[0].image.endsWith("/storage/v1/object/public/fanzzy-assets/products/gold.webp"), true);
  assert.equal(pub.variants[1].image, undefined);
  assert.equal(low.images.primary, "");
  assert.equal(sold.images.primary, "");
  assert.equal(vendor.images.primary, "");
  assert.equal(payload.vendors[0].logoUrl, allowedVendorLogo);
  assert.equal(payload.vendors[0].coverUrl, undefined);
  assert.equal(archive.image, undefined);
  assert.equal(blockedCategory.image, undefined);
});
