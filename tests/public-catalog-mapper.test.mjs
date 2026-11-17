import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicCatalogResponse, PUBLIC_CATALOG_VERSION } from "../lib/catalog/public-catalog-mapper.ts";

const baseInput = () => ({
  generatedAt: "2026-10-10T00:00:00.000Z",
  vendors: [
    {
      id: "vendor-public",
      slug: "public-store",
      business_name: "Public Store",
      logo_url: "https://pdrcrkxeyqxqgpwfxqpu.supabase.co/storage/v1/object/public/fanzzy-assets/vendors/logo.webp",
      cover_url: "https://pdrcrkxeyqxqgpwfxqpu.supabase.co/storage/v1/object/public/fanzzy-assets/vendors/cover.webp",
      description: "Public vendor description",
      featured: true,
      status: "Active",
      store_visibility: "Visible",
      login_email: "private-vendor@example.test",
      phone: "9999999999",
      account_number: "PRIVATE-BANK-ACCOUNT",
      ifsc_code: "PRIVATE-IFSC",
      pan_number: "PRIVATE-PAN",
    },
    { id: "vendor-hidden", slug: "hidden-store", business_name: "Hidden Store", status: "Active", store_visibility: "Hidden" },
    { id: "vendor-inactive", slug: "inactive-store", business_name: "Inactive Store", status: "Inactive", store_visibility: "Visible" },
  ],
  categories: [
    { name: "Earrings", pieces: 12, sort_order: 2, image: "https://cdn.example/earrings.webp", section: "normal" },
    { name: "Premium Rings", pieces: 0, sort_order: 4, image: "https://cdn.example/rings.webp" },
    { name: "Duplicate Premium Rings", pieces: 9, sort_order: 6, section: "luxury" },
  ],
  products: [
    {
      id: "PUB-1",
      sku: "PUB-1",
      name: "Published Earrings",
      category: "Earrings",
      stock: 4,
      price: 1000,
      compare_at: 1999,
      status: "Published",
      image: "https://pdrcrkxeyqxqgpwfxqpu.supabase.co/storage/v1/object/public/fanzzy-assets/products/pub.webp",
      hover_image: "https://pdrcrkxeyqxqgpwfxqpu.supabase.co/storage/v1/object/public/fanzzy-assets/products/pub-hover.webp",
      tag: "New",
      tone: "#fff",
      cost: 10,
      barcode: "12345",
      supplierName: "Secret Supplier",
      billName: "Private Bill Name",
      customer_email: "customer@example.test",
      order_id: "ORDER-PRIVATE",
      coupon_code: "PRIVATE-COUPON",
    },
    { sku: "LOW-1", name: "Low Stock Item", category: "Earrings", stock: 1, price: 500, status: "Low stock" },
    { sku: "SOLD-1", name: "Sold Out Item", category: "Earrings", stock: 0, price: 500, status: "Published" },
    { sku: "DRAFT-1", name: "Draft Hidden", category: "Earrings", stock: 4, price: 1000, status: "Draft" },
    { sku: "LST-AUR-01", name: "Aurora Drop Earrings", category: "Earrings", stock: 4, price: 1000, status: "Published" },
    { sku: "VENDOR-1", name: "Vendor Public Item", category: "Vendor Secret", stock: 3, price: 700, status: "Published", vendor_id: "vendor-public", vendor_status: "Approved", public_vendor_visible: true, vendor_rejection_reason: "PRIVATE-REJECTION" },
    { sku: "VENDOR-2", name: "Vendor Hidden Store Item", category: "Vendor Secret", stock: 3, price: 700, status: "Published", vendor_id: "vendor-hidden", vendor_status: "Approved", public_vendor_visible: true },
    { sku: "VENDOR-3", name: "Vendor Pending Item", category: "Vendor Secret", stock: 3, price: 700, status: "Published", vendor_id: "vendor-public", vendor_status: "Pending Approval", public_vendor_visible: true },
    { sku: "VENDOR-4", name: "Vendor Rejected Item", category: "Vendor Secret", stock: 3, price: 700, status: "Published", vendor_id: "vendor-public", vendor_status: "Rejected", public_vendor_visible: true },
    { sku: "VENDOR-5", name: "Vendor Private Item", category: "Vendor Secret", stock: 3, price: 700, status: "Published", vendor_id: "vendor-public", vendor_status: "Approved", public_vendor_visible: false },
    { sku: "LUX-1", name: "Luxury Ring", category: "Premium Rings", stock: 2, price: 5000, status: "Published" },
    { sku: "PC-1", name: "Product Category Bracelet", category: "Bracelets", stock: 2, price: 900, status: "Published" },
  ],
  settings: {
    productVariants: JSON.stringify({
      "PUB-1": [
        { name: "Gold", image: "https://cdn.example/gold.webp", stock: 2, adjustments: { zoom: 10, x: 100, y: -100, rotate: 300 } },
        { name: "Size 7", size: "7", image: "https://cdn.example/size-7.webp", stock: 1 },
      ],
    }),
    productVariantType: JSON.stringify({ "PUB-1": "size" }),
    productSizes: JSON.stringify({ "PUB-1": ["6", "7"] }),
    productSizeStock: JSON.stringify({ "PUB-1": { "6": 0, "7": 1 } }),
    productImageAdjustments: JSON.stringify({
      "PUB-1": {
        image: { zoom: 3, x: 75, y: -75, rotate: 250 },
        hoverImage: { zoom: 1.5, x: 10, y: 20, rotate: 30 },
        variants: [{ zoom: 4, x: 100, y: 100, rotate: 300 }],
      },
    }),
    categoryCatalog: JSON.stringify([
      { name: "Earrings", pieces: 99, sortOrder: 1, image: "https://cdn.example/catalog-earrings.webp", section: "normal" },
      { name: "Archive", pieces: 0, sortOrder: 8, section: "normal" },
    ]),
    vendorCategoryNames: JSON.stringify(["Vendor Secret"]),
  },
});

