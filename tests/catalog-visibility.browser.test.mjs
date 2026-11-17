import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

// Run against `npm run start -- --port 4173`. All remote data is intercepted;
// fixtures never write to Supabase, vendors, payments or production products.
test("built storefront separates general browsing from vendor browsing and carts", {
  skip: !process.env.CATALOG_BROWSER_URL,
  timeout: 120_000,
}, async () => {
  const require = createRequire(process.env.PLAYWRIGHT_MODULE_DIR
    ? resolve(process.env.PLAYWRIGHT_MODULE_DIR, "package.json") : import.meta.url);
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
  const failures = [];
  const fixtureProducts = [
    { sku: "GENERAL", name: "Fixture general earrings", category: "Earrings", stock: 3, price: 100, compare_at: 300, status: "Published", vendor_id: null },
    { sku: "LUXURY", name: "Fixture general luxury", category: "Rings · LX", stock: 2, price: 500, status: "Published", vendor_id: null },
    { sku: "VENDOR-A", name: "Fixture vendor A", category: "Earrings", stock: 3, price: 50, status: "Published", vendor_id: "a", vendor_status: "Approved", public_vendor_visible: true },
    { sku: "VENDOR-B", name: "Fixture vendor B", category: "Rings · LX", stock: 2, price: 60, status: "Published", vendor_id: "b", vendor_status: "Approved", public_vendor_visible: true },
    { sku: "DRAFT", name: "Fixture draft", category: "Earrings", stock: 2, price: 10, status: "Draft", vendor_id: null },
    { sku: "SOLD", name: "Fixture sold out", category: "Earrings", stock: 0, price: 80, status: "Published", vendor_id: null },
  ].map((row) => ({ ...row, image: "/fanzzy-mark.png", hover_image: "/fanzzy-mark.png" }));
  const vendors = ["a", "b", "empty"].map((id) => ({ id, slug: `fixture-${id}`, businessName: `Fixture Maker ${id.toUpperCase()}`, logoUrl: "/fanzzy-mark.png" }));
  await mkdir("work/catalog-visibility", { recursive: true });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: "block" });
      await context.routeWebSocket(/.*/, (socket) => socket.close());
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        if (url.pathname.startsWith("/rest/v1/")) {
          if (url.pathname.endsWith("/products")) {
            const rows = fixtureProducts.filter((row) => (!url.searchParams.has("status") || row.status !== "Draft") && (url.searchParams.get("vendor_id") !== "is.null" || !row.vendor_id));
            return json(rows);
          }
          if (url.pathname.endsWith("/categories")) return json([
            { name: "Earrings", section: "normal", pieces: 99, image: "/fanzzy-mark.png" },
            { name: "Rings", section: "luxury", pieces: 99, image: "/fanzzy-mark.png" },
            { name: "Empty", section: "normal", pieces: 99, image: "/fanzzy-mark.png" },
          ]);
          return json([]);
        }
        const vendorApiPath = url.hostname.endsWith("workers.dev") ? `/api${url.pathname}` : url.pathname;
        if (/\/api\/vendors$/.test(vendorApiPath)) return json({ vendors });
        if (/\/api\/vendors\//.test(vendorApiPath)) {
          const vendor = vendors.find((row) => url.pathname.endsWith(row.slug));
          return json({ vendor, products: fixtureProducts.filter((row) => row.vendor_id === vendor?.id && row.status !== "Draft") });
        }
        if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return json({});
        if (url.origin !== new URL(process.env.CATALOG_BROWSER_URL).origin) {
          return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>' });
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => failures.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
      page.on("requestfailed", (request) => { if (!request.failure()?.errorText.includes("ERR_ABORTED")) failures.push(request.url()); });
      page.on("response", (response) => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
      await page.goto(process.env.CATALOG_BROWSER_URL);
      await page.locator(".product-card").first().waitFor({ timeout: 15000 }).catch(async (error) => {
        console.error(JSON.stringify({ failures, body: (await page.locator("body").innerText()).slice(0, 1500) }));
        throw error;
      });
      assert.equal(await page.locator(".product-card").count(), 3);
      assert.doesNotMatch(await page.locator(".product-grid").innerText(), /Fixture vendor|Fixture draft/);
      assert.equal(await page.locator(".vendor-strip-card").count(), 3);
      assert.match(await page.locator(".normal-category-group").innerText(), /2 pieces/i);
      assert.match(await page.locator(".luxury-category-group").innerText(), /1 pieces/i);
      assert.match(await page.locator(".normal-category-group").innerText(), /0 pieces/i);
      await page.screenshot({ path: `work/catalog-visibility/home-${viewport.width}.png`, fullPage: true });
      if (viewport.width > 640) {
        await page.getByRole("textbox", { name: "Search jewellery" }).fill("Fixture vendor");
        assert.equal(await page.locator(".product-card").count(), 0);
        await page.getByRole("textbox", { name: "Search jewellery" }).fill("earrings");
        assert.equal(await page.locator(".product-card").count(), 2);
        await page.getByRole("textbox", { name: "Search jewellery" }).fill("");
      }
      await page.getByRole("combobox", { name: "Sort products" }).selectOption("price-high");
      assert.match(await page.locator(".product-card").first().innerText(), /Fixture general luxury/);
      await page.goto(`${process.env.CATALOG_BROWSER_URL}/?category=Earrings&section=normal#shop`);
      await page.waitForFunction(() => document.querySelectorAll(".product-card").length === 2);
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll(".product-card").length === 2);
      await page.goto(`${process.env.CATALOG_BROWSER_URL}/?category=Empty&section=normal#shop`);
      await page.getByText("No pieces found. Try another category or search.", { exact: true }).waitFor();
      await page.goto(`${process.env.CATALOG_BROWSER_URL}/collections`);
      await page.waitForFunction(() => [...document.querySelectorAll(".collection-card")].some((card) => card.textContent.includes("2 pieces")));
      assert.doesNotMatch(await page.locator(".collections-grid").innerText(), /99 pieces/);
      await page.goto(process.env.CATALOG_BROWSER_URL);
      await page.locator('.vendor-strip-card[href*="fixture-a"]').click();
      await page.locator(".vendor-product-card").first().waitFor();
      assert.equal(await page.locator(".vendor-product-card").count(), 1);
      assert.match(await page.locator(".vendor-product-grid").innerText(), /Fixture vendor A/);
      assert.doesNotMatch(await page.locator(".vendor-product-grid").innerText(), /Fixture vendor B/);
      await page.reload();
      await page.locator(".vendor-product-card").first().waitFor();
      await page.screenshot({ path: `work/catalog-visibility/vendor-${viewport.width}.png`, fullPage: true });
      await page.getByRole("button", { name: "Add to cart", exact: true }).click();
      await page.getByRole("link", { name: "View cart", exact: true }).click();
      await page.locator(".drawer-item").first().waitFor();
      assert.match(await page.locator(".drawer-item").first().innerText(), /Fixture vendor A/);
      assert.doesNotMatch(await page.locator(".product-grid").innerText(), /Fixture vendor/);
      await page.goto(`${process.env.CATALOG_BROWSER_URL}/vendors/store/?slug=fixture-empty`);
      await page.locator(".vendor-empty-state").waitFor();
      await context.close();
    }
    assert.deepEqual(failures, []);
  } finally { await browser.close(); }
});
