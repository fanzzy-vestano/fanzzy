// Node's test runner imports this TypeScript file directly.
// @ts-expect-error TypeScript disallows .ts import paths without allowImportingTsExtensions.
import { parseMoneyValue, summarizeReturnableOrder, type WalkInOrder } from "./walk-in-returns.ts";

export type OnlineRefundSelection = {
  orderItemId: string;
  productName: string;
  variantName: string;
  size: string;
  quantity: number;
  refundAmount: number;
};
export type OnlineRefundItemRequest = Pick<OnlineRefundSelection, "orderItemId" | "quantity">;

type OnlineOrder = WalkInOrder & { shippingTotal?: number; codCharge?: number };

export const onlineRefundChoices = (order: OnlineOrder) => {
  const lines = summarizeReturnableOrder(order).lines.filter((line) => line.quantity > 0);
  const lineSubtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const paidItemsSubtotal = Math.max(0, parseMoneyValue(order.total) - Math.max(0, Number(order.shippingTotal) || 0) - Math.max(0, Number(order.codCharge) || 0));
  const paidRatio = lineSubtotal > 0 ? Math.min(1, paidItemsSubtotal / lineSubtotal) : 0;
  return lines.map((line) => ({ ...line, refundableUnitPrice: line.unitPrice * paidRatio }));
};

export const selectOnlineRefundItem = (order: OnlineOrder, orderItemId: string, quantity: number): OnlineRefundSelection => {
  const line = onlineRefundChoices(order).find((candidate) => candidate.id === orderItemId);
  if (!line) throw new Error("Select one product from the original order.");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > line.quantity) throw new Error(`Select a quantity from 1 to ${line.quantity}.`);
  return {
    orderItemId: line.id,
    productName: line.productName,
    variantName: line.variantName,
    size: line.size,
    quantity,
    refundAmount: Math.round(line.refundableUnitPrice * quantity * 100) / 100,
  };
};

export const selectOnlineRefundItems = (order: OnlineOrder, items: OnlineRefundItemRequest[]): OnlineRefundSelection[] => {
  if (!items.length) throw new Error("Select at least one product from the original order.");
  const selectedIds = new Set<string>();
  return items.map((item) => {
    if (selectedIds.has(item.orderItemId)) throw new Error("Each product can be selected only once.");
    selectedIds.add(item.orderItemId);
    return selectOnlineRefundItem(order, item.orderItemId, item.quantity);
  });
};
