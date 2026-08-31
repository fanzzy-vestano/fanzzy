// @ts-expect-error Deno Edge imports use explicit TypeScript file extensions.
import { md5 } from "./md5.ts";

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
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_WINDOW_MS = 15 * 60 * 1000;
const OTP_MAX_REQUESTS = 5;
const OTP_VERIFY_WINDOW_MS = 10 * 60 * 1000;
const OTP_MAX_VERIFY_ATTEMPTS = 8;
// Keep the external session valid across browser restarts until the customer signs out.
const CUSTOMER_SESSION_MAX_AGE_MS = 3650 * 24 * 60 * 60 * 1000;

type PendingOtp = { kind: "pending"; phone: string; otpDigest: string; expiresAt: number };
type CustomerSession = { kind: "session"; id: string; phone: string; expiresAt: number };
type TokenPayload = PendingOtp | CustomerSession;
type RateEntry = { windowStartedAt: number; requestCount: number; lastRequestedAt: number };

const sendLimits = new Map<string, RateEntry>();
const verifyLimits = new Map<string, RateEntry>();
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
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return "";
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
  if (request.method === "GET") return response({ ok: true, service: "customer-auth" }, 200, origin);
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405, origin);

  const action = new URL(request.url).pathname.split("/").filter(Boolean).at(-1) || "";
  let body: { phone?: unknown; code?: unknown } = {};
  try { body = await request.json() as typeof body; } catch { /* handled below */ }

  if (action === "send-otp") {
    const phone = normalizeMobileNumber(body.phone);
    if (!phone) return response({ error: "Enter a valid 10-digit Indian mobile number" }, 400, origin);
    const retryAfter = checkRateLimit(sendLimits, clientKey(request, phone), OTP_WINDOW_MS, OTP_MAX_REQUESTS, OTP_RESEND_COOLDOWN_MS);
    if (retryAfter) return response({ error: `Please wait ${retryAfter} seconds before requesting another OTP.` }, 429, origin);
    try {
      const code = await sendOtp(phone);
      const expiresAt = Date.now() + OTP_EXPIRES_MS;
      const otpDigest = await createOtpDigest(phone, code, expiresAt);
      return response({ sent: true, channel: "sms", pendingToken: await createToken({ kind: "pending", phone, otpDigest, expiresAt }) }, 200, origin);
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
