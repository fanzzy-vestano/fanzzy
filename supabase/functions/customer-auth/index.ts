// @ts-expect-error Deno Edge imports use explicit TypeScript file extensions.
import { md5 } from "./md5.ts";
// @ts-expect-error Supabase Edge resolves npm specifiers through Deno.
import { parsePhoneNumberFromString } from "npm:libphonenumber-js@1.13.17";
// @ts-expect-error Deno Edge imports use explicit TypeScript file extensions.
import { applyCaptchaCase, CAPTCHA_ALPHABET, renderCaptchaImage } from "./captcha-image.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const SANGAMAM_SMS_ENDPOINT = "https://fastsms.sangamamonline.in/api/sms/v1.0/send-sms";
const SANGAMAM_SMS_REQUEST_FOR = "send-sms";
const SANGAMAM_SMS_SIGNATURE_NAMESPACE = "sms@rits-v1.0";
const SANGAMAM_SMS_HEADER = "FANZZY";
const SANGAMAM_SMS_ENTITY_ID = "1201178763981946340";
const SANGAMAM_SMS_TEMPLATE_ID = "1277178790132462995";
const OTP_EXPIRES_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 45 * 1000;
const OTP_WINDOW_MS = 15 * 60 * 1000;
const OTP_MAX_REQUESTS = 10;
const OTP_CAPTCHA_WINDOW_MS = 5 * 60 * 1000;
const OTP_CAPTCHA_AFTER_SENDS = 4;
const OTP_VERIFY_WINDOW_MS = 10 * 60 * 1000;
const OTP_MAX_VERIFY_ATTEMPTS = 8;
// Keep the external session valid across browser restarts until the customer signs out.
const CUSTOMER_SESSION_MAX_AGE_MS = 3650 * 24 * 60 * 60 * 1000;

type PendingOtp = { kind: "pending"; phone: string; otpDigest: string; expiresAt: number };
type CustomerSession = { kind: "session"; id: string; phone: string; expiresAt: number };
type TokenPayload = PendingOtp | CustomerSession;
type RateEntry = { windowStartedAt: number; requestCount: number; lastRequestedAt: number };
type CaptchaChallenge = { key: string; answer: string; expiresAt: number; verified: boolean };

const sendLimits = new Map<string, RateEntry>();
const verifyLimits = new Map<string, RateEntry>();
const otpSendHistory = new Map<string, number[]>();
const otpCaptchaChallenges = new Map<string, CaptchaChallenge>();
const jsonHeaders = { "content-type": "application/json" };

const corsHeaders = (origin: string | null) => ({
  ...jsonHeaders,
  "access-control-allow-origin": origin && [
    "https://fanzzy.in",
    "https://www.fanzzy.in",
    "http://localhost:3000",
    "http://localhost:5173",
  ].includes(origin) ? origin : "https://fanzzy.in",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-credentials": "true",
  "access-control-max-age": "86400",
});

const response = (body: Record<string, unknown>, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });

const base64UrlEncode = (value: string | Uint8Array) => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const base64UrlDecode = (value: string) => {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4));
  return new Uint8Array([...binary].map((character) => character.charCodeAt(0)));
};

const customerAuthSecret = () => Deno.env.get("CUSTOMER_AUTH_SECRET")?.trim() || "";

const secretKey = async () => crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(customerAuthSecret()),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"],
);

const createToken = async (payload: TokenPayload) => {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign("HMAC", await secretKey(), new TextEncoder().encode(encoded));
  return `${encoded}.${base64UrlEncode(new Uint8Array(signature))}`;
};

const otpPayload = (phone: string, code: string, expiresAt: number) => `otp:${phone}:${expiresAt}:${code}`;

const createOtpDigest = async (phone: string, code: string, expiresAt: number) => {
  const signature = await crypto.subtle.sign("HMAC", await secretKey(), new TextEncoder().encode(otpPayload(phone, code, expiresAt)));
  return base64UrlEncode(new Uint8Array(signature));
};

const verifyOtpDigest = async (pending: PendingOtp, code: string) => {
  if (!pending.otpDigest) return false;
  return crypto.subtle.verify(
    "HMAC",
    await secretKey(),
    base64UrlDecode(pending.otpDigest),
    new TextEncoder().encode(otpPayload(pending.phone, code, pending.expiresAt)),
  );
};

