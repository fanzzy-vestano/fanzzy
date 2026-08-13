import { createHmac, timingSafeEqual } from "node:crypto";

export type CustomerSmsIdentity = { id: string; phone: string };

type PendingOtp = { phone: string; sessionId: string; expiresAt: number };
type SignedValue = CustomerSmsIdentity | PendingOtp;

const pendingCookie = "fanzzy_customer_otp";
const sessionCookie = "fanzzy_customer_session";
const isProduction = process.env.NODE_ENV === "production";

const secret = () => process.env.CUSTOMER_AUTH_SECRET || process.env.TWOFACTOR_API_KEY || "";
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

export const displayMobileNumber = (phone: string) => `+${phone}`;

export const createPendingOtpCookie = (phone: string, sessionId: string) =>
  cookie(pendingCookie, encode({ phone, sessionId, expiresAt: Date.now() + 10 * 60 * 1000 }), 10 * 60);

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
