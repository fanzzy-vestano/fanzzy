import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
function harness({ cached = false, failRead = false, failOpen = false, failWrite = false, offline = false } = {}) {
  const handlers = {};
  const tasks = [];
  let fetches = 0;
  const reject = () => { throw new DOMException("Cache quota exceeded", "QuotaExceededError"); };
  vm.runInNewContext(source, {
    self: { location: { origin: "https://local.invalid" }, addEventListener: (name, fn) => { handlers[name] = fn; }, skipWaiting() {}, clients: { claim() {} } },
    caches: {
      open: async () => {
        if (failOpen) reject();
        return { addAll: async () => { if (failWrite) reject(); }, put: async () => { if (failWrite) reject(); } };
      },
      match: async () => { if (failRead) reject(); return cached ? new Response("cached") : undefined; },
      keys: async () => { if (failOpen) reject(); return ["old-cache"]; },
      delete: async () => { if (failWrite) reject(); return true; },
    },
    fetch: async () => { fetches++; if (offline) throw new Error("offline"); return new Response("network", { status: 200 }); },
    Response, URL,
  });
  return {
    handlers, tasks, fetches: () => fetches,
    async request(path, mode = "cors", destination = "image") {
      let response;
      handlers.fetch({ request: { method: "GET", url: "https://local.invalid" + path, mode, destination },
        respondWith: promise => { response = promise; }, waitUntil: promise => { tasks.push(promise); } });
      const result = await response;
      await Promise.all(tasks);
      return result;
    },
  };
}

for (const failure of [{ failWrite: true }, { failOpen: true }, { failRead: true, failWrite: true }]) {
  test("optimized images preserve successful responses: " + JSON.stringify(failure), async () => {
    const h = harness(failure);
    const response = await h.request("/optimized/aaaaaaaaaaaaaaaaaaaa.webp");
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "network");
  });
}
for (const [path, mode, destination] of [["/", "navigate", "document"], ["/assets/app.js", "cors", "script"]]) {
  test("normal network response survives caching rejection: " + path, async () => {
    const h = harness({ failWrite: true });
    const response = await h.request(path, mode, destination);
    assert.equal(await response.text(), "network");
  });
}
test("worker installation and activation tolerate unavailable cache storage", async () => {
  const h = harness({ failOpen: true });
  for (const type of ["install", "activate"]) h.handlers[type]({ waitUntil: promise => h.tasks.push(promise) });
  await Promise.all(h.tasks);
});
test("cached optimized image is still used without another network request", async () => {
  const h = harness({ cached: true });
  assert.equal(await (await h.request("/optimized/aaaaaaaaaaaaaaaaaaaa.webp")).text(), "cached");
  assert.equal(h.fetches(), 0);
});
test("offline navigation uses cached content; missing/unavailable cache produces an error response", async () => {
  assert.equal(await (await harness({ cached: true, offline: true }).request("/", "navigate")).text(), "cached");
  assert.equal((await harness({ offline: true, failRead: true }).request("/", "navigate")).type, "error");
});

for (const failFirstPut of [false, true]) {
  test("cache stays bounded and quota retry preserves the app shell: " + failFirstPut, async () => {
    const listeners = {}, entries = new Map([["https://local.invalid/", "shell"]]);
    for (let i = 0; i < 170; i++) entries.set("https://local.invalid/old-" + i + ".webp", "old image");
    let puts = 0;
    const cache = {
      keys: async () => [...entries.keys()].map(url => ({ url })),
      delete: async request => entries.delete(request.url),
      put: async (request, response) => {
        const text = await response.text();
        if (++puts === 1 && failFirstPut) throw new DOMException("quota", "QuotaExceededError");
        entries.set(request.url, text);
      },
    };
    vm.runInNewContext(source, {
      self: { location: { origin: "https://local.invalid" }, addEventListener: (name, fn) => { listeners[name] = fn; } },
      caches: { open: async () => cache, match: async () => undefined },
      fetch: async () => new Response("new image"), Response, URL,
    });
    let response;
    const url = "https://local.invalid/optimized/aaaaaaaaaaaaaaaaaaaa.webp";
    listeners.fetch({ request: { method: "GET", url }, respondWith: value => { response = value; } });
    assert.equal(await (await response).text(), "new image");
    assert.equal(entries.get(url), "new image");
    assert.equal(entries.get("https://local.invalid/"), "shell");
    assert(entries.size <= 160);
    assert.equal(puts, failFirstPut ? 2 : 1);
  });
}
