// Standard Checkout owns VPA entry/validation. Never send a typed VPA to an
// unsupported Collect API or treat a syntactically valid VPA as payment proof.
export function supportsUpiIdEntry(device: { userAgent: string; platform?: string; maxTouchPoints?: number }): boolean {
  return /iPad|iPhone|iPod/i.test(device.userAgent)
    || (device.platform === "MacIntel" && Number(device.maxTouchPoints) > 1);
}

export function customerUpiOptions(upiId: boolean, supported: boolean) {
  if (!upiId || !supported) return {
    config: { display: { hide: [{ method: "upi", flows: ["collect"] }] } },
  };
  // Razorpay filters these instruments by account/device eligibility. Keeping
  // default blocks and an explicit fallback avoids a Collect-only checkout.
  return {
    config: { display: {
      blocks: {
        upi_id: { name: "Pay using UPI ID", instruments: [{ method: "upi", flows: ["collect"] }] },
        upi_fallback: { name: "UPI QR or app", instruments: [{ method: "upi", flows: ["qr", "intent"] }] },
      },
      sequence: ["block.upi_id", "block.upi_fallback"],
      preferences: { show_default_blocks: true },
    } },
  };
}

export type CheckoutPaymentProof = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };

export function paymentConfirmationGate(initialProof: CheckoutPaymentProof | null = null) {
  let proof: CheckoutPaymentProof | null = initialProof;
  let inFlight: Promise<void> | null = null;
  let confirmed = false;
  return {
    get proof() { return proof; },
    get confirmed() { return confirmed; },
    confirm(candidate: CheckoutPaymentProof, verify: () => Promise<void>): Promise<void> {
      if (proof && (proof.razorpay_order_id !== candidate.razorpay_order_id || proof.razorpay_payment_id !== candidate.razorpay_payment_id || proof.razorpay_signature !== candidate.razorpay_signature)) return Promise.reject(new Error("Another payment is awaiting confirmation. Do not pay again."));
      proof = { ...candidate };
      if (confirmed) return Promise.resolve();
      if (inFlight) return inFlight;
      inFlight = Promise.resolve().then(verify).then(() => { confirmed = true; }).finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
