import { createPendingOtpCookie, normalizeMobileNumber } from "../../../../lib/customer-sms-auth";

const json = (body: Record<string, unknown>, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export async function POST(request: Request) {
  const apiKey = process.env.TWOFACTOR_API_KEY;
  if (!apiKey) return json({ error: "SMS login is not configured yet" }, 503);
  let phone = "";
  try {
    phone = normalizeMobileNumber((await request.json() as { phone?: unknown }).phone);
  } catch {
    return json({ error: "Enter a valid mobile number" }, 400);
  }
  if (!phone) return json({ error: "Enter a valid 10-digit Indian mobile number" }, 400);

  try {
    const response = await fetch(`https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/${phone}/AUTOGEN`, { method: "POST" });
    const result = await response.json() as { Status?: string; Details?: string; Errors?: string };
    if (!response.ok || result.Status?.toLowerCase() !== "success" || !result.Details) {
      return json({ error: result.Details || result.Errors || "The SMS code could not be sent" }, 502);
    }
    return json({ sent: true }, 200, { "set-cookie": createPendingOtpCookie(phone, result.Details) });
  } catch {
    return json({ error: "The SMS code could not be sent. Please try again." }, 502);
  }
}
