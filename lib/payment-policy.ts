type Environment = Record<string, string | undefined>;

// This switch is deliberately absent from deployed configuration. Set it only
// after account activation, transactional order storage and deployment review.
export function paymentConfigurationError(env: Environment): string | null {
  const test = env.FANZZY_ENV === "local-test" || env.NEXT_PUBLIC_FANZZY_ENV === "local-test";
  const key = env.RAZORPAY_KEY_ID || "";
  if (!env.RAZORPAY_KEY_SECRET) return "Razorpay is not configured on the server.";
  if (test) return key.startsWith("rzp_test_") ? null : "Test checkout requires Test Mode credentials.";
  if (env.FANZZY_LIVE_PAYMENTS_ENABLED !== "true") return "Live payments are awaiting production verification and approval.";
  if (!key.startsWith("rzp_live_")) return "Production checkout requires Live Mode credentials.";
  if (!env.RAZORPAY_WEBHOOK_SECRET || !env.SUPABASE_SERVICE_ROLE_KEY) return "Production payment server configuration is incomplete.";
  if ((env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL) !== "https://pdrcrkxeyqxqgpwfxqpu.supabase.co") return "Production payment database configuration is invalid.";
  return null;
}

export function assertCapturedPayment(payment: {
  id?: string; order_id?: string; status?: string; captured?: boolean; amount?: number; currency?: string;
}, order: { total?: string; razorpayOrderId?: string; razorpayPaymentId?: string; paymentMethod?: string }) {
  if (!payment.id || !payment.order_id || payment.status !== "captured" || payment.captured !== true || payment.currency !== "INR") {
    throw new Error("Payment has not been captured in INR.");
  }
  const expected = Math.round(Number(String(order.total || "").replace(/[^0-9.]/g, "")) * 100);
  if (!Number.isSafeInteger(expected) || expected < 100 || payment.amount !== expected) throw new Error("Payment amount does not match the saved order.");
  if (!order.razorpayOrderId || order.razorpayOrderId !== payment.order_id) throw new Error("Payment does not match the saved Razorpay order.");
  if (order.paymentMethod === "cod") throw new Error("An online payment cannot confirm a COD order.");
  if (order.razorpayPaymentId && order.razorpayPaymentId !== payment.id) throw new Error("Order already has a different payment.");
}
