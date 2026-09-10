import assert from "node:assert/strict";
import test from "node:test";
import { mergeCatalogCategories, createProductCategoryResolver } from "../lib/catalog-categories.ts";

test("repeated shared/local category loads cannot multiply records", () => {
  const table = [{ name: "Earrings", section: "normal", pieces: 42, image: "earrings.jpg" }];
  let shared = [
    ...table,
    ...Array.from({ length: 23938 }, () => ({ name: "Bracelets L", section: "luxury", pieces: 7, image: "bracelets.jpg" })),
    ...Array.from({ length: 5442 }, () => ({ name: "Necklaces L", section: "luxury", pieces: 12, image: "necklaces.jpg" })),
  ];
  let local = structuredClone(shared);
  for (let load = 0; load < 12; load++) {
    shared = mergeCatalogCategories(table, shared, local);
    local = structuredClone(shared);
    assert.equal(shared.length, 3);
    assert.equal(shared[1].pieces, 7);
    assert.equal(shared[2].image, "necklaces.jpg");
  }
});

test("deduplication keeps normal/luxury identities and fills missing images without mutating input", () => {
  const rows = [
    { name: " Rings ", section: "normal", pieces: 10, image: "" },
    { name: "rings", section: "normal", pieces: 99, image: "rings.jpg" },
    { name: "Rings", section: "luxury", pieces: 4, image: "luxury.jpg" },
  ];
  const before = structuredClone(rows);
  const merged = mergeCatalogCategories(rows);
  assert.deepEqual(merged, [
    { name: "Rings", section: "normal", pieces: 10, image: "rings.jpg" },
    { name: "Rings", section: "luxury", pieces: 4, image: "luxury.jpg" },
  ]);
  assert.deepEqual(rows, before);
  assert.deepEqual(mergeCatalogCategories(merged, rows), merged);
});

test("category resolution handles explicit luxury, ambiguous names, and legacy categories", () => {
  const resolve = createProductCategoryResolver([
    { name: "Bracelets L", section: "luxury" },
    { name: "Rings", section: "normal" },
    { name: "Rings", section: "luxury" },
    { name: "Earrings" },
  ]);
  assert.equal(resolve("bracelets l"), "bracelets l · LX");
  assert.equal(resolve("Rings"), "Rings");
  assert.equal(resolve(" Rings · lx "), "Rings · LX");
  assert.equal(resolve("Earrings"), "Earrings");
  assert.equal(resolve("Unknown"), "Unknown");
  assert.equal(resolve(""), "");
});

test("category resolution never rescans the category array for each product", () => {
  let nameReads = 0;
  const categories = Array.from({ length: 29392 }, (_, i) => ({
    get name() { nameReads++; return i % 2 ? "Bracelets L" : "Necklaces L"; },
    section: "luxury",
  }));
  const resolve = createProductCategoryResolver(categories);
  assert.equal(nameReads, categories.length);
  for (let i = 0; i < 30000; i++) assert.equal(resolve("Bracelets L"), "Bracelets L · LX");
  assert.equal(nameReads, categories.length);
});
