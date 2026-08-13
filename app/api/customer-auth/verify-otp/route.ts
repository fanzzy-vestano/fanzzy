import { clearPendingOtpCookie, createCustomerSessionCookie, getPendingOtp } from "../../../../lib/customer-sms-auth";

const json = (body: Record<string, unknown>, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const sessionHeaders = (phone: string) => {
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", createCustomerSessionCookie(phone));
  headers.append("set-cookie", clearPendingOtpCookie());
  return headers;
};

export async function POST(request: Request) {
  const apiKey = process.env.TWOFACTOR_API_KEY;
  const pending = getPendingOtp(request);
  if (!apiKey || !pending) return json({ error: "Your code has expired. Request a new one." }, 401);
  let code = "";
  try {
    code = String((await request.json() as { code?: unknown }).code || "").replace(/\D/g, "");
  } catch {
    return json({ error: "Enter the SMS code" }, 400);
  }
  if (code.length < 4 || code.length > 8) return json({ error: "Enter the SMS code" }, 400);

  try {
    const response = await fetch(`https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/VERIFY/${encodeURIComponent(pending.sessionId)}/${code}`, { method: "POST" });
    const result = await response.json() as { Status?: string; Details?: string; Errors?: string };
    if (!response.ok || result.Status?.toLowerCase() !== "success") {
      return json({ error: result.Details || result.Errors || "That code is invalid or has expired" }, 401);
    }
    return new Response(JSON.stringify({ user: { id: `phone:${pending.phone}`, phone: `+${pending.phone}` } }), {
      status: 200,
      headers: sessionHeaders(pending.phone),
    });
  } catch {
    return json({ error: "The code could not be verified. Please try again." }, 502);
  }
}
