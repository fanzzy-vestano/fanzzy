import { consumeOtpSendRateLimit, createPendingOtpCookie, getTwoFactorApiKey, normalizeMobileNumber, OTP_RESEND_COOLDOWN_SECONDS } from "../../../../lib/customer-sms-auth";

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

  const developmentOtp = () => {
    const code = process.env.CUSTOMER_SMS_DEV_CODE?.trim() || "123456";
    return json(
      { sent: true, developmentCode: code, developmentOnly: true },
      200,
      { "set-cookie": createPendingOtpCookie({ phone, sessionId: "local-development", developmentCode: code, expiresAt: Date.now() + 10 * 60 * 1000 }) },
    );
  };

  if (!apiKey) {
    if (process.env.NODE_ENV === "development") return developmentOtp();
    return json({ error: "SMS login is not configured yet" }, 503);
  }

  try {
    // AUTOGEN works with the provider's default OTP template. Only add the
    // optional custom template when it has explicitly been configured in the
    // environment; an invented template name makes the provider reject the
    // request before it can send anything.
    const templateName = process.env.TWO_FACTOR_OTP_TEMPLATE_NAME?.trim();
    const endpoint = `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/${phone}/AUTOGEN${templateName ? `/${encodeURIComponent(templateName)}` : ""}`;
    const response = await fetch(endpoint, {
      method: "POST",
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
  } catch (error) {
    console.error("Customer SMS OTP send failed", error);
    if (process.env.NODE_ENV === "development") return developmentOtp();
    return json({ error: "The SMS code could not be sent. Please try again." }, 502);
  }
}
