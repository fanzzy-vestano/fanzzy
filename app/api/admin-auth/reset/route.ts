import { isAdminConfigured, resetAdminPassword } from "../../../../lib/admin-auth";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function POST(request: Request) {
  if (!isAdminConfigured()) return json({ error: "Admin login is not configured." }, 503);

  let body: { token?: unknown; otp?: unknown; password?: unknown };
  try {
    body = await request.json() as { token?: unknown; otp?: unknown; password?: unknown };
  } catch {
    return json({ error: "Use a valid password reset link." }, 400);
  }

  const token = typeof body.token === "string" ? body.token : "";
  const otp = typeof body.otp === "string" ? body.otp.replace(/\D/g, "").slice(0, 6) : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 6) return json({ error: "New password must be at least 6 characters." }, 400);
  if (!resetAdminPassword(token, password, otp)) return json({ error: "This reset link or OTP is invalid or expired." }, 400);

  return json({ reset: true, message: "Password updated. You can sign in now." });
}
