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

type RazorpayPaymentLinkPayment = {
  payment_id?: string;
  amount?: number;
  status?: string;
  method?: string;
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
  return /^(?:qr|plink)_[A-Za-z0-9]+$/.test(id) ? id : "";
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

    // Some Razorpay accounts can use Checkout and Payment Links but do not
    // have the dedicated QR Codes API enabled. A short-lived Payment Link can
    // still be represented as a QR and verified through Razorpay before sale.
    const fallbackResponse = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      cache: "no-store",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount,
        currency: "INR",
        accept_partial: false,
        reference_id: reference,
        description: `Fanzzy counter sale ${reference}`,
        expire_by: closeBy,
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes: { fanzzy_pos_reference: reference, fanzzy_payment_source: "pos_qr_fallback" },
      }),
    });
    const fallback = await fallbackResponse.json() as {
      id?: string;
      short_url?: string;
      amount?: number;
      status?: string;
      expire_by?: number;
      error?: { description?: string };
    };
    if (!fallbackResponse.ok || !fallback.id || !fallback.short_url) {
      return json({
        error: fallback.error?.description || result.error?.description || "Razorpay could not create a payment QR",
      }, 502);
    }
    return json({
      id: fallback.id,
      paymentUrl: fallback.short_url,
      amount: fallback.amount || amount,
      status: fallback.status || "created",
      closeBy: fallback.expire_by || closeBy,
      mode: "payment_link",
    });
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
    if (id.startsWith("plink_")) {
      const response = await fetch(`https://api.razorpay.com/v1/payment_links/${encodeURIComponent(id)}`, {
        cache: "no-store",
        headers: auth,
      });
      const result = await response.json() as {
        status?: string;
        amount?: number;
        amount_paid?: number;
        payments?: RazorpayPaymentLinkPayment[] | null;
        error?: { description?: string };
      };
      if (!response.ok) return json({ error: result.error?.description || "Could not check the Razorpay payment" }, 502);
      const payments = Array.isArray(result.payments) ? result.payments : [];
      const paid = payments.find((payment) => payment.status === "captured");
      const fullyPaid = result.status === "paid" && Boolean(paid) && Number(result.amount_paid) >= Number(result.amount);
      return json({
        paid: fullyPaid,
        paymentId: fullyPaid ? paid?.payment_id : undefined,
        amount: fullyPaid ? paid?.amount || result.amount_paid : undefined,
        status: fullyPaid ? "captured" : result.status || "waiting",
      });
    }

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
    const closeUrl = id.startsWith("plink_")
      ? `https://api.razorpay.com/v1/payment_links/${encodeURIComponent(id)}/cancel`
      : `https://api.razorpay.com/v1/payments/qr_codes/${encodeURIComponent(id)}/close`;
    const response = await fetch(closeUrl, {
      method: "POST",
      cache: "no-store",
      headers: auth,
    });
    const result = await response.json() as { status?: string; error?: { description?: string } };
    if (!response.ok) return json({ error: result.error?.description || "Could not close the payment QR" }, 502);
    return json({ closed: true, status: result.status || (id.startsWith("plink_") ? "cancelled" : "closed") });
  } catch {
    return json({ error: "Could not close the Razorpay payment QR" }, 502);
  }
}