const json = (value) => JSON.stringify(value);

test("builds the stable public catalog response shape", () => {
  const result = buildPublicCatalogResponse(baseInput());

  assert.equal(result.version, PUBLIC_CATALOG_VERSION);
  assert.equal(result.generatedAt, "2026-10-10T00:00:00.000Z");
  assert.equal(result.meta.source, "fanzzy-catalog");
  assert.equal(result.meta.hasMore, false);
  assert.equal(result.meta.nextCursor, null);
  assert.ok(result.meta.unresolved.some((item) => /image-host allowlist/i.test(item)));
  assert.ok(result.meta.unresolved.some((item) => /Invoice display names/i.test(item)));
});

test("filters draft, demo, hidden vendor, pending, rejected, and private vendor products", () => {
  const result = buildPublicCatalogResponse(baseInput());
  const skus = result.products.map((product) => product.sku);

  assert.ok(skus.includes("PUB-1"));
  assert.ok(skus.includes("LOW-1"));
  assert.ok(skus.includes("SOLD-1"));
  assert.ok(skus.includes("VENDOR-1"));
  assert.ok(!skus.includes("DRAFT-1"));
  assert.ok(!skus.includes("LST-AUR-01"));
  assert.ok(!skus.includes("VENDOR-2"));
  assert.ok(!skus.includes("VENDOR-3"));
  assert.ok(!skus.includes("VENDOR-4"));
  assert.ok(!skus.includes("VENDOR-5"));
});

test("preserves sold-out and low-stock storefront states", () => {
  const result = buildPublicCatalogResponse(baseInput());
  const low = result.products.find((product) => product.sku === "LOW-1");
  const sold = result.products.find((product) => product.sku === "SOLD-1");

  assert.equal(low.status, "Low stock");
  assert.equal(low.badges.lowStock, true);
  assert.equal(low.badges.soldOut, false);
  assert.equal(sold.status, "Published");
  assert.equal(sold.badges.soldOut, true);
});

