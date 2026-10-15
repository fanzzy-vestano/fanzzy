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
