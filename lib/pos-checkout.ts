type PosOrder = {
  id: string;
  paymentStatus?: string;
  razorpayPaymentId?: string;
  items?: unknown[];
};

type OrderReader<T> = () => Promise<{ data: T[] | null; error: unknown }>;

// A failed shared save must stop Checkout from accepting money.
export async function savePendingPosOrder<T extends PosOrder>(
  order: T,
  read: OrderReader<T>,
  save: (orders: T[]) => Promise<unknown>,
) {
  if (!order.items?.length) throw new Error("Select a product before accepting payment.");
  const remote = await read();
  if (remote.error || !remote.data) throw new Error("Could not load orders. Payment has not opened; please retry.");
  const existing = remote.data.find((candidate) => candidate.id === order.id);
  if (existing?.paymentStatus === "paid") throw new Error("This POS order is already paid. Check Orders before retrying.");
  const next = [order, ...remote.data.filter((candidate) => candidate.id !== order.id)];
  const error = await save(next);
  if (error) throw new Error("Could not save the selected products. Payment has not opened; please retry.");
  return next;
}

export type PosPaymentResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

// Verify the exact UPI amount, then use the existing server finalizer to
// mark the saved order paid and deduct inventory. Never deduct it in the UI.
export async function confirmPosOrder<T extends PosOrder>(
  orderId: string,
  amount: number,
  payment: PosPaymentResponse,
  verify: (body: Record<string, unknown>) => Promise<{ verified?: boolean }>,
  read: OrderReader<T>,
) {
  const body = {
    razorpayOrderId: payment.razorpay_order_id,
    razorpayPaymentId: payment.razorpay_payment_id,
    razorpaySignature: payment.razorpay_signature,
  };
  const checked = await verify({ ...body, posAmount: amount, posSale: true });
  if (!checked.verified) throw new Error("Payment could not be verified. Do not pay again.");
  const finalized = await verify(body);
  if (!finalized.verified) throw new Error("Payment received; order confirmation needs a retry. Do not pay again.");
  const remote = await read();
  const order = remote.data?.find((candidate) => candidate.id === orderId);
  if (remote.error || !order?.items?.length || order.paymentStatus !== "paid" || order.razorpayPaymentId !== payment.razorpay_payment_id) {
    throw new Error("Payment received; waiting for the saved order. Check Orders and do not pay again.");
  }
  return { order, orders: remote.data! };
}
