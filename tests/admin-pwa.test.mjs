import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const readPublic = (path) => readFile(new URL(`../public/${path}`, import.meta.url));

test("admin has its own install identity and launches the authenticated admin route", async () => {
  const admin = JSON.parse(await readPublic("admin.webmanifest"));
  const store = JSON.parse(await readPublic("manifest.webmanifest"));
  assert.equal(admin.name, "Fanzzy Admin");
  assert.notEqual(admin.id, store.id);
  assert.equal(admin.start_url, "/admin");
  assert.equal(admin.scope, "/admin");
  assert.equal(admin.display, "standalone");
  assert.equal(store.start_url, "/");
  for (const size of ["192x192", "512x512"]) {
    const icon = admin.icons.find((item) => item.sizes === size && item.purpose === "any");
    assert.ok(icon, `Missing ${size} install icon`);
    const bytes = await readPublic(icon.src.slice(1));
    assert.equal(bytes.readUInt32BE(16), Number(size.split("x")[0]));
    assert.equal(bytes.readUInt32BE(20), Number(size.split("x")[1]));
  }
});

test("shared service worker forces fresh application code while leaving APIs alone", async () => {
  const listeners = new Map();
  const fetchOptions = [];
  vm.runInNewContext((await readPublic("sw.js")).toString(), {
    URL,
    Response,
    fetch: async (_request, options) => {
      fetchOptions.push(options);
      return new Response("network");
    },
    self: { location: { origin: "https://fanzzy.in" }, addEventListener: (type, handler) => listeners.set(type, handler) },
  });
  for (const path of ["/admin", "/admin/"]) {
    let intercepted = false;
    listeners.get("fetch")({
      request: { method: "GET", url: `https://fanzzy.in${path}`, mode: "navigate" },
      respondWith: () => { intercepted = true; },
    });
    assert.equal(intercepted, true, `${path} must bypass the document cache`);
  }
  assert.deepEqual(fetchOptions.map((options) => options?.cache), ["no-store", "no-store"]);

  let adminAssetIntercepted = false;
  listeners.get("fetch")({
    request: {
      method: "GET",
      url: "https://fanzzy.in/_next/static/chunks/admin.js",
      destination: "script",
      referrer: "https://fanzzy.in/admin/",
    },
    respondWith: () => { adminAssetIntercepted = true; },
    waitUntil: () => {},
  });
  assert.equal(adminAssetIntercepted, true, "admin scripts must bypass the asset cache");
  assert.equal(fetchOptions.at(-1)?.cache, "no-store");

  let storefrontAssetIntercepted = false;
  listeners.get("fetch")({
    request: {
      method: "GET",
      url: "https://fanzzy.in/_next/static/chunks/storefront.js",
      destination: "script",
      referrer: "about:client",
    },
    respondWith: () => { storefrontAssetIntercepted = true; },
    waitUntil: () => {},
  });
  assert.equal(storefrontAssetIntercepted, true, "scripts must not depend on an unreliable referrer");
  assert.equal(fetchOptions.at(-1)?.cache, "no-store");

  let intercepted = false;
  listeners.get("fetch")({
    request: { method: "GET", url: "https://fanzzy.in/api/admin/products", mode: "navigate" },
    respondWith: () => { intercepted = true; },
  });
  assert.equal(intercepted, false, "APIs must stay outside the service-worker cache");
});

test("a worker replacement reloads an already-controlled page", async () => {
  const install = await readFile(new URL("../app/pwa-install.tsx", import.meta.url), "utf8");
  assert.match(install, /controllerchange/);
  assert.match(install, /window\.location\.reload\(\)/);
  assert.match(install, /hadController/);
  assert.match(install, /updateViaCache:\s*"none"/);
});

