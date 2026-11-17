import { randomInt } from "node:crypto";
import { consumeOtpSendRateLimit, createPendingOtpCookie, createPendingOtpToken, getCustomerAuthSecret, normalizeMobileNumber, OTP_EXPIRES_MS, OTP_RESEND_COOLDOWN_SECONDS } from "../../../../lib/customer-sms-auth";
import { isSangamamSmsConfigured, SangamamSmsError, sendSangamamOtp } from "../../../../lib/sangamam-sms";

const json = (body: Record<string, unknown>, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export async function POST(request: Request) {
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
  const localTestCode = process.env.FANZZY_ENV === "local-test" ? process.env.LOCAL_TEST_OTP_CODE?.trim() : "";
  if (process.env.FANZZY_ENV === "local-test" && !/^\d{6}$/.test(localTestCode || "")) {
    return json({ error: "Local test OTP is not configured." }, 503);
  }
  if (!getCustomerAuthSecret() || (!localTestCode && !isSangamamSmsConfigured())) {
    return json({ error: "Sangamam FastSMS login is not configured." }, 503);
  }

  try {
    const code = /^\d{6}$/.test(localTestCode || "") ? localTestCode! : String(randomInt(100000, 1_000_000));
    if (!localTestCode) await sendSangamamOtp(phone, code);
    console.info("otp.provider.send", {
      provider: localTestCode ? "Local test OTP" : "Sangamam FastSMS",
      channel: "SMS",
      status: "success",
    });
    const pending = { phone, code, expiresAt: Date.now() + OTP_EXPIRES_MS };
    return json(
      {
        sent: true,
        channel: localTestCode ? "local-test" : "sms",
        pendingToken: createPendingOtpToken(pending),
        ...(localTestCode ? { testCode: localTestCode } : {}),
      },
      200,
      { "set-cookie": createPendingOtpCookie(pending) },
    );
  } catch (error) {
    if (error instanceof SangamamSmsError && error.kind === "send") {
      return json({ error: error.message }, 502);
    }
    return json({ error: "Sangamam FastSMS service could not be reached." }, 502);
  }
}
