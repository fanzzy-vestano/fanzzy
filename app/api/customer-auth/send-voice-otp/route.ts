import { randomInt } from "node:crypto";
import { consumeOtpSendRateLimit, createPendingOtpCookie, getTwoFactorApiKey, normalizeMobileNumber, OTP_EXPIRES_MS, OTP_RESEND_COOLDOWN_SECONDS } from "../../../../lib/customer-sms-auth";
import { sendTwoFactorVoiceOtp, TwoFactorVoiceError } from "../../../../lib/two-factor-voice";

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
  if (!apiKey) return json({ error: "2Factor voice login is not configured." }, 503);

  try {
    const code = String(randomInt(100000, 1_000_000));
    await sendTwoFactorVoiceOtp(phone, code);
    console.info("otp.provider.send", { provider: "2Factor.in", channel: "VOICE", status: "success" });
    return json({ sent: true }, 200, { "set-cookie": createPendingOtpCookie({ phone, code, expiresAt: Date.now() + OTP_EXPIRES_MS }) });
  } catch (error) {
    if (error instanceof TwoFactorVoiceError && error.kind === "send") return json({ error: error.message }, 502);
    return json({ error: "2Factor voice service could not be reached." }, 502);
  }
}