const readToken = async <T extends TokenPayload>(request: Request, kind: T["kind"]) => {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const valid = await crypto.subtle.verify("HMAC", await secretKey(), base64UrlDecode(signature), new TextEncoder().encode(encoded));
  if (!valid) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded))) as T;
    return payload.kind === kind && payload.expiresAt > Date.now() ? payload : null;
  } catch {
    return null;
  }
};

const normalizeMobileNumber = (value: unknown) => {
  if (typeof value !== "string" || !/^[+\d\s().-]+$/.test(value.trim())) return "";
  const digits = value.replace(/\D/g, "");
  const number = parsePhoneNumberFromString(value.trim().startsWith("+") ? value : digits.length === 10 ? `+91${digits}` : `+${digits}`);
  return number?.isPossible() && !number.ext ? number.number.slice(1) : "";
};

const clientKey = (request: Request, phone: string) => `${request.headers.get("x-forwarded-for") || "unknown"}:${phone}`;

const checkRateLimit = (limits: Map<string, RateEntry>, key: string, windowMs: number, maxRequests: number, cooldownMs = 0) => {
  const now = Date.now();
  const previous = limits.get(key);
  if (previous && now - previous.windowStartedAt < windowMs) {
    if (cooldownMs && now - previous.lastRequestedAt < cooldownMs) {
      return Math.ceil((cooldownMs - (now - previous.lastRequestedAt)) / 1000);
    }
    if (previous.requestCount >= maxRequests) {
      return Math.ceil((previous.windowStartedAt + windowMs - now) / 1000);
    }
  }
  limits.set(key, previous && now - previous.windowStartedAt < windowMs
    ? { ...previous, requestCount: previous.requestCount + 1, lastRequestedAt: now }
    : { windowStartedAt: now, requestCount: 1, lastRequestedAt: now });
  return 0;
};

const randomCaptchaCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return [...bytes].map((byte) => CAPTCHA_ALPHABET[byte % CAPTCHA_ALPHABET.length]).join("");
};

const pruneCaptchaState = (now: number) => {
  for (const [key, timestamps] of otpSendHistory) {
    const recent = timestamps.filter((timestamp) => now - timestamp < OTP_CAPTCHA_WINDOW_MS);
    if (recent.length) otpSendHistory.set(key, recent);
    else otpSendHistory.delete(key);
  }
  for (const [token, challenge] of otpCaptchaChallenges) {
    if (challenge.expiresAt <= now) otpCaptchaChallenges.delete(token);
  }
};

const captchaRequiredUntil = (phone: string) => {
  const timestamps = otpSendHistory.get(phone) || [];
  return timestamps.length >= OTP_CAPTCHA_AFTER_SENDS
    ? timestamps[timestamps.length - OTP_CAPTCHA_AFTER_SENDS] + OTP_CAPTCHA_WINDOW_MS
    : 0;
};

const createCaptchaChallenge = (key: string, expiresAt: number) => {
  const token = base64UrlEncode(crypto.getRandomValues(new Uint8Array(24)));
  const noise = crypto.getRandomValues(new Uint8Array(10));
  const answer = applyCaptchaCase(randomCaptchaCode(), noise);
  otpCaptchaChallenges.set(token, { key, answer, expiresAt, verified: false });
  return { token, image: renderCaptchaImage(answer, noise), expiresAt };
};

const getOtpSendCaptchaRequirement = (key: string, phone: string, captchaToken?: unknown) => {
  const now = Date.now();
  pruneCaptchaState(now);
  const requiredUntil = captchaRequiredUntil(phone);
  if (!requiredUntil) {
    return { allowed: true as const, captchaToken: "" };
  }
  const token = typeof captchaToken === "string" ? captchaToken : "";
  const challenge = token ? otpCaptchaChallenges.get(token) : null;
  if (challenge && challenge.key === key && challenge.expiresAt > now && challenge.verified) {
    return { allowed: true as const, captchaToken: token };
  }
  return { allowed: false as const, captcha: createCaptchaChallenge(key, requiredUntil) };
};

const recordOtpSend = (key: string, phone: string, resetCaptchaCycle = false) => {
  const now = Date.now();
  pruneCaptchaState(now);
  otpSendHistory.set(phone, [...(resetCaptchaCycle ? [] : otpSendHistory.get(phone) || []), now]);
};

