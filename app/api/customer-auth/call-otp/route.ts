import { createPendingOtpCookie, getPendingOtp } from "../../../../lib/customer-sms-auth";

const json = (body: Record<string, unknown>, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export async function POST(request: Request) {
  const apiKey = process.env.TWOFACTOR_API_KEY;
  const pending = getPendingOtp(request);
  if (!apiKey || !pending) return json({ error: "Your code has expired. Request a new SMS code." }, 401);
  if (pending.voiceCallSentAt && Date.now() - pending.voiceCallSentAt < 60_000) {
    return json({ error: "Please wait one minute before requesting another call." }, 429);
  }
  try {
    const response = await fetch(`https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/VOICE/${pending.phone}/${pending.code}`);
    const result = await response.json() as { Status?: string; Details?: string; Errors?: string };
    if (!response.ok || result.Status?.toLowerCase() !== "success") {
      return json({ error: result.Details || result.Errors || "The verification call could not be started" }, 502);
    }
    return json({ called: true }, 200, {
      "set-cookie": createPendingOtpCookie({ ...pending, voiceCallSentAt: Date.now() }),
    });
  } catch {
    return json({ error: "The verification call could not be started. Please try again." }, 502);
  }
}
