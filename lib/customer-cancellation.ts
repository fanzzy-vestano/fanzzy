export const customerCancellationReasons = [
  "Ordered by mistake",
  "Need to change items or delivery details",
  "Delivery is taking too long",
  "Found a better price",
  "Other",
] as const;

export type CustomerCancellationReason =
  (typeof customerCancellationReasons)[number];

export type CustomerCancellationRecord = {
  id: string;
  itemIndexes: number[];
  refundAmount: number;
  refundStatus: "Not applicable" | "Pending" | "Completed";
  reason: CustomerCancellationReason;
  description?: string;
  createdAt: string;
  fullOrder: boolean;
  refundReference?: string;
};

export const isCustomerCancellationReason = (
  value: unknown,
): value is CustomerCancellationReason =>
  typeof value === "string" &&
  (customerCancellationReasons as readonly string[]).includes(value);