test("maps variants, sizes, size stock, image adjustments, and stored/display prices", () => {
  const result = buildPublicCatalogResponse(baseInput());
  const product = result.products.find((item) => item.sku === "PUB-1");

  assert.equal(product.price, 1000);
  assert.equal(product.storedCompareAt, 1999);
  assert.equal(product.displayDiscountPercent, 57);
  assert.equal(product.displayCompareAt, 2324);
  assert.equal(product.variantType, "size");
  assert.deepEqual(product.sizes, ["6", "7"]);
  assert.deepEqual(product.sizeStock, { "6": 0, "7": 1 });
  assert.equal(product.variants.length, 2);
  assert.deepEqual(product.images.adjustments, { zoom: 2, x: 50, y: -50, rotate: 180 });
  assert.deepEqual(product.variants[0].adjustments, { zoom: 2, x: 50, y: 50, rotate: 180 });
});

test("maps only public vendor fields and product vendor relationships", () => {
  const result = buildPublicCatalogResponse(baseInput());

  assert.deepEqual(result.vendors, [{
    id: "vendor-public",
    slug: "public-store",
    businessName: "Public Store",
    logoUrl: "https://pdrcrkxeyqxqgpwfxqpu.supabase.co/storage/v1/object/public/fanzzy-assets/vendors/logo.webp",
    coverUrl: "https://pdrcrkxeyqxqgpwfxqpu.supabase.co/storage/v1/object/public/fanzzy-assets/vendors/cover.webp",
    description: "Public vendor description",
    featured: true,
    visible: true,
  }]);
  assert.deepEqual(result.products.find((product) => product.sku === "VENDOR-1").vendor, {
    id: "vendor-public",
    name: "Public Store",
    slug: "public-store",
    visible: true,
  });
});

test("merges categories, inserts product-derived categories, and excludes vendor-private filters", () => {
  const result = buildPublicCatalogResponse(baseInput());
  const names = result.categories.map((category) => category.name);
  const earrings = result.categories.find((category) => category.name === "Earrings");
  const bracelets = result.categories.find((category) => category.name === "Bracelets");
  const premium = result.categories.find((category) => category.name === "Premium Rings");

  assert.ok(names.includes("Earrings"));
  assert.ok(names.includes("Bracelets"));
  assert.ok(names.includes("Archive"));
  assert.ok(!names.includes("Vendor Secret"));
  assert.equal(earrings.image, "https://cdn.example/earrings.webp");
  assert.equal(earrings.pieces, 3);
  assert.equal(bracelets.pieces, 1);
  assert.equal(premium.section, "normal");
});

test("handles malformed and missing settings safely", () => {
  const input = baseInput();
  input.settings = {
    productVariants: "{not json",
    productVariantType: "[]",
    productSizes: "",
    productSizeStock: null,
    productImageAdjustments: "false",
    categoryCatalog: "{bad",
    vendorCategoryNames: "{bad",
  };

  const result = buildPublicCatalogResponse(input);
  const product = result.products.find((item) => item.sku === "PUB-1");

  assert.deepEqual(product.variants, []);
  assert.deepEqual(product.sizes, []);
  assert.deepEqual(product.sizeStock, {});
  assert.equal(product.variantType, "normal");
  assert.equal(result.products.length > 0, true);
});

test("does not leak sensitive fields or private fixture values", () => {
  const result = buildPublicCatalogResponse(baseInput());
  const serialized = json(result);
  const forbidden = [
    "cost",
    "barcode",
    "supplier",
    "supplierName",
    "billName",
    "Private Bill Name",
    "Secret Supplier",
    "customer",
    "customer@example.test",
    "ORDER-PRIVATE",
    "coupon",
    "PRIVATE-COUPON",
    "login_email",
    "private-vendor@example.test",
    "phone",
    "account_number",
    "PRIVATE-BANK-ACCOUNT",
    "ifsc",
    "PRIVATE-IFSC",
    "pan_number",
    "PRIVATE-PAN",
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
