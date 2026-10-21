import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { loadBrowserStorage, loadBrowserModule } from "./helpers/browser-storage-fixture.mjs";

const { IDBFactory } = createRequire(import.meta.url)("fake-indexeddb");
function browser(indexedDB = new IDBFactory(), values = new Map(), mode = "full") {
  return {
    indexedDB, dispatchEvent() {},
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { if (mode !== "normal") throw new DOMException("full", "QuotaExceededError"); values.set(key, value); },
      removeItem: key => { if (mode === "blocked") throw new DOMException("blocked", "SecurityError"); values.delete(key); },
    },
  };
}

test("login, account/guest carts, variants, sizes and promotions survive fresh documents with full storage", async () => {
  const idb = new IDBFactory();
  const first = loadBrowserStorage(browser(idb));
  const expected = {
    "fanzzy-customer-session-token": "LOCAL_SESSION",
    "fanzzy-vendor-session-token": "LOCAL_VENDOR",
    "fanzzy-cart:guest": '{"ring":2}',
    "fanzzy-cart:customer": '{"shirt":1}',
    "fanzzy-cart-variants:customer": '{"shirt":{"name":"Blue"}}',
    "fanzzy-cart-sizes:customer": '{"shirt":"S"}',
    "fanzzy-cart-promotions:customer": '{"shirt":{"role":"free"}}',
    "fanzzy-store-profile": '{"storeName":"Local store"}',
    "fanzzy-shipping-rules": '{"freeAbove":"999"}',
  };
  for (const [key, value] of Object.entries(expected)) first.browserLocalStorage.setItem(key, value);
  assert.equal(await first.flushBrowserStorage(), true);
  const fresh = loadBrowserStorage(browser(idb));
  await fresh.prepareBrowserStorage();
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(fresh.browserLocalStorage.getItem(key), value, key);
    assert.equal(fresh.browserLocalStorage.isPersistent(key), true);
  }
});

test("logout tombstones beat stale native tokens after refresh", async () => {
  const idb = new IDBFactory(), values = new Map([["fanzzy-customer-session-token", "STALE"]]);
  const first = loadBrowserStorage(browser(idb, values, "blocked"));
  first.browserLocalStorage.setItem("fanzzy-customer-session-token", "NEW");
  await first.flushBrowserStorage();
  first.browserLocalStorage.removeItem("fanzzy-customer-session-token");
  assert.equal(await first.flushBrowserStorage(), true);
  assert.equal(values.get("fanzzy-customer-session-token"), "STALE");
  const fresh = loadBrowserStorage(browser(idb, values));
  await fresh.prepareBrowserStorage();
  assert.equal(fresh.browserLocalStorage.getItem("fanzzy-customer-session-token"), null);
});

test("hydration cannot overwrite a newer write or resurrect a deleted cart", async () => {
  const idb = new IDBFactory(), first = loadBrowserStorage(browser(idb));
  first.browserLocalStorage.setItem("fanzzy-cart:guest", '{"old":1}');
  await first.flushBrowserStorage();
  const second = loadBrowserStorage(browser(idb));
  const hydration = second.prepareBrowserStorage();
  second.browserLocalStorage.setItem("fanzzy-cart:guest", '{"new":2}');
  await hydration; await second.flushBrowserStorage();
  assert.equal(second.browserLocalStorage.getItem("fanzzy-cart:guest"), '{"new":2}');
  second.browserLocalStorage.removeItem("fanzzy-cart:guest");
  await second.flushBrowserStorage();
  const third = loadBrowserStorage(browser(idb)); await third.prepareBrowserStorage();
  assert.equal(third.browserLocalStorage.getItem("fanzzy-cart:guest"), null);
});

test("guest-to-account migration commits all cart buckets together", async () => {
  const idb = new IDBFactory(), storage = loadBrowserStorage(browser(idb));
  storage.browserLocalStorage.setItem("fanzzy-cart:guest", '{"ring":2}');
  storage.browserLocalStorage.setItem("fanzzy-cart-sizes:guest", '{"ring":"S"}');
  await storage.flushBrowserStorage();
  storage.batchBrowserStorage(() => {
    storage.browserLocalStorage.setItem("fanzzy-cart:customer", '{"ring":2}');
    storage.browserLocalStorage.setItem("fanzzy-cart-sizes:customer", '{"ring":"S"}');
    storage.browserLocalStorage.removeItem("fanzzy-cart:guest");
    storage.browserLocalStorage.removeItem("fanzzy-cart-sizes:guest");
  });
  await storage.flushBrowserStorage();
  const fresh = loadBrowserStorage(browser(idb)); await fresh.prepareBrowserStorage();
  assert.equal(fresh.browserLocalStorage.getItem("fanzzy-cart:guest"), null);
  assert.equal(fresh.browserLocalStorage.getItem("fanzzy-cart-sizes:guest"), null);
  assert.equal(fresh.browserLocalStorage.getItem("fanzzy-cart:customer"), '{"ring":2}');
  assert.equal(fresh.browserLocalStorage.getItem("fanzzy-cart-sizes:customer"), '{"ring":"S"}');
});

