import { clearPendingOtpCookie, consumeOtpVerifyRateLimit, createCustomerSessionCookie, getPendingOtp, getTwoFactorApiKey } from "../../../../lib/customer-sms-auth";

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
  if (!apiKey) return json({ error: "SMS login is not configured yet" }, 503);

  try {
    const response = await fetch(`https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/VERIFY/${encodeURIComponent(pending.sessionId)}/${code}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const raw = await response.text();
    let result: Record<string, unknown> = {};
    try {
      result = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return json({ error: "We could not verify the code. Please try again." }, 502);
    }
    const status = String(result.Status ?? result.status ?? "").toLowerCase();
    if (!response.ok || status !== "success") {
      const details = String(result.Details ?? result.details ?? result.Errors ?? result.errors ?? "").toLowerCase();
      if (details.includes("expired") || details.includes("invalid session") || details.includes("session not found")) {
        return json({ error: "OTP expired. Please request a new OTP." }, 410, { "set-cookie": clearPendingOtpCookie() });
      }
      if (details.includes("mismatch") || details.includes("invalid otp") || details.includes("incorrect")) {
        return json({ error: "Invalid OTP. Please try again." }, 401);
      }
      return json({ error: "We could not verify the code. Please try again." }, 502);
    }
    return new Response(JSON.stringify({ user: { id: `phone:${pending.phone}`, phone: `+${pending.phone}` } }), {
      status: 200,
      headers: sessionHeaders(pending.phone),
    });
  } catch {
    return json({ error: "The code could not be verified. Please try again." }, 502);
  }
}
