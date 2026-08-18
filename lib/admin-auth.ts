import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ADMIN_COOKIE = "fanzzy_admin_session";
const SESSION_MAX_AGE = 60 * 60 * 12;
let runtimeAdminPassword = "";
let pendingReset: { email: string; token: string; otp: string; expiresAt: number } | null = null;
const getSecret = () => process.env.ADMIN_AUTH_SECRET?.trim() || "";
const sign = (value: string) => createHmac("sha256", getSecret()).update(value).digest("base64url");

export const getAdminCredentials = () => ({
  email: process.env.ADMIN_LOGIN_EMAIL?.trim().toLowerCase() || "",
  password: runtimeAdminPassword || process.env.ADMIN_LOGIN_PASSWORD || "",
});

export const isAdminConfigured = () => {
  const credentials = getAdminCredentials();
  return Boolean(credentials.email && credentials.password && getSecret());
};

const supabaseAuthConfig = () => ({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "",
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || "",
});

export const verifySupabaseAdminCredentials = async (email: string, password: string) => {
  const credentials = getAdminCredentials();
  const config = supabaseAuthConfig();
  if (!credentials.email || email !== credentials.email || !config.url || !config.key) return false;
  try {
    const response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: config.key, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return response.ok;
  } catch {
    return false;
  }
};

export const issueAdminPasswordReset = (email: string) => {
  const credentials = getAdminCredentials();
  if (!credentials.email || email.trim().toLowerCase() !== credentials.email) return null;
  const token = `${Date.now().toString(36)}-${randomBytes(24).toString("hex")}`;
  const otp = String(randomBytes(4).readUInt32BE(0) % 1000000).padStart(6, "0");
  pendingReset = { email: credentials.email, token, otp, expiresAt: Date.now() + 15 * 60 * 1000 };
  return token;
};

export const getAdminPasswordResetOtp = (token: string) =>
  pendingReset?.token === token && pendingReset.expiresAt >= Date.now() ? pendingReset.otp : null;

export const resetAdminPassword = (token: string, password: string, otp = "") => {
  const tokenMatches = Boolean(token && pendingReset?.token === token);
  const otpMatches = Boolean(otp && pendingReset?.otp === otp);
  if (!pendingReset || (!tokenMatches && !otpMatches) || pendingReset.expiresAt < Date.now()) {
    pendingReset = null;
    return false;
  }
  if (password.length < 6) return false;
  runtimeAdminPassword = password;
  pendingReset = null;
  return true;
};

export const createAdminSessionCookie = () => {
  const value = `authenticated.${sign("authenticated")}`;
  return `${ADMIN_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
};

export const clearAdminSessionCookie = () => `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

export const isAdminSessionValid = (request: Request) => {
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${ADMIN_COOKIE}=`));
  const value = cookie?.slice(`${ADMIN_COOKIE}=`.length) || "";
  const [payload, signature] = value.split(".");
  if (payload !== "authenticated" || !signature || !getSecret()) return false;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
};
