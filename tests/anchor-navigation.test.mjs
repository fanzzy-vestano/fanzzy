import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pageSource = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("storefront has one stable top anchor and explicit About/logo navigation", () => {
  assert.equal((pageSource.match(/id=\"top\"/g) ?? []).length, 1);
  assert.match(pageSource, /const scrollToPageAnchor =/);
  assert.match(pageSource, /onClick=\{\(event\) => scrollToPageAnchor\(event, \"top\"\)\}/);
  assert.match(pageSource, /href=\"#footer\" onClick=\{\(event\) => scrollToPageAnchor\(event, \"footer\"\)\}/);
  assert.match(pageSource, /window\.addEventListener\(\"popstate\", onHistoryNavigation\)/);
});

test("storefront navbar anchors use the same-page navigation helper", () => {
  for (const anchor of ["shop", "categories", "story"]) {
    assert.match(
      pageSource,
      new RegExp(`href=\\"#${anchor}\\" onClick=\\{\\(event\\) => scrollToPageAnchor\\(event, \\\"${anchor}\\\"\\)\\}`),
    );
  }
  assert.match(pageSource, /closeMobileNav\(\); scrollToPageAnchor\(event, \"shop\"\)/);
  assert.match(pageSource, /closeMobileNav\(\); scrollToPageAnchor\(event, \"categories\"\)/);
  assert.match(pageSource, /closeMobileNav\(\); scrollToPageAnchor\(event, \"story\"\)/);
  assert.match(pageSource, /const closeMobileNav = useCallback/);
  assert.match(pageSource, /mobileNavOpen \? closeMobileNav\(\) : setMobileNavOpen\(true\)/);
  const helperStart = pageSource.indexOf("const scrollToPageAnchor =");
  const helperEnd = pageSource.indexOf("const overlayReturnScrollStorageKey", helperStart);
  assert.doesNotMatch(pageSource.slice(helperStart, helperEnd), /window\.history\.(pushState|replaceState)|window\.location\.hash/);
});

test("homepage Shop all link stays on the product listing", () => {
  assert.match(pageSource, /<a className="text-link" href="#shop" onClick=\{\(event\) => scrollToPageAnchor\(event, "shop"\)\}>Shop all/);
  assert.match(pageSource, /Retry loading pieces/);
});

test("storefront scroll restoration is cancellable and does not force a fake footer height", () => {
  const helperStart = pageSource.indexOf("const restoreStorefrontScrollPosition =");
  const helperEnd = pageSource.indexOf("const blockedHeroImage", helperStart);
  const helper = pageSource.slice(helperStart, helperEnd);
  assert.match(helper, /cancelStorefrontScrollRestore\?\.\(\)/);
  assert.match(helper, /addEventListener\("wheel", cancel, true\)/);
  assert.match(helper, /attempts < 180/);
  assert.doesNotMatch(helper, /style\.minHeight/);
});

test("catalog refreshes coalesce concurrent realtime and storage updates", () => {
  const effectStart = pageSource.indexOf("let syncPromise: Promise<void> | null = null;");
  const effectEnd = pageSource.indexOf("const onProductsStorage", effectStart);
  const catalogEffect = pageSource.slice(effectStart, effectEnd);
  assert.match(catalogEffect, /let syncQueued = false;/);
  assert.match(catalogEffect, /if \(syncPromise\) \{\s*syncQueued = true;/s);
  assert.match(catalogEffect, /do \{[\s\S]*?await syncProducts\(\);[\s\S]*?while \(active && syncQueued\);/);
  assert.match(catalogEffect, /finally\(\(\) => \{\s*syncPromise = null;/s);
  assert.doesNotMatch(catalogEffect, /subscribeToStoreSetting\([^\n]+syncProducts/);
});
