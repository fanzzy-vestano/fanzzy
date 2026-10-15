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
    { sku: "ZERO", name: "Fixture zero price", category: "Earrings", stock: 3, price: 0, status: "Published", vendor_id: null },
    { sku: "VENDOR-ZERO", name: "Fixture vendor zero price", category: "Earrings", stock: 3, price: 0, status: "Published", vendor_id: "a", vendor_status: "Approved", public_vendor_visible: true },
    { sku: "SOLD", name: "Fixture sold out", category: "Earrings", stock: 0, price: 80, status: "Published", vendor_id: null },
  ].map((row) => ({ ...row, image: "/fanzzy-mark.png", hover_image: "/fanzzy-mark.png" }));
  const vendors = ["a", "b", "empty"].map((id) => ({ id, slug: `fixture-${id}`, businessName: `Fixture Maker ${id.toUpperCase()}`, logoUrl: "/fanzzy-mark.png" }));
  await mkdir("work/catalog-visibility", { recursive: true });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: "block" });
      await context.routeWebSocket(/.*/, (socket) => socket.close());
      let offlineProducts = false;
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        if (url.pathname.startsWith("/rest/v1/")) {
          if (url.pathname.endsWith("/products")) {
            if (offlineProducts) return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "Fixture request failed" }) });
            const rows = fixtureProducts.filter((row) => (!url.searchParams.has("status") || row.status !== "Draft") && (url.searchParams.get("vendor_id") !== "is.null" || !row.vendor_id));
            return json(rows);
          }
          if (url.pathname.endsWith("/categories")) return json([
            { name: "Earrings", section: "normal", pieces: 99, image: "/fanzzy-mark.png" },
            { name: "Neclaces", section: "normal", pieces: 0, image: "/fanzzy-mark.png" },
            { name: "Necklace L", section: "normal", pieces: 0, image: "/fanzzy-mark.png" },
            { name: "Bracelet L", section: "normal", pieces: 0, image: "/fanzzy-mark.png" },
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
      let catalogRequests = 0;
      let pageLoads = 0;
      page.on("request", (request) => {
        if (request.url().includes("/rest/v1/products")) catalogRequests += 1;
      });
      page.on("load", () => { pageLoads += 1; });
      page.on("pageerror", (error) => failures.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
      page.on("requestfailed", (request) => { if (!request.failure()?.errorText.includes("ERR_ABORTED")) failures.push(request.url()); });
      page.on("response", (response) => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
      await page.goto(process.env.CATALOG_BROWSER_URL);
      await page.locator(".product-card").first().waitFor({ timeout: 15000 }).catch(async (error) => {
        console.error(JSON.stringify({ failures, body: (await page.locator("body").innerText()).slice(0, 1500) }));
        throw error;
      });
      assert.equal(await page.locator(".product-card").count(), 4);
      assert.doesNotMatch(await page.locator(".product-grid").innerText(), /Fixture vendor|Fixture draft/);
      assert.equal(await page.locator(".vendor-strip-card").count(), 3);
      assert.match(await page.locator(".normal-category-group").innerText(), /3 pieces/i);
      assert.match(await page.locator(".luxury-category-group").innerText(), /1 pieces/i);
      assert.match(await page.locator(".normal-category-group").innerText(), /0 pieces/i);
      assert.equal(await page.getByRole("button", { name: "Neclaces", exact: true }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "Necklace L", exact: true }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "Bracelet L", exact: true }).count(), 1);
      const zeroCard = page.locator(".product-card").filter({ hasText: "Fixture zero price" });
      assert.equal(await zeroCard.getByRole("button", { name: "Fixture zero price is unavailable", exact: true }).isDisabled(), true);
      assert.match(await zeroCard.innerText(), /Price unavailable/);
      await zeroCard.getByRole("button", { name: "Quick view" }).click();
      assert.equal(await page.locator(".quick-modal .quick-actions button").isDisabled(), true);
      await page.locator(".quick-modal .modal-close").click();
      // Regression: closing a detail overlay must reveal the same listing
      // instance, without a route reload or another catalogue request.
      await page.getByRole("combobox", { name: "Sort products" }).selectOption("price-high");
      await page.getByRole("button", { name: "Earrings", exact: true }).click();
      const listingBeforeDetail = await page.locator(".product-grid").innerText();
      const sortBeforeDetail = await page.getByRole("combobox", { name: "Sort products" }).inputValue();
      const cardBeforeDetail = page.locator(".product-card").first();
      await cardBeforeDetail.getByRole("button", { name: "Quick view" }).click();
      const scrollBeforeClose = await page.evaluate(() => window.scrollY);
      catalogRequests = 0;
      pageLoads = 0;
      await page.locator(".quick-modal .modal-close").click();
      await page.waitForTimeout(100);
      assert.equal(pageLoads, 0);
      assert.equal(catalogRequests, 0);
      assert.equal(await page.getByRole("combobox", { name: "Sort products" }).inputValue(), sortBeforeDetail);
      assert.equal(await page.locator(".product-grid").innerText(), listingBeforeDetail);
      assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBeforeClose) <= 2);
      await page.getByRole("button", { name: "All pieces", exact: true }).click();
      await page.getByRole("textbox", { name: "Search jewellery" }).fill("Fixture general");
      const searchListingBeforeDetail = await page.locator(".product-grid").innerText();
      catalogRequests = 0;
      pageLoads = 0;
      await page.locator(".product-card").first().getByRole("button", { name: "Quick view" }).click();
      await page.locator(".quick-modal .modal-close").click();
      await page.waitForTimeout(100);
      assert.equal(pageLoads, 0);
      assert.equal(catalogRequests, 0);
      assert.equal(await page.getByRole("textbox", { name: "Search jewellery" }).inputValue(), "Fixture general");
      assert.equal(await page.locator(".product-grid").innerText(), searchListingBeforeDetail);
      await page.getByRole("textbox", { name: "Search jewellery" }).fill("");
      await page.screenshot({ path: `work/catalog-visibility/home-${viewport.width}.png`, fullPage: true });
      if (viewport.width > 640) {
        await page.getByRole("textbox", { name: "Search jewellery" }).fill("Fixture vendor");
        assert.equal(await page.locator(".product-card").count(), 0);
        await page.getByRole("textbox", { name: "Search jewellery" }).fill("earrings");
        assert.equal(await page.locator(".product-card").count(), 3);
        await page.getByRole("textbox", { name: "Search jewellery" }).fill("");
      }
      await page.getByRole("combobox", { name: "Sort products" }).selectOption("price-high");
      // The section order is stable even when the customer changes the sort:
      // normal products are listed before luxury products.
      assert.match(await page.locator(".product-card").first().innerText(), /Fixture general earrings/);
      assert.match(await page.locator(".product-card").last().innerText(), /Fixture general luxury/);
      await page.goto(`${process.env.CATALOG_BROWSER_URL}/?category=Earrings&section=normal#shop`);
      await page.waitForFunction(() => document.querySelectorAll(".product-card").length === 3);
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll(".product-card").length === 3);
      await page.goto(`${process.env.CATALOG_BROWSER_URL}/?category=Empty&section=normal#shop`);
      await page.getByText("No pieces found. Try another category or search.", { exact: true }).waitFor();
      await page.goto(`${process.env.CATALOG_BROWSER_URL}/collections`);
      await page.waitForFunction(() => [...document.querySelectorAll(".collection-card")].some((card) => card.textContent.includes("3 pieces")));
      // Collections and Admin use the same Fanzzy-owned product count.
      const earringsCollection = page.locator(".collection-card").filter({ hasText: "Earrings" }).first();
      assert.match(await earringsCollection.innerText(), /3 pieces/i);
      await page.goto(process.env.CATALOG_BROWSER_URL);
      await page.locator('.vendor-strip-card[href*="fixture-a"]').click();
      await page.locator(".vendor-product-actions").first().waitFor();
      assert.equal(await page.locator(".vendor-product-card").count(), 2);
      assert.match(await page.locator(".vendor-product-grid").innerText(), /Fixture vendor A/);
      assert.doesNotMatch(await page.locator(".vendor-product-grid").innerText(), /Fixture vendor B/);
      assert.equal(await page.locator(".vendor-product-card").filter({ hasText: "Fixture vendor zero price" }).getByRole("button", { name: "Unavailable", exact: true }).isDisabled(), true);
      const vendorListingBeforeDetail = await page.locator(".vendor-product-grid").innerText();
      const vendorProductRequestsBeforeDetail = catalogRequests;
      pageLoads = 0;
      await page.locator(".vendor-product-quick-button").first().click();
      await page.locator(".quick-modal .modal-close").click();
      await page.waitForTimeout(100);
      assert.equal(pageLoads, 0);
      assert.equal(catalogRequests, vendorProductRequestsBeforeDetail);
      assert.equal(await page.locator(".vendor-product-grid").innerText(), vendorListingBeforeDetail);
      await page.reload();
      await page.locator(".vendor-product-actions").first().waitFor();
      await page.screenshot({ path: `work/catalog-visibility/vendor-${viewport.width}.png`, fullPage: true });
      await page.getByRole("button", { name: "Add to cart", exact: true }).click();
      await page.getByRole("link", { name: "View cart", exact: true }).click();
      await page.locator(".drawer-item").first().waitFor();
      assert.match(await page.locator(".drawer-item").first().innerText(), /Fixture vendor A/);
      assert.doesNotMatch(await page.locator(".product-grid").innerText(), /Fixture vendor/);
      // A stale cart containing an unpriced product must not reach checkout.
      await page.evaluate(() => localStorage.setItem("fanzzy-cart:guest", JSON.stringify({ zero: 1, "vendor-a": 1 })));
      await page.goto(`${process.env.CATALOG_BROWSER_URL}/?fanzzy-cart-action=view`);
      await page.locator(".cart-drawer").waitFor();
      assert.equal(await page.locator(".cart-drawer").getByRole("button", { name: "Proceed to buy" }).isDisabled(), true);
      await page.getByRole("button", { name: "Remove unavailable items", exact: true }).click();
      assert.equal(await page.locator(".cart-drawer").getByRole("button", { name: "Proceed to buy" }).isEnabled(), true);
      await page.goto(`${process.env.CATALOG_BROWSER_URL}/vendors/store/?slug=fixture-empty`);
      await page.locator(".vendor-empty-state").waitFor();
      // Simulate admin overwriting the legacy shared cache without ownership.
      // The offline homepage must use its verified storefront snapshot instead.
      await page.evaluate(() => localStorage.setItem("fanzzy-products", JSON.stringify([{ sku: "LEAK", name: "Leaked vendor from admin cache", price: 10, stock: 2, category: "Earrings" }])));
      offlineProducts = true;
      const offlinePage = await context.newPage();
      await offlinePage.goto(process.env.CATALOG_BROWSER_URL);
      await offlinePage.waitForFunction(() => document.querySelectorAll(".product-card").length === 4);
      assert.doesNotMatch(await offlinePage.locator(".product-grid").innerText(), /Leaked vendor/);
      await context.close();
    }
    assert.deepEqual(failures, []);
  } finally { await browser.close(); }
});
