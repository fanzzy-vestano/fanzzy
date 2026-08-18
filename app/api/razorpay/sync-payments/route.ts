import { finalizeRazorpayPayment, reconcilePendingOrderInventory, type RazorpayPayment } from "../../../../lib/razorpay-payment-sync";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function POST() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return json({ error: "Razorpay is not configured on the server" }, 503);
  try {
    const response = await fetch("https://api.razorpay.com/v1/payments?count=100", {
      headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` },
      cache: "no-store",
    });
    const payload = await response.json() as { items?: RazorpayPayment[]; error?: { description?: string } };
    if (!response.ok) return json({ error: payload.error?.description || "Could not read Razorpay payments" }, 502);
    let synced = 0;
    for (const payment of payload.items || []) {
      if (payment.id && (payment as RazorpayPayment & { status?: string }).status === "captured") {
        await finalizeRazorpayPayment(payment);
        synced += 1;
      }
    }
    const inventory = await reconcilePendingOrderInventory();
    return json({ synced, inventory });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not sync Razorpay payments" }, 502);
  }
}
