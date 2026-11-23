import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js";
// @ts-expect-error Shared Edge module uses an explicit TypeScript extension.
import { applyCaptchaCase, CAPTCHA_ALPHABET, renderCaptchaImage } from "../supabase/functions/customer-auth/captcha-image.ts";

export type CustomerSmsIdentity = { id: string; phone: string };

type PendingOtp = { phone: string; codeHash: string; expiresAt: number };
type PendingOtpInput = { phone: string; code: string; expiresAt: number };
type CustomerSession = CustomerSmsIdentity & { kind: "session"; expiresAt: number };
type SignedValue = CustomerSession | PendingOtp;

const pendingCookie = "fanzzy_customer_otp";
const sessionCookie = "fanzzy_customer_session";
const isProduction = process.env.NODE_ENV === "production";

export const getCustomerAuthSecret = () => process.env.CUSTOMER_AUTH_SECRET?.trim() || "";

const secret = getCustomerAuthSecret;

// Four sends plus a fifth CAPTCHA-protected request fit in the five-minute window.
export const OTP_RESEND_COOLDOWN_SECONDS = 45;
export const OTP_EXPIRES_MS = 5 * 60 * 1000;
export const OTP_CAPTCHA_WINDOW_MS = 5 * 60 * 1000;
export const OTP_CAPTCHA_AFTER_SENDS = 4;
// Keep customers signed in across browser restarts until they explicitly sign out.
// This is intentionally long-lived rather than a browser-session cookie.
export const CUSTOMER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 3650;
const OTP_WINDOW_MS = 15 * 60 * 1000;
const OTP_MAX_REQUESTS_PER_WINDOW = 10;
const OTP_VERIFY_WINDOW_MS = 10 * 60 * 1000;
const OTP_MAX_VERIFY_ATTEMPTS = 8;
const OTP_RATE_LIMIT_MAX_ENTRIES = 10_000;
type OtpRateLimitEntry = { windowStartedAt: number; requestCount: number; lastRequestedAt: number };
type OtpCaptchaEntry = { phone: string; clientIp: string; answer: string; expiresAt: number; verified: boolean };
export type OtpCaptchaChallenge = { token: string; image: string; expiresAt: number };
const otpSendRateLimits = new Map<string, OtpRateLimitEntry>();
const otpVerifyRateLimits = new Map<string, OtpRateLimitEntry>();
const otpSendHistory = new Map<string, number[]>();
const otpCaptchaChallenges = new Map<string, OtpCaptchaEntry>();
const base64Url = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const fromBase64Url = (value: string) => Buffer.from(value, "base64url").toString("utf8");

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");
const hashOtp = ({ phone, code, expiresAt }: PendingOtpInput) =>
  createHmac("sha256", secret()).update(`otp:${phone}:${expiresAt}:${code}`).digest("base64url");

const encode = (value: SignedValue) => {
  const payload = base64Url(JSON.stringify(value));
  return `${payload}.${sign(payload)}`;
};

