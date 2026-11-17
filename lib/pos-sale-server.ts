type VerifiedPayment = { id?: string; order_id?: string; status?: string; method?: string; amount?: number };
type PosServerConfig = { supabaseUrl: string; serviceRoleKey: string };

export async function finalizeAtomicPosPayment<T>(payment: VerifiedPayment, config: PosServerConfig): Promise<{ order: T }> {
  if (payment.status !== "captured" || payment.method !== "upi" || !payment.id || !payment.order_id || !Number.isSafeInteger(payment.amount) || Number(payment.amount) <= 0) {
    throw new Error("A captured UPI payment with its exact amount is required for this POS sale.");
  }
  if (!config.serviceRoleKey || !config.supabaseUrl) throw new Error("Atomic POS saving is not configured. Do not pay again.");
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/finalize_pos_payment`, {
    method: "POST", headers: { apikey: config.serviceRoleKey, authorization: `Bearer ${config.serviceRoleKey}`, "content-type": "application/json" },
    body: JSON.stringify({ p_razorpay_order_id: payment.order_id, p_payment_id: payment.id, p_amount: payment.amount }),
  });
  const result = await response.json() as { order?: T; message?: string };
  if (!response.ok || !result.order) throw new Error("POS order confirmation needs a retry. Do not pay again.");
  return { order: result.order };
}
