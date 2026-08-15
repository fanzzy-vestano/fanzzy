import { consumeOtpSendRateLimit, createPendingOtpCookie, getTwoFactorApiKey, normalizeMobileNumber, OTP_EXPIRES_MS, OTP_RESEND_COOLDOWN_SECONDS } from "../../../../lib/customer-sms-auth";

const json = (body: Record<string, unknown>, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export async function POST(request: Request) {
  const apiKey = getTwoFactorApiKey();
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
  if (!apiKey) return json({ error: "2Factor SMS login is not configured." }, 503);

  try {
    const templateName = "Fanzzy Login OTP";
    const approvedSenderId = "FANZZY";
    // 2Factor selects the sender configured on this approved template; it must be mapped to FANZZY.
    const endpointPath = "/API/V1/[redacted]/SMS/{phone}/AUTOGEN/Fanzzy%20Login%20OTP";
    const endpoint = `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/${phone}/AUTOGEN/${encodeURIComponent(templateName)}`;
    console.info("otp.provider.request", {
      function: "app/api/customer-auth/send-otp",
      provider: "2Factor.in",
      endpoint: endpointPath,
      channel: "SMS",
      template: templateName,
      senderId: approvedSenderId,
    });
    const response = await fetch(endpoint, {
      method: "GET",
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
    console.info("otp.provider.response", {
      function: "app/api/customer-auth/send-otp",
      provider: "2Factor.in",
      endpoint: endpointPath,
      channel: "SMS",
      status: `${response.status}:${status || "unknown"}`,
      sessionId: sessionId || null,
    });
    if (!response.ok || status !== "success" || !sessionId) {
      const providerError = String(result.Details ?? result.details ?? result.Message ?? result.message ?? "").trim();
      return json({ error: providerError || "2Factor could not send the SMS code." }, 502);
    }
    return json({ sent: true }, 200, { "set-cookie": createPendingOtpCookie({ phone, sessionId, expiresAt: Date.now() + OTP_EXPIRES_MS }) });
  } catch {
    return json({ error: "2Factor SMS service could not be reached." }, 502);
  }
}
