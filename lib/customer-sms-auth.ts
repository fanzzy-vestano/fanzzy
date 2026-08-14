import { createHmac, timingSafeEqual } from "node:crypto";

export type CustomerSmsIdentity = { id: string; phone: string };

type PendingOtp = { phone: string; sessionId: string; code: string; expiresAt: number };
type SignedValue = CustomerSmsIdentity | PendingOtp;

const pendingCookie = "fanzzy_customer_otp";
const sessionCookie = "fanzzy_customer_session";
const isProduction = process.env.NODE_ENV === "production";

// Keep the new name canonical, but accept the legacy spelling so an existing
// deployment does not silently disable customer SMS login during a rollout.
export const getTwoFactorApiKey = () =>
  process.env.TWO_FACTOR_API_KEY?.trim() || process.env.TWOFACTOR_API_KEY?.trim() || "";

const secret = () => process.env.CUSTOMER_AUTH_SECRET || getTwoFactorApiKey();

const OTP_RESEND_COOLDOWN_SECONDS = 45;
const OTP_WINDOW_MS = 15 * 60 * 1000;
const OTP_MAX_REQUESTS_PER_WINDOW = 5;
const OTP_RATE_LIMIT_MAX_ENTRIES = 10_000;
type OtpRateLimitEntry = { windowStartedAt: number; requestCount: number; lastRequestedAt: number };
const otpRateLimits = new Map<string, OtpRateLimitEntry>();
const base64Url = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const fromBase64Url = (value: string) => Buffer.from(value, "base64url").toString("utf8");

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

const encode = (value: SignedValue) => {
  const payload = base64Url(JSON.stringify(value));
  return `${payload}.${sign(payload)}`;
};

const decode = <T extends SignedValue>(value?: string): T | null => {
  if (!value || !secret()) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    return JSON.parse(fromBase64Url(payload)) as T;
  } catch {
    return null;
  }
};

const getCookie = (request: Request, name: string) => request.headers.get("cookie")
  ?.split(";")
  .map((part) => part.trim().split("="))
  .find(([key]) => key === name)?.slice(1).join("=");

const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProduction ? "; Secure" : ""}`;

export const normalizeMobileNumber = (value: unknown) => {
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return "";
};

const getClientIp = (request: Request) =>
  request.headers.get("cf-connecting-ip")?.trim()
  || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  || request.headers.get("x-real-ip")?.trim()
  || "unknown";

const rateLimitKeys = (request: Request, phone: string) => [
  `phone:${phone}`,
  `ip:${getClientIp(request)}`,
];

const pruneOtpRateLimits = (now: number) => {
  for (const [key, entry] of otpRateLimits) {
    if (now - entry.windowStartedAt >= OTP_WINDOW_MS) otpRateLimits.delete(key);
  }
  if (otpRateLimits.size <= OTP_RATE_LIMIT_MAX_ENTRIES) return;
  const oldest = [...otpRateLimits.entries()]
    .sort(([, first], [, second]) => first.lastRequestedAt - second.lastRequestedAt)
    .slice(0, otpRateLimits.size - OTP_RATE_LIMIT_MAX_ENTRIES);
  for (const [key] of oldest) otpRateLimits.delete(key);
};

export const consumeOtpRateLimit = (request: Request, phone: string) => {
  const now = Date.now();
  pruneOtpRateLimits(now);
  const entries = rateLimitKeys(request, phone).map((key) => ({ key, entry: otpRateLimits.get(key) }));
  const retryAfter = entries.reduce((longest, { entry }) => {
    if (!entry || now - entry.windowStartedAt >= OTP_WINDOW_MS) return longest;
    if (now - entry.lastRequestedAt < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
      return Math.max(longest, OTP_RESEND_COOLDOWN_SECONDS - Math.floor((now - entry.lastRequestedAt) / 1000));
    }
    if (entry.requestCount >= OTP_MAX_REQUESTS_PER_WINDOW) {
      return Math.max(longest, Math.ceil((entry.windowStartedAt + OTP_WINDOW_MS - now) / 1000));
    }
    return longest;
  }, 0);
  if (retryAfter > 0) return { allowed: false as const, retryAfter };

  for (const { key, entry } of entries) {
    const next = !entry || now - entry.windowStartedAt >= OTP_WINDOW_MS
      ? { windowStartedAt: now, requestCount: 1, lastRequestedAt: now }
      : { ...entry, requestCount: entry.requestCount + 1, lastRequestedAt: now };
    otpRateLimits.set(key, next);
  }
  return { allowed: true as const, retryAfter: 0 };
};

export const displayMobileNumber = (phone: string) => `+${phone}`;

export const createPendingOtpCookie = (pending: PendingOtp) =>
  cookie(pendingCookie, encode(pending), Math.max(1, Math.ceil((pending.expiresAt - Date.now()) / 1000)));

export const getPendingOtp = (request: Request) => {
  const pending = decode<PendingOtp>(getCookie(request, pendingCookie));
  return pending && pending.expiresAt > Date.now() ? pending : null;
};

export const createCustomerSessionCookie = (phone: string) =>
  cookie(sessionCookie, encode({ id: `phone:${phone}`, phone: displayMobileNumber(phone) }), 60 * 60 * 24 * 30);

export const clearPendingOtpCookie = () => cookie(pendingCookie, "", 0);

export const clearCustomerAuthCookies = () => [
  clearPendingOtpCookie(),
  cookie(sessionCookie, "", 0),
];

export const getCustomerSession = (request: Request) => decode<CustomerSmsIdentity>(getCookie(request, sessionCookie));
