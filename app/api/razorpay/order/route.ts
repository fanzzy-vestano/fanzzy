type CreateOrderRequest = {
  amount?: unknown;
  receipt?: unknown;
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export async function POST(request: Request) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return json({ error: "Razorpay is not configured on the server" }, 503);
  }

  let body: CreateOrderRequest;
  try {
    body = await request.json() as CreateOrderRequest;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
  if (!Number.isInteger(amount) || amount < 100 || amount > 10_000_000_00) {
    return json({ error: "Amount must be an integer between ₹1 and ₹10,000,000" }, 400);
  }

  const receipt = typeof body.receipt === "string" && body.receipt.trim()
    ? body.receipt.trim().slice(0, 40)
    : `fz_${Date.now()}`;

  try {
    const razorpayResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount, currency: "INR", receipt }),
    });
    const result = await razorpayResponse.json() as { id?: string; amount?: number; currency?: string; error?: { description?: string } };
    if (!razorpayResponse.ok || !result.id) {
      return json({ error: result.error?.description || "Razorpay could not create an order" }, 502);
    }

    return json({ id: result.id, amount: result.amount, currency: result.currency, keyId });
  } catch {
    return json({ error: "Razorpay is temporarily unavailable" }, 502);
  }
}
