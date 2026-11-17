type StoreKind = "localStorage" | "sessionStorage";
type StoreState = {
  overrides: Map<string, string | null>;
  lastKnown: Map<string, string>;
  durable: Map<string, string | null>;
  changed: Map<string, string | null>;
  ready?: Promise<IDBDatabase | null>;
  queue: Promise<void>;
  batch?: Map<string, string | null>;
  pending: Map<string, number>;
  channel?: BroadcastChannel;
};

// Isolate fallback state by browser window. SSR must never retain user tokens
// in a module-wide store shared between requests.
const windows = new WeakMap<Window, Map<StoreKind, StoreState>>();

function stateFor(kind: StoreKind): StoreState | null {
  if (typeof window === "undefined") return null;
  let stores = windows.get(window);
  if (!stores) { stores = new Map(); windows.set(window, stores); }
  let state = stores.get(kind);
  if (!state) {
    state = { overrides: new Map(), lastKnown: new Map(), durable: new Map(), changed: new Map(), pending: new Map(), queue: Promise.resolve() };
    stores.set(kind, state);
  }
  return state;
}

// Only irreplaceable state belongs in this backup. Catalog images and order
// caches must never crowd out credentials, carts, or an uncertain POS attempt.
const criticalKey = (key: string) => /^fanzzy-(?:(?:customer-(?:pending-token|session-token|remembered-user)|vendor-session-token|pos-sale-attempt|store-profile|shipping-rules)$|cart(?::|-variants:|-sizes:|-promotions:))/.test(key);

function watchOtherDocuments(state: StoreState, db: IDBDatabase) {
  try {
    state.channel = new window.BroadcastChannel("fanzzy-critical-state");
    state.channel.onmessage = event => {
      const keys = Array.isArray(event.data) ? event.data.filter((key): key is string => typeof key === "string" && criticalKey(key)) : [];
      if (!keys.length) return;
      try {
        const transaction = db.transaction("state", "readonly");
        const reads = keys.map(key => ({ key, read: transaction.objectStore("state").get(key) }));
        transaction.oncomplete = () => {
          for (const { key, read } of reads) {
            if (state.pending.get(key) || !read.result) continue;
            const value: unknown = read.result.value;
            if (value !== null && typeof value !== "string") continue;
            state.durable.set(key, value); state.overrides.set(key, value); state.changed.delete(key);
            try { window.dispatchEvent(new StorageEvent("storage", { key, newValue: value })); } catch { /* no UI */ }
          }
        };
      } catch { /* another document's unavailable backup must not interrupt this visit */ }
    };
  } catch { /* BroadcastChannel is optional; reload still restores committed state. */ }
}

export function prepareBrowserStorage(): Promise<IDBDatabase | null> {
  const state = stateFor("localStorage");
  if (!state) return Promise.resolve(null);
  if (state.ready) return state.ready;
  state.ready = new Promise(resolve => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => { if (!settled) { settled = true; clearTimeout(timer); resolve(db); } };
    const timer = setTimeout(() => finish(null), 3000);
    try {
      const request = window.indexedDB.open("fanzzy-critical-state", 1);
      request.onupgradeneeded = () => { request.result.createObjectStore("state", { keyPath: "key" }); };
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        db.onversionchange = () => db.close();
        try {
          const transaction = db.transaction("state", "readonly");
          const read = transaction.objectStore("state").getAll();
          transaction.onabort = () => { db.close(); finish(null); };
          transaction.oncomplete = () => {
            if (settled) { db.close(); return; }
            for (const row of read.result as Array<{ key: string; value: string | null }>) {
              if (!criticalKey(row.key) || (row.value !== null && typeof row.value !== "string")) continue;
              state.durable.set(row.key, row.value);
              if (!state.changed.has(row.key)) state.overrides.set(row.key, row.value);
            }
            watchOtherDocuments(state, db);
            finish(db);
          };
        } catch { db.close(); finish(null); }
      };
    } catch { finish(null); }
  });
  return state.ready;
}

function backUp(state: StoreState, key: string, value: string | null) {
  if (!criticalKey(key)) return;
  state.changed.set(key, value);
  if (state.batch) { state.batch.set(key, value); return; }
  enqueueBackup(state, new Map([[key, value]]));
}

