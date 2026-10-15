type CreatePosQrRequest = {
  amount?: unknown;
  reference?: unknown;
};

type RazorpayQrPayment = {
  id?: string;
  amount?: number;
  status?: string;
  method?: string;
  captured?: boolean;
  created_at?: number;
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const credentials = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  return keyId && keySecret
    ? { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` }
    : null;
};

const paymentRequestId = (request: Request) => {
  const id = new URL(request.url).searchParams.get("id")?.trim() || "";
  return /^qr_[A-Za-z0-9]+$/.test(id) ? id : "";
};

export async function POST(request: Request) {
  const auth = credentials();
  if (!auth) return json({ error: "Razorpay is not configured on the server" }, 503);

  let body: CreatePosQrRequest;
  try {
    body = await request.json() as CreatePosQrRequest;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
  if (!Number.isInteger(amount) || amount < 100 || amount > 1_000_000_000) {
    return json({ error: "UPI QR amount must be between ₹1 and ₹10,000,000" }, 400);
  }
  const reference = typeof body.reference === "string" && body.reference.trim()
    ? body.reference.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)
    : `POS-${Date.now()}`;
  const closeBy = Math.floor(Date.now() / 1000) + 20 * 60;

  try {
    const response = await fetch("https://api.razorpay.com/v1/payments/qr_codes", {
      method: "POST",
      cache: "no-store",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "upi_qr",
        name: `Fanzzy ${reference}`,
        usage: "single_use",
        fixed_amount: true,
        payment_amount: amount,
        description: `Fanzzy counter sale ${reference}`,
        close_by: closeBy,
        notes: { fanzzy_pos_reference: reference },
      }),
    });
    const result = await response.json() as {
      id?: string;
      image_url?: string;
      payment_amount?: number;
      status?: string;
      close_by?: number;
      error?: { description?: string };
    };
    if (response.ok && result.id && result.image_url) {
      return json({
        id: result.id,
        imageUrl: result.image_url,
        amount: result.payment_amount || amount,
        status: result.status || "active",
        closeBy: result.close_by || closeBy,
        mode: "native_qr",
      });
    }

    return json({
      error: result.error?.description || "Razorpay native UPI QR is unavailable for this account. Enable Razorpay QR Codes before accepting POS UPI payments.",
    }, 502);
  } catch (error) {
    console.error("Razorpay POS QR creation failed", error);
    return json({ error: "Razorpay UPI QR is temporarily unavailable" }, 502);
  }
}

export async function GET(request: Request) {
  const auth = credentials();
  if (!auth) return json({ error: "Razorpay is not configured on the server" }, 503);
  const id = paymentRequestId(request);
  if (!id) return json({ error: "A valid Razorpay payment QR id is required" }, 400);

  try {
    const response = await fetch(`https://api.razorpay.com/v1/payments/qr_codes/${encodeURIComponent(id)}/payments?count=10`, {
      cache: "no-store",
      headers: auth,
    });
    const result = await response.json() as { items?: RazorpayQrPayment[]; error?: { description?: string } };
    if (!response.ok) return json({ error: result.error?.description || "Could not check the UPI payment" }, 502);
    const payments = Array.isArray(result.items) ? result.items : [];
    const paid = payments.find((payment) => payment.status === "captured" && payment.captured !== false && payment.method === "upi");
    const processing = payments.find((payment) => payment.status === "authorized" || payment.status === "created");
    return json({
      paid: Boolean(paid),
      paymentId: paid?.id,
      amount: paid?.amount,
      status: paid ? "captured" : processing?.status || "waiting",
    });
  } catch {
    return json({ error: "Could not check the Razorpay UPI payment" }, 502);
  }
}

export async function DELETE(request: Request) {
  const auth = credentials();
  if (!auth) return json({ error: "Razorpay is not configured on the server" }, 503);
  const id = paymentRequestId(request);
  if (!id) return json({ error: "A valid Razorpay payment QR id is required" }, 400);

  try {
    const closeUrl = `https://api.razorpay.com/v1/payments/qr_codes/${encodeURIComponent(id)}/close`;
    const response = await fetch(closeUrl, {
      method: "POST",
      cache: "no-store",
      headers: auth,
    });
    const result = await response.json() as { status?: string; error?: { description?: string } };
    if (!response.ok) return json({ error: result.error?.description || "Could not close the payment QR" }, 502);
    return json({ closed: true, status: result.status || "closed" });
  } catch {
    return json({ error: "Could not close the Razorpay payment QR" }, 502);
  }
}