const decode = <T extends SignedValue>(value?: string): T | null => {
  if (!value || !secret()) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return null;
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

const getBearerToken = (request: Request) =>
  request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";

const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProduction ? "; Secure" : ""}`;

export const normalizeMobileNumber = (value: unknown) => {
  if (typeof value !== "string" || !/^[+\d\s().-]+$/.test(value.trim())) return "";
  const digits = value.replace(/\D/g, "");
  const number = parsePhoneNumberFromString(value.trim().startsWith("+") ? value : digits.length === 10 ? `+91${digits}` : `+${digits}`);
  return number?.isPossible() && !number.ext ? number.number.slice(1) : "";
};

const getClientIp = (request: Request) =>
  request.headers.get("cf-connecting-ip")?.trim()
  || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  || request.headers.get("x-real-ip")?.trim()
  || "unknown";

const rateLimitKeys = (scope: "send" | "verify", request: Request, phone: string) => [
  `${scope}:phone:${phone}`,
  `${scope}:ip:${getClientIp(request)}`,
];

// CAPTCHA eligibility belongs to the recipient, not to everyone sharing an IP.
const otpCaptchaRequiredUntil = (phone: string) => {
  const timestamps = otpSendHistory.get(phone) || [];
  return timestamps.length >= OTP_CAPTCHA_AFTER_SENDS
    ? timestamps[timestamps.length - OTP_CAPTCHA_AFTER_SENDS] + OTP_CAPTCHA_WINDOW_MS
    : 0;
};

const trimMap = <T>(entries: Map<string, T>) => {
  while (entries.size > OTP_RATE_LIMIT_MAX_ENTRIES) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey === undefined) return;
    entries.delete(oldestKey);
  }
};

const pruneOtpCaptchaState = (now: number) => {
  for (const [key, timestamps] of otpSendHistory) {
    const recent = timestamps.filter((timestamp) => now - timestamp < OTP_CAPTCHA_WINDOW_MS);
    if (recent.length) otpSendHistory.set(key, recent);
    else otpSendHistory.delete(key);
  }
  for (const [token, challenge] of otpCaptchaChallenges) {
    if (challenge.expiresAt <= now) otpCaptchaChallenges.delete(token);
  }
  trimMap(otpSendHistory);
  trimMap(otpCaptchaChallenges);
};

const createOtpCaptcha = (request: Request, phone: string, expiresAt: number): OtpCaptchaChallenge => {
  const noise = randomBytes(10);
  const answer = applyCaptchaCase(Array.from(randomBytes(5), (byte) => CAPTCHA_ALPHABET[byte % CAPTCHA_ALPHABET.length]).join(""), noise);
  const token = randomBytes(24).toString("base64url");
  otpCaptchaChallenges.set(token, {
    phone,
    clientIp: getClientIp(request),
    answer,
    expiresAt,
    verified: false,
  });
  trimMap(otpCaptchaChallenges);
  return { token, image: renderCaptchaImage(answer, noise), expiresAt };
};

export const getOtpSendCaptchaRequirement = (
  request: Request,
  phone: string,
  captchaToken?: string,
) => {
  const now = Date.now();
  pruneOtpCaptchaState(now);
  const requiredUntil = otpCaptchaRequiredUntil(phone);
  if (!requiredUntil) return { allowed: true as const, captchaToken: "" };

  const challenge = captchaToken ? otpCaptchaChallenges.get(captchaToken) : null;
  if (
    challenge
    && challenge.phone === phone
    && challenge.clientIp === getClientIp(request)
    && challenge.expiresAt > now
    && challenge.verified
  ) {
    return { allowed: true as const, captchaToken };
  }
  return { allowed: false as const, captcha: createOtpCaptcha(request, phone, requiredUntil) };
};

export const recordOtpSend = (request: Request, phone: string, resetCaptchaCycle = false) => {
  const now = Date.now();
  pruneOtpCaptchaState(now);
  otpSendHistory.set(phone, [...(resetCaptchaCycle ? [] : otpSendHistory.get(phone) || []), now]);
  trimMap(otpSendHistory);
};

export const verifyOtpSendCaptcha = (request: Request, phone: string, token: string, answer: string) => {
  const now = Date.now();
  pruneOtpCaptchaState(now);
  const requiredUntil = otpCaptchaRequiredUntil(phone);
  if (!requiredUntil) return { status: "not-required" as const };
  const challenge = otpCaptchaChallenges.get(token);
  if (!challenge || challenge.phone !== phone || challenge.clientIp !== getClientIp(request) || challenge.expiresAt <= now) {
    return { status: "invalid" as const, captcha: createOtpCaptcha(request, phone, requiredUntil) };
  }
  if (answer.trim() !== challenge.answer) {
    otpCaptchaChallenges.delete(token);
    return { status: "incorrect" as const, captcha: createOtpCaptcha(request, phone, requiredUntil) };
  }
  challenge.verified = true;
  return { status: "verified" as const };
};

export const completeOtpSendCaptcha = (captchaToken?: string) => {
  if (captchaToken) otpCaptchaChallenges.delete(captchaToken);
};

export const refreshOtpSendCaptcha = (request: Request, phone: string, token: string) => {
  const now = Date.now();
  pruneOtpCaptchaState(now);
  const requiredUntil = otpCaptchaRequiredUntil(phone);
  if (!requiredUntil) return { status: "not-required" as const };
  const previous = otpCaptchaChallenges.get(token);
  if (!previous || previous.phone !== phone || previous.clientIp !== getClientIp(request) || previous.expiresAt <= now) {
    return { status: "invalid" as const };
  }
  otpCaptchaChallenges.delete(token);
  return { status: "refreshed" as const, captcha: createOtpCaptcha(request, phone, requiredUntil) };
};

const pruneOtpRateLimits = (rateLimits: Map<string, OtpRateLimitEntry>, windowMs: number, now: number) => {
  for (const [key, entry] of rateLimits) {
    if (now - entry.windowStartedAt >= windowMs) rateLimits.delete(key);
  }
  if (rateLimits.size <= OTP_RATE_LIMIT_MAX_ENTRIES) return;
  const oldest = [...rateLimits.entries()]
    .sort(([, first], [, second]) => first.lastRequestedAt - second.lastRequestedAt)
    .slice(0, rateLimits.size - OTP_RATE_LIMIT_MAX_ENTRIES);
  for (const [key] of oldest) rateLimits.delete(key);
};

const consumeRateLimit = ({
  scope,
  rateLimits,
  request,
  phone,
  windowMs,
  maxRequests,
  cooldownSeconds = 0,
}: {
  scope: "send" | "verify";
  rateLimits: Map<string, OtpRateLimitEntry>;
  request: Request;
  phone: string;
  windowMs: number;
  maxRequests: number;
  cooldownSeconds?: number;
}) => {
  const now = Date.now();
  pruneOtpRateLimits(rateLimits, windowMs, now);
  const entries = rateLimitKeys(scope, request, phone).map((key) => ({ key, entry: rateLimits.get(key) }));
  const retryAfter = entries.reduce((longest, { entry }) => {
    if (!entry || now - entry.windowStartedAt >= windowMs) return longest;
    if (cooldownSeconds && now - entry.lastRequestedAt < cooldownSeconds * 1000) {
      return Math.max(longest, cooldownSeconds - Math.floor((now - entry.lastRequestedAt) / 1000));
    }
    if (entry.requestCount >= maxRequests) {
      return Math.max(longest, Math.ceil((entry.windowStartedAt + windowMs - now) / 1000));
    }
    return longest;
  }, 0);
  if (retryAfter > 0) return { allowed: false as const, retryAfter };

  for (const { key, entry } of entries) {
    const next = !entry || now - entry.windowStartedAt >= windowMs
      ? { windowStartedAt: now, requestCount: 1, lastRequestedAt: now }
      : { ...entry, requestCount: entry.requestCount + 1, lastRequestedAt: now };
    rateLimits.set(key, next);
  }
  return { allowed: true as const, retryAfter: 0 };
};

export const consumeOtpSendRateLimit = (request: Request, phone: string) => consumeRateLimit({
  scope: "send",
  rateLimits: otpSendRateLimits,
  request,
  phone,
  windowMs: OTP_WINDOW_MS,
  maxRequests: OTP_MAX_REQUESTS_PER_WINDOW,
  cooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
});

export const consumeOtpVerifyRateLimit = (request: Request, phone: string) => consumeRateLimit({
  scope: "verify",
  rateLimits: otpVerifyRateLimits,
  request,
  phone,
  windowMs: OTP_VERIFY_WINDOW_MS,
  maxRequests: OTP_MAX_VERIFY_ATTEMPTS,
});

export const displayMobileNumber = (phone: string) => `+${phone}`;

export const createPendingOtpToken = (pending: PendingOtpInput) =>
  encode({ phone: pending.phone, codeHash: hashOtp(pending), expiresAt: pending.expiresAt });

export const createPendingOtpCookie = (pending: PendingOtpInput) =>
  cookie(
    pendingCookie,
    createPendingOtpToken(pending),
    Math.max(1, Math.ceil((pending.expiresAt - Date.now()) / 1000)),
  );

export const getPendingOtp = (request: Request) => {
  const pending = decode<PendingOtp>(getBearerToken(request) || getCookie(request, pendingCookie));
  return pending && typeof pending.phone === "string" && typeof pending.codeHash === "string"
    && Number.isFinite(pending.expiresAt) && pending.expiresAt > Date.now() ? pending : null;
};

export const matchesPendingOtp = (pending: PendingOtp, code: string) => {
  if (!secret() || !pending.codeHash) return false;
  const expected = Buffer.from(hashOtp({ phone: pending.phone, code, expiresAt: pending.expiresAt }));
  const received = Buffer.from(pending.codeHash);
  return expected.length === received.length && timingSafeEqual(expected, received);
};

export const createCustomerSessionToken = (phone: string) =>
  encode({ id: `phone:${phone}`, phone: displayMobileNumber(phone), kind: "session", expiresAt: Date.now() + CUSTOMER_SESSION_MAX_AGE_SECONDS * 1000 });

export const createCustomerSessionCookie = (phone: string) =>
  cookie(sessionCookie, createCustomerSessionToken(phone), CUSTOMER_SESSION_MAX_AGE_SECONDS);

export const clearPendingOtpCookie = () => cookie(pendingCookie, "", 0);

export const clearCustomerAuthCookies = () => [
  clearPendingOtpCookie(),
  cookie(sessionCookie, "", 0),
];

export const getCustomerSession = (request: Request) => {
  const decoded = decode<CustomerSession>(getBearerToken(request) || getCookie(request, sessionCookie));
  if (!decoded || decoded.kind !== "session" || !Number.isFinite(decoded.expiresAt) || decoded.expiresAt <= Date.now()) return null;
  // Pending OTP tokens share the signer but do not prove phone ownership.
  // Require the complete identity issued only after successful verification.
  if (typeof decoded.id !== "string" || typeof decoded.phone !== "string") return null;
  const phone = normalizeMobileNumber(decoded.phone);
  if (!phone || decoded.id !== `phone:${phone}`) return null;
  return { id: decoded.id, phone: decoded.phone };
};
