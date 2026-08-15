import { clearPendingOtpCookie, consumeOtpVerifyRateLimit, createCustomerSessionCookie, getPendingOtp, getTwoFactorApiKey } from "../../../../lib/customer-sms-auth";
import { TwoFactorSmsError, verifyTwoFactorOtp } from "../../../../lib/two-factor-sms";

const json = (body: Record<string, unknown>, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const sessionHeaders = (phone: string) => {
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", createCustomerSessionCookie(phone));
  headers.append("set-cookie", clearPendingOtpCookie());
  return headers;
};

export async function POST(request: Request) {
  const pending = getPendingOtp(request);
  const rateLimit = consumeOtpVerifyRateLimit(request, pending?.phone || "unknown");
  if (!rateLimit.allowed) {
    return json({ error: "Too many verification attempts. Please request a new OTP." }, 429, { "retry-after": String(rateLimit.retryAfter) });
  }
  if (!pending) return json({ error: "OTP expired" }, 410);
  let code = "";
  try {
    code = String((await request.json() as { code?: unknown }).code || "").replace(/\D/g, "");
  } catch {
    return json({ error: "Enter the SMS code" }, 400);
  }
  if (code.length !== 6) return json({ error: "Enter the SMS code" }, 400);

  const apiKey = getTwoFactorApiKey();
  if (!apiKey) return json({ error: "2Factor SMS login is not configured." }, 503);

  try {
    const result = await verifyTwoFactorOtp(pending.sessionId, code);
    console.info("otp.provider.verify", {
      provider: "2Factor.in",
      channel: "SMS",
      status: `${result.httpStatus}:${result.status || "unknown"}`,
    });
    if (!result.ok || result.status !== "success") {
      const details = result.details.toLowerCase();
      if (details.includes("expired") || details.includes("invalid session") || details.includes("session not found")) {
        return json({ error: "OTP expired. Please request a new OTP." }, 410, { "set-cookie": clearPendingOtpCookie() });
      }
      if (details.includes("mismatch") || details.includes("invalid otp") || details.includes("incorrect")) {
        return json({ error: "Invalid OTP. Please try again." }, 401);
      }
      return json({ error: result.details || "2Factor could not verify the SMS code." }, 502);
    }
    return new Response(JSON.stringify({ user: { id: `phone:${pending.phone}`, phone: `+${pending.phone}` } }), {
      status: 200,
      headers: sessionHeaders(pending.phone),
    });
  } catch (error) {
    if (error instanceof TwoFactorSmsError && error.kind === "verify") {
      return json({ error: error.message }, 502);
    }
    return json({ error: "2Factor SMS service could not be reached." }, 502);
  }
}