test("admin reads recover once from an expired access token without retrying writes", async () => {
  const source = await readFile(new URL("../lib/site-api-client.ts", import.meta.url), "utf8");

  assert.match(source, /const method = \(init\.method \|\| "GET"\)\.toUpperCase\(\);/);
  assert.match(source, /firstResponse\.status !== 401 \|\| method !== "GET" \|\| !supabase/);
  assert.match(source, /supabase\.auth\.refreshSession\(\)/);
  assert.match(source, /if \(!refreshedToken \|\| refreshedToken === token\) return firstResponse;/);
  assert.match(source, /return siteApiFetch\(path, withBearer\(init, refreshedToken\)\);/);
});

test("admin order sync uses a fresh URL while customer reads retain their stable endpoint", async () => {
  const source = await readFile(new URL("../lib/supabase/catalog.ts", import.meta.url), "utf8");

  assert.match(source, /const adminOrdersPath = `\/admin\/orders\?sync=\$\{Date\.now\(\)\}`;/);
  assert.match(source, /adminApiFetch\(adminOrdersPath, \{ credentials: "include", cache: "no-store" \}\)/);
  assert.match(source, /customerApiFetch\("\/orders", \{ credentials: "include", cache: "no-store" \}\)/);
});

test("static Pages build never injects an admin password", async () => {
  const [viteConfig, adminPage] = await Promise.all([
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(viteConfig, /NEXT_PUBLIC_STATIC_BUILD/);
  assert.doesNotMatch(viteConfig, /NEXT_PUBLIC_STATIC_ADMIN_(?:EMAIL|PASSWORD)/);
  assert.match(adminPage, /supabase\.auth\.getSession\(\)/);
  assert.match(adminPage, /supabase\.auth\.signInWithPassword/);
  assert.doesNotMatch(adminPage, /fanzzy-github-pages-admin-authenticated/);
});

test("static admin validates cached sessions before showing live operations", async () => {
  const adminPage = await readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8");

  assert.match(adminPage, /const adminClient = supabase;/);
  assert.match(adminPage, /const hasVerifiedAdmin = async \(\) =>/);
  assert.match(adminPage, /adminClient\.auth\.getUser\(\)/);
  assert.match(adminPage, /adminClient\.auth\.refreshSession\(\)/);
  assert.match(adminPage, /data\.user\?\.email\?\.trim\(\)\.toLowerCase\(\) === expectedEmail/);
});

test("admin retains the external UPI label for POS orders", async () => {
  const adminPage = await readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8");

  assert.match(adminPage, /source\.posPaymentMethod === "External UPI"/);
});

test("production worker exposes authenticated Delhivery admin routes", async () => {
  const worker = await readFile(new URL("../worker/site-api.ts", import.meta.url), "utf8");
  assert.match(worker, /adminDelhiveryConfigRoute/);
  assert.match(worker, /adminDelhiveryCreateRoute/);
  assert.match(worker, /path === "\/admin\/delhivery\/config"\) return adminRoute/);
  assert.match(worker, /path === "\/admin\/delhivery\/create"\) return adminRoute/);
  assert.match(worker, /DELHIVERY_PICKUP_LOCATION\?: string/);
});

test("production worker exposes vendor order details and tracking", async () => {
  const worker = await readFile(new URL("../worker/site-api.ts", import.meta.url), "utf8");
  assert.match(worker, /vendorOrderTrackingRoute/);
  assert.match(worker, /segments\[0\] === "vendor" && segments\[1\] === "orders" && segments\[3\] === "tracking" && segments\.length === 4/);
  assert.match(worker, /params: Promise\.resolve\(\{ id: segments\[2\] \}\)/);
});

test("production worker exposes mobile pending order handoff", async () => {
  const worker = await readFile(new URL("../worker/site-api.ts", import.meta.url), "utf8");
  assert.match(worker, /mobilePendingOrderRoute/);
  assert.match(worker, /path === "\/orders\/mobile\/pending"\) return methodHandler\(request, mobilePendingOrderRoute\)/);
});
