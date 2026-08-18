import { clearAdminSessionCookie, createAdminSessionCookie, getAdminCredentials, isAdminConfigured, isAdminSessionValid, verifySupabaseAdminCredentials } from "../../../lib/admin-auth";

const json = (body: Record<string, unknown>, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export async function GET(request: Request) {
  return json({ authenticated: isAdminSessionValid(request) });
}

export async function POST(request: Request) {
  if (!isAdminConfigured()) return json({ error: "Admin login is not configured." }, 503);
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json() as { email?: unknown; password?: unknown };
  } catch {
    return json({ error: "Enter your email and password." }, 400);
  }
  const credentials = getAdminCredentials();
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const validEnvironmentPassword = email === credentials.email && password === credentials.password;
  const validSupabasePassword = !validEnvironmentPassword && await verifySupabaseAdminCredentials(email, password);
  if (!validEnvironmentPassword && !validSupabasePassword) return json({ error: "Incorrect email or password." }, 401);
  return json({ authenticated: true }, 200, { "set-cookie": createAdminSessionCookie() });
}

export async function DELETE() {
  return json({ authenticated: false }, 200, { "set-cookie": clearAdminSessionCookie() });
}
