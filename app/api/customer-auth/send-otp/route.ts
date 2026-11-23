import { randomInt } from "node:crypto";
import { completeOtpSendCaptcha, consumeOtpSendRateLimit, createPendingOtpCookie, createPendingOtpToken, getCustomerAuthSecret, getOtpSendCaptchaRequirement, normalizeMobileNumber, OTP_EXPIRES_MS, OTP_RESEND_COOLDOWN_SECONDS, recordOtpSend, refreshOtpSendCaptcha, verifyOtpSendCaptcha } from "../../../../lib/customer-sms-auth";
import { isSangamamSmsConfigured, SangamamSmsError, sendSangamamOtp } from "../../../../lib/sangamam-sms";

const json = (body: Record<string, unknown>, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export async function POST(request: Request) {
  let phone = "";
  let captchaToken = "";
  let captchaAnswer = "";
  let refreshCaptcha = false;
  let verifyCaptcha = false;
  try {
    const body = await request.json() as { phone?: unknown; captchaToken?: unknown; captchaAnswer?: unknown; refreshCaptcha?: unknown; verifyCaptcha?: unknown };
    phone = normalizeMobileNumber(body.phone);
    captchaToken = typeof body.captchaToken === "string" ? body.captchaToken : "";
    captchaAnswer = typeof body.captchaAnswer === "string" ? body.captchaAnswer : "";
    refreshCaptcha = body.refreshCaptcha === true;
    verifyCaptcha = body.verifyCaptcha === true;
  } catch {
    return json({ error: "Enter a valid mobile number" }, 400);
  }
  if (!phone) return json({ error: "Enter a valid mobile number with its country code." }, 400);
  if (!phone.startsWith("91") && process.env.FANZZY_ENV !== "local-test") {
    return json({ error: "International SMS login is not configured yet." }, 503);
  }

  if (refreshCaptcha) {
    const refreshed = refreshOtpSendCaptcha(request, phone, captchaToken);
    if (refreshed.status === "invalid") return json({ error: "Security check expired. Please request a new OTP." }, 400);
    if (refreshed.status === "not-required") return json({ captchaRequired: false });
    return json({ captchaRequired: true, captcha: refreshed.captcha });
  }

  if (verifyCaptcha) {
    const verified = verifyOtpSendCaptcha(request, phone, captchaToken, captchaAnswer);
    if (verified.status === "not-required") return json({ captchaRequired: false });
    if (verified.status === "verified") return json({ captchaRequired: true, captchaVerified: true });
    return json({ error: "Incorrect CAPTCHA. Please try the new image.", captchaRequired: true, captcha: verified.captcha }, 400);
  }

  const captcha = getOtpSendCaptchaRequirement(request, phone, captchaToken);
  if (!captcha.allowed) {
    return json(
      {
        error: "Please enter and verify the CAPTCHA to resend the OTP.",
        captchaRequired: true,
        captcha: captcha.captcha,
      },
      429,
    );
  }

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
    recordOtpSend(request, phone, Boolean(captcha.captchaToken));
    completeOtpSendCaptcha(captcha.captchaToken);
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