const verifyOtpSendCaptcha = (key: string, phone: string, token: unknown, answer: unknown) => {
  const now = Date.now();
  pruneCaptchaState(now);
  const requiredUntil = captchaRequiredUntil(phone);
  if (!requiredUntil) return { status: "not-required" as const };
  const challenge = typeof token === "string" ? otpCaptchaChallenges.get(token) : null;
  if (!challenge || challenge.key !== key || challenge.expiresAt <= now) {
    return { status: "invalid" as const, captcha: createCaptchaChallenge(key, requiredUntil) };
  }
  if (typeof answer !== "string" || answer.trim() !== challenge.answer) {
    otpCaptchaChallenges.delete(token as string);
    return { status: "incorrect" as const, captcha: createCaptchaChallenge(key, requiredUntil) };
  }
  challenge.verified = true;
  return { status: "verified" as const };
};

const refreshOtpSendCaptcha = (key: string, phone: string, token: unknown) => {
  const now = Date.now();
  pruneCaptchaState(now);
  const requiredUntil = captchaRequiredUntil(phone);
  if (!requiredUntil) return { status: "not-required" as const };
  const previous = typeof token === "string" ? otpCaptchaChallenges.get(token) : null;
  if (!previous || previous.key !== key || previous.expiresAt <= now) return { status: "invalid" as const };
  otpCaptchaChallenges.delete(token as string);
  return { status: "refreshed" as const, captcha: createCaptchaChallenge(key, requiredUntil) };
};

const createProviderSignature = (accessToken: string, accessTokenKey: string, expire: number) => {
  const timeKey = md5(`${SANGAMAM_SMS_REQUEST_FOR}${SANGAMAM_SMS_SIGNATURE_NAMESPACE}${expire}`);
  const timeAccessTokenKey = md5(`${accessToken}${timeKey}`);
  return md5(`${timeAccessTokenKey}${accessTokenKey}`);
};

const otpMessage = (code: string) =>
  `${code} is your OTP to verify phone number at Fanzzy. Please do not share OTP with anyone.`;

const sendOtp = async (phone: string) => {
  const accessToken = Deno.env.get("SANGAMAM_SMS_ACCESS_TOKEN")?.trim() || "";
  const accessTokenKey = Deno.env.get("SANGAMAM_SMS_ACCESS_TOKEN_KEY")?.trim() || "";
  const smsHeader = Deno.env.get("SANGAMAM_SMS_HEADER")?.trim() || SANGAMAM_SMS_HEADER;
  const entityId = Deno.env.get("SANGAMAM_SMS_ENTITY_ID")?.trim() || SANGAMAM_SMS_ENTITY_ID;
  const templateId = Deno.env.get("SANGAMAM_SMS_TEMPLATE_ID")?.trim() || SANGAMAM_SMS_TEMPLATE_ID;
  if (!accessToken || !accessTokenKey || !customerAuthSecret()) throw new Error("Sangamam FastSMS login is not configured.");
  const code = String(Math.floor(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  const expire = Math.floor(Date.now() / 1000) + 60;
  const providerResponse = await fetch(SANGAMAM_SMS_ENDPOINT, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      accessToken,
      expire,
      authSignature: createProviderSignature(accessToken, accessTokenKey, expire),
      route: "transactional",
      smsHeader,
      messageContent: otpMessage(code),
      recipients: [phone.startsWith("91") ? phone.slice(2) : phone],
      contentType: "text",
      entityId,
      templateId,
      removeDuplicateNumbers: 1,
    }),
  });
  const rawProviderResponse = await providerResponse.text();
  let providerResult: Record<string, unknown> = {};
  try {
    providerResult = JSON.parse(rawProviderResponse) as Record<string, unknown>;
  } catch {
    if (!providerResponse.ok) throw new Error("The SMS provider could not send the code.");
  }
  const providerStatus = String(providerResult.status ?? "").trim().toLowerCase();
  const providerHttpStatus = Number(providerResult.httpStatusCode ?? providerResponse.status);
  const providerDetails = String(providerResult.message ?? "").trim();
  if (!providerResponse.ok || providerStatus !== "success" || providerHttpStatus !== 200) {
    throw new Error(providerDetails || "Sangamam FastSMS could not send the SMS code.");
  }
  return code;
};

