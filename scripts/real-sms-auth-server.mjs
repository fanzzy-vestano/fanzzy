import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const PORT = Number(process.env.PORT || 3000);
const OTP_EXPIRES_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const SANGAMAM_SMS_ENDPOINT = "https://fastsms.sangamamonline.in/api/sms/v1.0/send-sms";
const SANGAMAM_SMS_REQUEST_FOR = "send-sms";
const SANGAMAM_SMS_SIGNATURE_NAMESPACE = "sms@rits-v1.0";
const SANGAMAM_SMS_TIMEOUT_MS = 15_000;
const pendingCookie = "fanzzy_customer_otp";
const sessionCookie = "fanzzy_customer_session";
const sendCooldowns = new Map();

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const env = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsAt = line.indexOf("=");
    if (equalsAt <= 0) continue;
    const key = line.slice(0, equalsAt).trim();
    let value = line.slice(equalsAt + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

Object.assign(process.env, parseEnvFile(resolve(".env.local")));

const json = (response, status, body, headers = {}) => {
  response.writeHead(status, {
    "access-control-allow-origin": "http://localhost:8081",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "cache-control": "no-store",
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
};

const readBody = async (request) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
};

const base64Url = (value) => Buffer.from(value, "utf8").toString("base64url");
const fromBase64Url = (value) => Buffer.from(value, "base64url").toString("utf8");
const secret = () => process.env.CUSTOMER_AUTH_SECRET?.trim() || "";
const sign = (payload) => createHmac("sha256", secret()).update(payload).digest("base64url");
const encode = (value) => {
  const payload = base64Url(JSON.stringify(value));
  return `${payload}.${sign(payload)}`;
};
const decode = (value) => {
  if (!value || !secret()) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    return JSON.parse(fromBase64Url(payload));
  } catch {
    return null;
  }
};

const hashOtp = ({ phone, code, expiresAt }) =>
  createHmac("sha256", secret()).update(`otp:${phone}:${expiresAt}:${code}`).digest("base64url");

const normalizeMobileNumber = (value) => {
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return "";
};

const getCookie = (request, name) => request.headers.cookie
  ?.split(";")
  .map((part) => part.trim().split("="))
  .find(([key]) => key === name)?.slice(1).join("=");

const getBearerToken = (request) =>
  request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";

const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
const clearCookie = (name) => cookie(name, "", 0);
const displayMobileNumber = (phone) => `+${phone}`;
const createPendingOtpToken = (pending) =>
  encode({ phone: pending.phone, codeHash: hashOtp(pending), expiresAt: pending.expiresAt });
const createSessionToken = (phone) => encode({ id: `phone:${phone}`, phone: displayMobileNumber(phone) });

const getPendingOtp = (request) => {
  const pending = decode(getBearerToken(request) || getCookie(request, pendingCookie));
  return pending && pending.expiresAt > Date.now() ? pending : null;
};

const getSession = (request) => {
  const session = decode(getBearerToken(request) || getCookie(request, sessionCookie));
  return session?.id && session?.phone ? { id: session.id, phone: session.phone } : null;
};

const md5 = (value) => createHash("md5").update(value).digest("hex");
const createAuthSignature = (accessToken, accessTokenKey, expire) => {
  const timeKey = md5(`${SANGAMAM_SMS_REQUEST_FOR}${SANGAMAM_SMS_SIGNATURE_NAMESPACE}${expire}`);
  const timeAccessTokenKey = md5(`${accessToken}${timeKey}`);
  return md5(`${timeAccessTokenKey}${accessTokenKey}`);
};
const localIndianNumber = (phone) => phone.startsWith("91") ? phone.slice(2) : phone;

async function sendSangamamOtp(phone, code) {
  const accessToken = process.env.SANGAMAM_SMS_ACCESS_TOKEN?.trim() || "";
  const accessTokenKey = process.env.SANGAMAM_SMS_ACCESS_TOKEN_KEY?.trim() || "";
  if (!accessToken || !accessTokenKey) throw new Error("Sangamam FastSMS login is not configured.");

  const expire = Math.floor(Date.now() / 1000) + 60;
  const response = await fetch(SANGAMAM_SMS_ENDPOINT, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      accessToken,
      expire,
      authSignature: createAuthSignature(accessToken, accessTokenKey, expire),
      route: "transactional",
      smsHeader: process.env.SANGAMAM_SMS_HEADER?.trim() || "FANZZY",
      messageContent: `${code} is your OTP to verify phone number at Fanzzy. Please do not share OTP with anyone.`,
      recipients: [localIndianNumber(phone)],
      contentType: "text",
      entityId: process.env.SANGAMAM_SMS_ENTITY_ID?.trim() || "1201178763981946340",
      templateId: process.env.SANGAMAM_SMS_TEMPLATE_ID?.trim() || "1277178790132462995",
      removeDuplicateNumbers: 1,
    }),
    signal: AbortSignal.timeout(SANGAMAM_SMS_TIMEOUT_MS),
  });

  const raw = await response.text();
  let result = {};
  try {
    result = JSON.parse(raw);
  } catch {
    throw new Error("Sangamam FastSMS returned an invalid response.");
  }

  const status = String(result.status || "").trim().toLowerCase();
  const providerStatus = Number(result.httpStatusCode || response.status);
  if (!response.ok || status !== "success" || providerStatus !== 200) {
    throw new Error(String(result.message || "Sangamam FastSMS could not send the SMS code."));
  }
}

