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

test("shared service worker leaves admin pages and APIs network-only", async () => {
  const listeners = new Map();
  vm.runInNewContext((await readPublic("sw.js")).toString(), {
    URL,
    self: { location: { origin: "https://fanzzy.in" }, addEventListener: (type, handler) => listeners.set(type, handler) },
  });
  for (const path of ["/admin", "/admin/", "/api/admin/products"]) {
    let intercepted = false;
    listeners.get("fetch")({
      request: { method: "GET", url: `https://fanzzy.in${path}`, mode: "navigate" },
      respondWith: () => { intercepted = true; },
    });
    assert.equal(intercepted, false, `${path} must not be cached`);
  }
});