test("unavailable IndexedDB still permits durable native storage and rejects false durability", async () => {
  const blocked = { open() { throw new DOMException("blocked", "SecurityError"); } };
  for (const mode of ["normal", "full"]) {
    const storage = loadBrowserStorage(browser(blocked, new Map(), mode));
    storage.browserLocalStorage.setItem("fanzzy-cart:guest", '{"ring":1}');
    assert.equal(await storage.flushBrowserStorage(), mode === "normal");
    assert.equal(storage.browserLocalStorage.getItem("fanzzy-cart:guest"), '{"ring":1}');
  }
});

test("an aborted cart migration preserves the previous durable cart", async () => {
  const idb = new IDBFactory(), storage = loadBrowserStorage(browser(idb));
  storage.browserLocalStorage.setItem("fanzzy-cart:guest", '{"ring":2}');
  await storage.flushBrowserStorage();
  const db = await storage.prepareBrowserStorage(), original = db.transaction.bind(db);
  db.transaction = (...args) => {
    const transaction = original(...args);
    if (args[1] === "readwrite") {
      const originalStore = transaction.objectStore.bind(transaction);
      transaction.objectStore = name => {
        const store = originalStore(name), originalPut = store.put.bind(store);
        store.put = value => { if (value.key === "fanzzy-cart:guest") throw new DOMException("quota", "QuotaExceededError"); return originalPut(value); };
        return store;
      };
    }
    return transaction;
  };
  storage.batchBrowserStorage(() => {
    storage.browserLocalStorage.setItem("fanzzy-cart:customer", '{"ring":2}');
    storage.browserLocalStorage.removeItem("fanzzy-cart:guest");
  });
  assert.equal(await storage.flushBrowserStorage(), false);
  const fresh = loadBrowserStorage(browser(idb)); await fresh.prepareBrowserStorage();
  assert.equal(fresh.browserLocalStorage.getItem("fanzzy-cart:guest"), '{"ring":2}');
  assert.equal(fresh.browserLocalStorage.getItem("fanzzy-cart:customer"), null);
});

test("POS lost response survives refresh and reuses the exact persisted request", async () => {
  const idb = new IDBFactory(), sent = [], order = { id: "#FZ-POS-LOCAL001", total: "₹55", posPaymentMethod: "Cash", items: [{ productId: "RING", quantity: 1, price: "₹55" }] };
  let uncertain = true;
  const api = { adminApiFetch: async (_path, init) => {
    sent.push(JSON.parse(init.body).order);
    return uncertain ? Response.json({ error: "lost response" }, { status: 502 }) : Response.json({ order: sent[0], orders: [sent[0]], products: [], replayed: true });
  } };
  const win = browser(idb), storage = loadBrowserStorage(win);
  const first = loadBrowserModule("lib/pos-sale-client.ts", win, { "./site-api-client": api }, storage);
  await assert.rejects(first.commitAtomicPosSale(order), /lost response/);
  const nextWindow = browser(idb), nextStorage = loadBrowserStorage(nextWindow);
  await nextStorage.prepareBrowserStorage();
  const second = loadBrowserModule("lib/pos-sale-client.ts", nextWindow, { "./site-api-client": api }, nextStorage);
  assert.deepEqual(second.readPendingPosSale(), order);
  await assert.rejects(second.commitAtomicPosSale({ ...order, total: "₹99" }), /needs confirmation first/);
  assert.equal(sent.length, 1);
  uncertain = false;
  const result = await second.commitAtomicPosSale(order);
  assert.equal(result.replayed, true); assert.deepEqual(sent[0], sent[1]);
  const fresh = loadBrowserStorage(browser(idb)); await fresh.prepareBrowserStorage();
  assert.equal(fresh.browserLocalStorage.getItem("fanzzy-pos-sale-attempt"), null);
});

test("POS refuses to submit when every durable storage mechanism is unavailable", async () => {
  const win = browser(); Object.defineProperty(win, "indexedDB", { get() { throw new DOMException("blocked", "SecurityError"); } });
  const storage = loadBrowserStorage(win);
  const api = loadBrowserModule("lib/pos-sale-client.ts", win, { "./site-api-client": { adminApiFetch: () => { throw new Error("Must not submit"); } } }, storage);
  await assert.rejects(api.commitAtomicPosSale({ id: "#FZ-POS-LOCAL001", items: [{}] }), /No sale was submitted/);
});