async function handleSendOtp(request, response) {
  const { phone: rawPhone } = await readBody(request);
  const phone = normalizeMobileNumber(rawPhone);
  if (!phone) return json(response, 400, { error: "Enter a valid 10-digit Indian mobile number" });
  const lastSentAt = sendCooldowns.get(phone) || 0;
  const retryAfter = OTP_RESEND_COOLDOWN_SECONDS - Math.floor((Date.now() - lastSentAt) / 1000);
  if (retryAfter > 0) return json(response, 429, { error: `Please wait ${retryAfter} seconds before requesting another OTP.` }, { "retry-after": String(retryAfter) });

  const code = String(randomInt(100000, 1_000_000));
  await sendSangamamOtp(phone, code);
  sendCooldowns.set(phone, Date.now());
  const pending = { phone, code, expiresAt: Date.now() + OTP_EXPIRES_MS };
  const pendingToken = createPendingOtpToken(pending);
  console.info("otp.provider.send", { provider: "Sangamam FastSMS", channel: "SMS", status: "success" });
  return json(response, 200, { sent: true, channel: "sms", pendingToken }, {
    "set-cookie": cookie(pendingCookie, pendingToken, Math.ceil(OTP_EXPIRES_MS / 1000)),
  });
}

async function handleVerifyOtp(request, response) {
  const pending = getPendingOtp(request);
  if (!pending) return json(response, 410, { error: "OTP expired" });
  const { code: rawCode } = await readBody(request);
  const code = String(rawCode || "").replace(/\D/g, "");
  if (code.length !== 6) return json(response, 400, { error: "Enter the SMS code" });
  const expected = Buffer.from(hashOtp({ phone: pending.phone, code, expiresAt: pending.expiresAt }));
  const received = Buffer.from(pending.codeHash || "");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return json(response, 401, { error: "Invalid OTP. Please try again." });
  }

  const sessionToken = createSessionToken(pending.phone);
  return json(response, 200, {
    user: { id: `phone:${pending.phone}`, phone: displayMobileNumber(pending.phone) },
    sessionToken,
  }, {
    "set-cookie": [cookie(sessionCookie, sessionToken, 60 * 60 * 24 * 3650), clearCookie(pendingCookie)],
  });
}

createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") return json(response, 204, {});
    const path = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).pathname;
    if (path === "/api/customer-auth/session" && request.method === "GET") return json(response, 200, { user: getSession(request) });
    if (path === "/api/customer-auth/sign-out" && request.method === "POST") {
      return json(response, 200, { signedOut: true }, { "set-cookie": [clearCookie(sessionCookie), clearCookie(pendingCookie)] });
    }
    if (path === "/api/customer-auth/send-otp" && request.method === "POST") return await handleSendOtp(request, response);
    if (path === "/api/customer-auth/verify-otp" && request.method === "POST") return await handleVerifyOtp(request, response);
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    return json(response, 502, { error: error instanceof Error ? error.message : "SMS OTP service could not be reached." });
  }
}).listen(PORT, () => {
  console.log(`Real SMS auth API listening on http://localhost:${PORT}`);
});
