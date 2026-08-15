import { createHmac, timingSafeEqual } from "node:crypto";

const ADMIN_COOKIE = "fanzzy_admin_session";
const SESSION_MAX_AGE = 60 * 60 * 12;
const getSecret = () => process.env.ADMIN_AUTH_SECRET?.trim() || "";
const sign = (value: string) => createHmac("sha256", getSecret()).update(value).digest("base64url");

export const getAdminCredentials = () => ({
  email: process.env.ADMIN_LOGIN_EMAIL?.trim().toLowerCase() || "",
  password: process.env.ADMIN_LOGIN_PASSWORD || "",
});

export const isAdminConfigured = () => {
  const credentials = getAdminCredentials();
  return Boolean(credentials.email && credentials.password && getSecret());
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
