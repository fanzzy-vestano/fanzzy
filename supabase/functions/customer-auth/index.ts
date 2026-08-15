declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const TWO_FACTOR_BASE_URL = "https://2factor.in/API/V1";
const TWO_FACTOR_SMS_TEMPLATE = "Fanzzy Login SMS OTP";
const OTP_EXPIRES_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_WINDOW_MS = 15 * 60 * 1000;
const OTP_MAX_REQUESTS = 5;
const OTP_VERIFY_WINDOW_MS = 10 * 60 * 1000;
const OTP_MAX_VERIFY_ATTEMPTS = 8;

type PendingOtp = { kind: "pending"; phone: string; code: string; expiresAt: number };
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

const secretKey = async () => crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(Deno.env.get("CUSTOMER_AUTH_SECRET") || Deno.env.get("TWO_FACTOR_API_KEY") || ""),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"],
);

const createToken = async (payload: TokenPayload) => {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign("HMAC", await secretKey(), new TextEncoder().encode(encoded));
  return `${encoded}.${base64UrlEncode(new Uint8Array(signature))}`;
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

const sendOtp = async (phone: string) => {
  const apiKey = Deno.env.get("TWO_FACTOR_API_KEY")?.trim() || "";
  if (!apiKey) throw new Error("SMS provider is not configured.");
  const code = String(Math.floor(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  const providerResponse = await fetch(`${TWO_FACTOR_BASE_URL}/${encodeURIComponent(apiKey)}/ADDON_SERVICES/SEND/TSMS`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ From: "FANZZY", To: phone, TemplateName: TWO_FACTOR_SMS_TEMPLATE, VAR1: code }),
  });
  const providerResult = await providerResponse.json() as { Status?: string; Details?: string; StatusCode?: string };
  if (!providerResponse.ok || String(providerResult.Status || "").toLowerCase() !== "success") {
    throw new Error(providerResult.Details || "The SMS provider could not send the code.");
  }
  return { code, details: providerResult.Details || "sent" };
};

const sendVoiceOtp = async (phone: string) => {
  const apiKey = Deno.env.get("TWO_FACTOR_API_KEY")?.trim() || "";
  if (!apiKey) throw new Error("Voice OTP provider is not configured.");
  const code = String(Math.floor(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  const providerResponse = await fetch(`${TWO_FACTOR_BASE_URL}/${encodeURIComponent(apiKey)}/VOICE/${encodeURIComponent(phone)}/${code}`, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  const providerResult = await providerResponse.json() as { Status?: string; Details?: string };
  if (!providerResponse.ok || String(providerResult.Status || "").toLowerCase() !== "success") {
    throw new Error(providerResult.Details || "The voice OTP provider could not start the call.");
  }
  return { code, details: providerResult.Details || "started" };
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
      const { code } = await sendOtp(phone);
      return response({ sent: true, pendingToken: await createToken({ kind: "pending", phone, code, expiresAt: Date.now() + OTP_EXPIRES_MS }) }, 200, origin);
    } catch (error) {
      return response({ error: error instanceof Error ? error.message : "The SMS service is unavailable." }, 502, origin);
    }
  }

  if (action === "send-voice-otp") {
    const phone = normalizeMobileNumber(body.phone);
    if (!phone) return response({ error: "Enter a valid 10-digit Indian mobile number" }, 400, origin);
    const retryAfter = checkRateLimit(sendLimits, clientKey(request, phone), OTP_WINDOW_MS, OTP_MAX_REQUESTS, OTP_RESEND_COOLDOWN_MS);
    if (retryAfter) return response({ error: `Please wait ${retryAfter} seconds before requesting another OTP.` }, 429, origin);
    try {
      const { code } = await sendVoiceOtp(phone);
      return response({ sent: true, pendingToken: await createToken({ kind: "pending", phone, code, expiresAt: Date.now() + OTP_EXPIRES_MS }) }, 200, origin);
    } catch (error) {
      return response({ error: error instanceof Error ? error.message : "The voice OTP service is unavailable." }, 502, origin);
    }
  }

  if (action === "verify-otp") {
    const pending = await readToken<PendingOtp>(request, "pending");
    const retryAfter = checkRateLimit(verifyLimits, clientKey(request, pending?.phone || "unknown"), OTP_VERIFY_WINDOW_MS, OTP_MAX_VERIFY_ATTEMPTS);
    if (retryAfter) return response({ error: "Too many verification attempts. Please request a new OTP." }, 429, origin);
    const code = String(body.code || "").replace(/\D/g, "");
    if (!pending) return response({ error: "OTP expired" }, 410, origin);
    if (code.length !== 6 || code !== pending.code) return response({ error: "Invalid OTP. Please try again." }, 401, origin);
    return response({ user: { id: `phone:${pending.phone}`, phone: `+${pending.phone}` }, sessionToken: await createToken({ kind: "session", id: `phone:${pending.phone}`, phone: `+${pending.phone}`, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 }) }, 200, origin);
  }

  if (action === "session") {
    const session = await readToken<CustomerSession>(request, "session");
    return response({ user: session ? { id: session.id, phone: session.phone } : null }, 200, origin);
  }

  if (action === "sign-out") return response({ signedOut: true }, 200, origin);
  return response({ error: "Not found" }, 404, origin);
};

Deno.serve(route);
