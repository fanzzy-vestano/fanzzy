import { consumeOtpRateLimit, createPendingOtpCookie, getTwoFactorApiKey, normalizeMobileNumber } from "../../../../lib/customer-sms-auth";
import { randomInt, randomUUID } from "node:crypto";

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

  const rateLimit = consumeOtpRateLimit(request, phone);
  if (!rateLimit.allowed) {
    return json(
      { error: rateLimit.retryAfter <= 45 ? `Please wait ${rateLimit.retryAfter} seconds before requesting another OTP.` : "Too many OTP requests. Please try again later." },
      429,
      { "retry-after": String(rateLimit.retryAfter) },
    );
  }

  try {
    const code = String(randomInt(100000, 1_000_000));
    // Use the official SMS OTP route. 2Factor selects the approved FANZZY
    // sender and "Fanzzy Login OTP" template from the account for this route;
    // do not send From/TemplateName fields from the generic TSMS API.
    const response = await fetch(`https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/${encodeURIComponent(phone)}/${encodeURIComponent(code)}`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
    });
    const raw = await response.text();
    let result: Record<string, unknown> = {};
    try {
      result = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return json({ error: `2Factor returned an unexpected response (${response.status})` }, 502);
    }
    const status = String(result.Status ?? result.status ?? "").toLowerCase();
    const sessionId = `local:${randomUUID()}`;
    const providerError = String(result.Errors ?? result.errors ?? result.error ?? result.message ?? result.Details ?? result.details ?? "");
    if (!response.ok || !["success", "sent"].includes(status)) {
      return json({ error: providerError || `2Factor could not send the SMS (${response.status})` }, 502);
    }
    return json({ sent: true }, 200, { "set-cookie": createPendingOtpCookie({ phone, sessionId, code, expiresAt: Date.now() + 10 * 60 * 1000 }) });
  } catch {
    return json({ error: "The SMS code could not be sent. Please try again." }, 502);
  }
}
