export type OrderHistoryDeletion = {
  order: Record<string, unknown> & { id: string };
  deletedAt: string;
};

const deletionCacheKey = "fanzzy-order-history-deletions";
const cachedDeletions = new Map<string, OrderHistoryDeletion>();
let lastCachedValue: string | null = null;

const orderRecord = (value: unknown): (Record<string, unknown> & { id: string }) | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && record.id.trim() ? record as Record<string, unknown> & { id: string } : null;
};

const orderIdentity = (value: unknown) => {
  const order = orderRecord(value);
  if (!order) return [];
  return ["id", "razorpayPaymentId", "razorpayOrderId"].flatMap((field) => {
    const value = order[field];
    return typeof value === "string" && value.trim() ? [`${field}:${value.trim()}`] : [];
  });
};

const rememberDeletion = (deletion: OrderHistoryDeletion) => {
  const previous = cachedDeletions.get(deletion.order.id);
  if (!previous) {
    cachedDeletions.set(deletion.order.id, deletion);
    return;
  }
  const previousTime = Date.parse(previous.deletedAt);
  const incomingTime = Date.parse(deletion.deletedAt);
  const incomingIsNewer = Number.isFinite(incomingTime)
    && (!Number.isFinite(previousTime) || incomingTime > previousTime);
  const newest = incomingIsNewer ? deletion : previous;
  const older = incomingIsNewer ? previous : deletion;
  const order = { ...newest.order };
  // Keep the newest canonical snapshot while retaining payment aliases that
  // another tab or an older read may have learned before that snapshot.
  for (const field of ["razorpayPaymentId", "razorpayOrderId"] as const) {
    const current = order[field];
    const fallback = older.order[field];
    if ((typeof current !== "string" || !current.trim()) && typeof fallback === "string" && fallback.trim()) {
      order[field] = fallback;
    }
  }
  cachedDeletions.set(order.id, { order, deletedAt: newest.deletedAt });
};

const readCachedDeletions = () => {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(deletionCacheKey) || "[]";
      if (stored === lastCachedValue) return Array.from(cachedDeletions.values());
      const parsed: unknown = JSON.parse(stored);
      lastCachedValue = stored;
      if (Array.isArray(parsed)) {
        for (const value of parsed) {
          if (!value || typeof value !== "object") continue;
          const deletion = value as Partial<OrderHistoryDeletion>;
          const order = orderRecord(deletion.order);
          if (order && typeof deletion.deletedAt === "string" && deletion.deletedAt) {
            rememberDeletion({ order, deletedAt: deletion.deletedAt });
          }
        }
      }
    } catch {
      // An unavailable browser cache must not discard markers already loaded.
    }
  }
  return Array.from(cachedDeletions.values());
};

export function filterOrderHistory<T>(orders: T[], deletions: OrderHistoryDeletion[]): T[] {
  const deletedIdentities = new Set(deletions.flatMap((deletion) => orderIdentity(deletion.order)));
  return orders.filter((order) => !orderIdentity(order).some((identity) => deletedIdentities.has(identity)));
}

export function filterVisibleOrders<T>(orders: T[]): T[] {
  return filterOrderHistory(orders, readCachedDeletions());
}

export function cacheOrderHistoryDeletions(deletions: OrderHistoryDeletion[]): OrderHistoryDeletion[] {
  readCachedDeletions();
  for (const deletion of deletions) rememberDeletion(deletion);
  // Deletions are permanent: an older in-flight read must never clear one.
  const merged = Array.from(cachedDeletions.values());
  if (typeof window !== "undefined") {
    try {
      const storage = window.localStorage;
      const orderCacheKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
        .filter((key): key is string => Boolean(key && (key === "fanzzy-orders" || key.startsWith("fanzzy-orders:"))));
      for (const key of orderCacheKeys) {
        try {
          const parsed: unknown = JSON.parse(storage.getItem(key) || "[]");
          if (!Array.isArray(parsed)) continue;
          const visible = filterOrderHistory(parsed, merged);
          if (visible.length !== parsed.length) storage.setItem(key, JSON.stringify(visible));
        } catch {
          // A corrupt or full cache must not block the shared deletion.
        }
      }
      const serialized = JSON.stringify(merged);
      if (storage.getItem(deletionCacheKey) !== serialized) storage.setItem(deletionCacheKey, serialized);
      lastCachedValue = serialized;
    } catch {
      // Keep using the in-memory markers if browser storage is unavailable.
    }
  }
  return merged;
}

export function mergeOrderHistoryForSave(incoming: unknown[], stored: unknown[], deletions: OrderHistoryDeletion[]): unknown[] {
  const merged = new Map<string, Record<string, unknown> & { id: string }>();
  for (const value of filterOrderHistory(incoming, deletions)) {
    const order = orderRecord(value);
    if (order) merged.set(order.id, order);
  }
  // Retain canonical deleted orders, including their payment and inventory
  // markers, and any orders another browser saved since this caller loaded.
  for (const value of stored) {
    const order = orderRecord(value);
    if (order && !merged.has(order.id)) merged.set(order.id, order);
  }
  // The tombstone also protects a local-only sale or a record lost by an older
  // client overwriting the shared array. Prefer a current canonical record.
  for (const deletion of deletions) {
    if (!merged.has(deletion.order.id)) merged.set(deletion.order.id, deletion.order);
  }
  return Array.from(merged.values());
}