const route = async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  // The mobile app uses GET /session to restore a verified SMS login. Handle
  // that route before the generic health response so the session token is
  // actually validated and returned to the client.
  if (request.method === "GET") {
    const action = new URL(request.url).pathname.split("/").filter(Boolean).at(-1) || "";
    if (action === "session") {
      const session = await readToken<CustomerSession>(request, "session");
      return response({ user: session ? { id: session.id, phone: session.phone } : null }, 200, origin);
    }
    return response({ ok: true, service: "customer-auth" }, 200, origin);
  }
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405, origin);

  const action = new URL(request.url).pathname.split("/").filter(Boolean).at(-1) || "";
  let body: { phone?: unknown; code?: unknown; captchaToken?: unknown; captchaAnswer?: unknown; refreshCaptcha?: unknown; verifyCaptcha?: unknown } = {};
  try { body = await request.json() as typeof body; } catch { /* handled below */ }

  if (action === "send-otp") {
    const phone = normalizeMobileNumber(body.phone);
    if (!phone) return response({ error: "Enter a valid mobile number with its country code." }, 400, origin);
    if (!phone.startsWith("91")) return response({ error: "International SMS login is not configured yet." }, 503, origin);
    const key = clientKey(request, phone);
    if (body.refreshCaptcha === true) {
      const refreshed = refreshOtpSendCaptcha(key, phone, body.captchaToken);
      if (refreshed.status === "invalid") return response({ error: "Security check expired. Please request a new OTP." }, 400, origin);
      if (refreshed.status === "not-required") return response({ captchaRequired: false }, 200, origin);
      return response({ captchaRequired: true, captcha: refreshed.captcha }, 200, origin);
    }
    if (body.verifyCaptcha === true) {
      const verified = verifyOtpSendCaptcha(key, phone, body.captchaToken, body.captchaAnswer);
      if (verified.status === "not-required") return response({ captchaRequired: false }, 200, origin);
      if (verified.status === "verified") return response({ captchaRequired: true, captchaVerified: true }, 200, origin);
      return response({ error: "Incorrect CAPTCHA. Please try the new image.", captchaRequired: true, captcha: verified.captcha }, 400, origin);
    }
    const captcha = getOtpSendCaptchaRequirement(key, phone, body.captchaToken);
    if (!captcha.allowed) {
      return response({
        error: "Please enter and verify the CAPTCHA to resend the OTP.",
        captchaRequired: true,
        captcha: captcha.captcha,
      }, 429, origin);
    }
    const retryAfter = checkRateLimit(sendLimits, key, OTP_WINDOW_MS, OTP_MAX_REQUESTS, OTP_RESEND_COOLDOWN_MS);
    if (retryAfter) return response({ error: `Please wait ${retryAfter} seconds before requesting another OTP.` }, 429, origin);
    try {
      const code = await sendOtp(phone);
      const expiresAt = Date.now() + OTP_EXPIRES_MS;
      const otpDigest = await createOtpDigest(phone, code, expiresAt);
      recordOtpSend(key, phone, Boolean(captcha.captchaToken));
      if (captcha.captchaToken) otpCaptchaChallenges.delete(captcha.captchaToken);
      return response({
        sent: true,
        channel: "sms",
        pendingToken: await createToken({ kind: "pending", phone, otpDigest, expiresAt }),
      }, 200, origin);
    } catch (error) {
      return response({ error: error instanceof Error ? error.message : "The SMS service is unavailable." }, 502, origin);
    }
  }

  if (action === "verify-otp") {
    const pending = await readToken<PendingOtp>(request, "pending");
    const retryAfter = checkRateLimit(verifyLimits, clientKey(request, pending?.phone || "unknown"), OTP_VERIFY_WINDOW_MS, OTP_MAX_VERIFY_ATTEMPTS);
    if (retryAfter) return response({ error: "Too many verification attempts. Please request a new OTP." }, 429, origin);
    const code = String(body.code || "").replace(/\D/g, "");
    if (!pending) return response({ error: "OTP expired" }, 410, origin);
    if (code.length !== 6 || !await verifyOtpDigest(pending, code)) return response({ error: "Invalid OTP. Please try again." }, 401, origin);
    return response({ user: { id: `phone:${pending.phone}`, phone: `+${pending.phone}` }, sessionToken: await createToken({ kind: "session", id: `phone:${pending.phone}`, phone: `+${pending.phone}`, expiresAt: Date.now() + CUSTOMER_SESSION_MAX_AGE_MS }) }, 200, origin);
  }

  if (action === "session") {
    const session = await readToken<CustomerSession>(request, "session");
    return response({ user: session ? { id: session.id, phone: session.phone } : null }, 200, origin);
  }

  if (action === "sign-out") return response({ signedOut: true }, 200, origin);
  return response({ error: "Not found" }, 404, origin);
};

Deno.serve(route);