function enqueueBackup(state: StoreState, changes: Map<string, string | null>) {
  for (const key of changes.keys()) state.pending.set(key, (state.pending.get(key) || 0) + 1);
  const ready = prepareBrowserStorage();
  state.queue = state.queue.then(async () => {
    const db = await ready;
    if (!db) return;
    await new Promise<void>(resolve => {
      let settled = false;
      let transaction: IDBTransaction | undefined;
      const finish = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } };
      const abort = () => { try { transaction?.abort(); } catch { /* already completed */ } finish(); };
      const timer = setTimeout(abort, 3000);
      try {
        transaction = db.transaction("state", "readwrite");
        // Keep deletion tombstones, so stale localStorage cannot revive tokens.
        for (const [key, value] of changes) transaction.objectStore("state").put({ key, value });
        transaction.oncomplete = () => {
          for (const [key, value] of changes) state.durable.set(key, value);
          try { state.channel?.postMessage([...changes.keys()]); } catch { /* document is closing */ }
          finish();
        };
        transaction.onabort = finish;
        transaction.onerror = () => { /* abort reports completion */ };
      } catch { abort(); }
    });
  }).catch(() => undefined).finally(() => {
    for (const key of changes.keys()) {
      const count = (state.pending.get(key) || 1) - 1;
      if (count) state.pending.set(key, count); else state.pending.delete(key);
    }
  });
}

// Guest-to-account cart migration must never delete the only durable copy.
export function batchBrowserStorage(update: () => void): void {
  const state = stateFor("localStorage");
  if (!state || state.batch) { update(); return; }
  state.batch = new Map();
  try { update(); }
  finally {
    const changes = state.batch;
    state.batch = undefined;
    if (changes.size) enqueueBackup(state, changes);
  }
}

export async function flushBrowserStorage(): Promise<boolean> {
  const state = stateFor("localStorage");
  if (!state) return false;
  await prepareBrowserStorage();
  await state.queue;
  let persistent = true;
  for (const [key, value] of state.changed) {
    if (state.durable.has(key) && state.durable.get(key) === value) continue;
    // A failed deletion in the backup must not resurrect an earlier login.
    if (state.durable.has(key)) { persistent = false; break; }
    try { if (window.localStorage.getItem(key) === value) continue; } catch { /* unavailable */ }
    persistent = false; break;
  }
  try { window.dispatchEvent(new CustomEvent("fanzzy-storage-persistence", { detail: { persistent } })); } catch { /* no UI */ }
  return persistent;
}

function createBrowserStore(kind: StoreKind) {
  const keys = (): string[] => {
    const state = stateFor(kind);
    if (!state) return [];
    const result = new Set<string>();
    try {
      const store = window[kind];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key !== null) result.add(key);
      }
    } catch {
      for (const key of state.lastKnown.keys()) result.add(key);
    }
    for (const [key, value] of state.overrides) {
      if (value === null) result.delete(key);
      else result.add(key);
    }
    return [...result];
  };

  return {
    get length() { return keys().length; },
    key(index: number): string | null { return keys()[index] ?? null; },
    isPersistent(key: string): boolean {
      const state = stateFor(kind);
      if (!state) return false;
      const override = state.overrides.get(key);
      if (state.overrides.has(key)) return state.durable.has(key) && state.durable.get(key) === override;
      try { return window[kind].getItem(key) !== null; }
      catch { return false; }
    },
    getItem(key: string): string | null {
      const state = stateFor(kind);
      if (!state) return null;
      if (state.overrides.has(key)) return state.overrides.get(key) ?? null;
      try {
        const value = window[kind].getItem(key);
        if (value === null) state.lastKnown.delete(key);
        else state.lastKnown.set(key, value);
        return value;
      } catch {
        return state.lastKnown.get(key) ?? null;
      }
    },
    // This boolean reports synchronous native storage only. Critical values
    // also queue a durable backup; await flushBrowserStorage for that result.
    setItem(key: string, value: string): boolean {
      const state = stateFor(kind);
      if (!state) return false;
      const text = String(value);
      state.lastKnown.set(key, text);
      if (kind === "localStorage") backUp(state, key, text);
      try {
        window[kind].setItem(key, text);
        state.overrides.delete(key);
        return true;
      } catch {
        state.overrides.set(key, text);
        return false;
      }
    },
    removeItem(key: string): boolean {
      const state = stateFor(kind);
      if (!state) return false;
      state.lastKnown.delete(key);
      if (kind === "localStorage") backUp(state, key, null);
      try {
        window[kind].removeItem(key);
        state.overrides.delete(key);
        return true;
      } catch {
        // A failed removal must not resurrect an old token in this window.
        state.overrides.set(key, null);
        return false;
      }
    },
  };
}

export const browserLocalStorage = createBrowserStore("localStorage");
export const browserSessionStorage = createBrowserStore("sessionStorage");
