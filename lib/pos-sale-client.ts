import { browserLocalStorage, prepareBrowserStorage, flushBrowserStorage } from "./browser-storage";
import { adminApiFetch } from "./site-api-client";

type Sale = { id: string; total?: string; items?: unknown[]; customerName?: string; phone?: string; couponDiscount?: number; posPaymentMethod?: string };
export type PosInventorySnapshot = {
  sku: string; stock: number; status: "Published" | "Low stock" | "Draft";
  variants: Array<{ name: string; size?: string; image: string; stock?: number; price?: number }>;
  sizeStock: Record<string, number>;
};
export type PosSaleResult<T> = { order: T; orders: T[]; products: PosInventorySnapshot[]; replayed: boolean };
const pendingKey = "fanzzy-pos-sale-attempt";

export const posBillFingerprint = (order: Sale) => JSON.stringify([
  order.total, order.items, order.customerName, order.phone, order.couponDiscount, order.posPaymentMethod,
]);

export function readPendingPosSale<T extends Sale>(): T | null {
  try {
    const order = JSON.parse(browserLocalStorage.getItem(pendingKey) || "null") as T | null;
    return order?.id && Array.isArray(order.items) && order.items.length ? order : null;
  } catch { return null; }
}

export async function commitAtomicPosSale<T extends Sale>(candidate: T): Promise<PosSaleResult<T>> {
  await prepareBrowserStorage();
  const pending = readPendingPosSale<T>();
  if (pending && posBillFingerprint(pending) !== posBillFingerprint(candidate)) {
    throw new Error(`Sale ${pending.id} needs confirmation first. Use Retry saved sale before starting another bill.`);
  }
  const order = pending || candidate;
  browserLocalStorage.setItem(pendingKey, JSON.stringify(order));
  if (!await flushBrowserStorage()) {
    throw new Error("This browser cannot preserve a sale reference across refresh. No sale was submitted. Keep this tab open and retry when storage is available.");
  }
  const response = await adminApiFetch("/admin/pos-sales", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order }),
  });
  const result = await response.json() as PosSaleResult<T> & { error?: string };
  if (!response.ok) {
    // Only known validation/conflict responses prove that this transaction did
    // not commit. Network/5xx failures retain the exact request for safe retry.
    if (response.status === 400 || response.status === 409) {
      browserLocalStorage.removeItem(pendingKey);
      await flushBrowserStorage();
    }
    throw new Error(result.error || "Sale confirmation is uncertain. Retry the saved sale reference.");
  }
  if (result.order?.id !== order.id || !Array.isArray(result.orders) || !Array.isArray(result.products)) {
    throw new Error("Sale confirmation is incomplete. Retry the saved sale reference.");
  }
  browserLocalStorage.removeItem(pendingKey);
  await flushBrowserStorage();
  return result;
}
