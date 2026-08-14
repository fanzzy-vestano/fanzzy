import { consumeOtpSendRateLimit, createPendingOtpCookie, getTwoFactorApiKey, normalizeMobileNumber, OTP_RESEND_COOLDOWN_SECONDS } from "../../../../lib/customer-sms-auth";

const json = (body: Record<string, unknown>, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export async function POST(request: Request) {
  const apiKey = getTwoFactorApiKey();
  if (!apiKey) return json({ error: "SMS login is not configured yet" }, 503);
  let phone = "";
  try {
    phone = normalizeMobileNumber((await request.json() as { phone?: unknown }).phone);
  } catch {
    return json({ error: "Enter a valid mobile number" }, 400);
  }
  if (!phone) return json({ error: "Enter a valid 10-digit Indian mobile number" }, 400);

  const rateLimit = consumeOtpSendRateLimit(request, phone);
  if (!rateLimit.allowed) {
    return json(
      { error: rateLimit.retryAfter <= OTP_RESEND_COOLDOWN_SECONDS ? `Please wait ${rateLimit.retryAfter} seconds before requesting another OTP.` : "Too many OTP requests. Please try again later." },
      429,
      { "retry-after": String(rateLimit.retryAfter) },
    );
  }

  try {
    const templateName = process.env.TWO_FACTOR_OTP_TEMPLATE_NAME?.trim() || "Fanzzy Login OTP";
    const response = await fetch(`https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/${phone}/AUTOGEN/${encodeURIComponent(templateName)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const raw = await response.text();
    let result: Record<string, unknown> = {};
    try {
      result = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return json({ error: "We could not send the SMS code. Please try again." }, 502);
    }
    const status = String(result.Status ?? result.status ?? "").toLowerCase();
    const sessionId = String(result.Details ?? result.details ?? "").trim();
    if (!response.ok || status !== "success" || !sessionId) {
      return json({ error: "We could not send the SMS code. Please try again." }, 502);
    }
    return json({ sent: true }, 200, { "set-cookie": createPendingOtpCookie({ phone, sessionId, expiresAt: Date.now() + 10 * 60 * 1000 }) });
  } catch {
    return json({ error: "The SMS code could not be sent. Please try again." }, 502);
  }
}
