import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);
const docs = new URL("../docs/", import.meta.url);

const routes = [
  "404.html",
  "index.html",
  "admin/index.html",
  "collections/index.html",
  "track-order/index.html",
  "vendor/index.html",
  "vendor/login/index.html",
  "vendors/index.html",
  "vendors/store/index.html",
];

test("exports every public GitHub Pages route", async () => {
  for (const route of routes) {
    const html = await readFile(new URL(route, docs), "utf8");
    assert.match(html, /<!DOCTYPE html>/i, route);
    assert.match(html, /<meta name="viewport"/i, route);
    assert.doesNotMatch(html, /chatgpt|openai|codex-preview|_sites-preview/i, route);
  }
  assert.equal((await readFile(new URL("CNAME", docs), "utf8")).trim(), "fanzzy.in");
  await access(new URL(".nojekyll", docs));
});

test("homepage links customers to Fanzzy support", async () => {
  const html = await readFile(new URL("index.html", docs), "utf8");
  const footer = html.match(/<footer\b[\s\S]*?<\/footer>/)?.[0] ?? "";
  assert.match(footer, /href="#contact-details">Contact us/);
  assert.match(footer, /id="contact-details"[^>]*>\s*<a href="tel:\+919249536162"/);
  assert.match(footer, /href="mailto:fanzzy@vestanoretail\.com"/);
  assert.match(footer, /href="https:\/\/wa\.me\/919249536162"[^>]*>WhatsApp/);
});

test("ships the external APIs required by the static application", async () => {
  const assetNames = (await readdir(new URL("assets/", docs))).filter((name) => name.endsWith(".js"));
  const bundles = await Promise.all(assetNames.map((name) => readFile(new URL(`assets/${name}`, docs), "utf8")));
  const javascript = bundles.join("\n");
  assert.match(javascript, /fanzzy-razorpay-api\.fanzzy\.workers\.dev/);
  assert.match(javascript, /functions\/v1\/customer-auth/);
  assert.ok(/\.functions\.invoke\([`'"]pos-checkout/.test(javascript), "Pages must invoke the Supabase POS checkout function");
  assert.ok(!/\/admin\/pos-checkout\b/.test(javascript), "Pages must omit the server-only POS checkout path");
  assert.match(javascript, /fanzzy-vendor-session-token/);
  assert.match(javascript, /vendors\/store\/\?slug=/);
});

test("ships valid manifests and every required icon", async () => {
  for (const manifestName of ["manifest.webmanifest", "admin.webmanifest"]) {
    const manifest = JSON.parse(await readFile(new URL(manifestName, docs), "utf8"));
    assert.equal(typeof manifest.name, "string");
    assert.ok(manifest.name.length > 0);
    assert.ok(Array.isArray(manifest.icons));
    assert.ok(manifest.icons.length >= 2);
    for (const icon of manifest.icons) {
      assert.equal(typeof icon.src, "string");
      await access(join(fileURLToPath(docs), icon.src.replace(/^\//, "")));
    }
  }
  await access(new URL("sw.js", docs));
  await access(new URL("favicon.svg", docs));
});

test("does not publish private environment files", async () => {
  const published = await readdir(docs, { recursive: true });
  assert.equal(published.some((name) => /(^|[\\/])\.env(?:\.|$)/i.test(name)), false);
  assert.equal(published.some((name) => /hosting\.json$/i.test(name)), false);
  await assert.rejects(access(new URL(".openai/hosting.json", root)));
});
