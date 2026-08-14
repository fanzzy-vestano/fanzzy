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
  const pending = getPendingOtp(request);
  if (!pending) return json({ error: "OTP expired" }, 410);
  let code = "";
  try {
    code = String((await request.json() as { code?: unknown }).code || "").replace(/\D/g, "");
  } catch {
    return json({ error: "Enter the SMS code" }, 400);
  }
  if (code.length !== 6) return json({ error: "Enter the SMS code" }, 400);
  if (code !== pending.code) return json({ error: "Invalid OTP" }, 401);

  try {
    return new Response(JSON.stringify({ user: { id: `phone:${pending.phone}`, phone: `+${pending.phone}` } }), {
      status: 200,
      headers: sessionHeaders(pending.phone),
    });
  } catch {
    return json({ error: "The code could not be verified. Please try again." }, 502);
  }
}
