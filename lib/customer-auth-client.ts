import { browserLocalStorage, prepareBrowserStorage, flushBrowserStorage } from "./browser-storage";
type CustomerAuthRequestInit = RequestInit & { tokenType?: "pending" | "session" };
export type CustomerAuthUser = { id: string; phone: string };

const externalCustomerAuthUrl = (process.env.NEXT_PUBLIC_CUSTOMER_AUTH_API_URL ?? "").replace(/\/$/, "");
const pendingTokenKey = "fanzzy-customer-pending-token";
const sessionTokenKey = "fanzzy-customer-session-token";
const rememberedUserKey = "fanzzy-customer-remembered-user";

const readToken = (type: "pending" | "session") => {
  if (typeof window === "undefined") return "";
  return browserLocalStorage.getItem(type === "pending" ? pendingTokenKey : sessionTokenKey) || "";
};

const readSessionPayload = (): CustomerAuthUser | null => {
  const token = readToken("session");
  if (!token || typeof window === "undefined") return null;
  try {
    const encoded = token.split(".")[0];
    if (!encoded) return null;
    const binary = window.atob(encoded.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((encoded.length + 3) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { kind?: string; id?: string; phone?: string; expiresAt?: number };
    if (payload.kind !== "session" || !payload.id || !payload.phone || typeof payload.expiresAt !== "number" || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return null;
    return { id: payload.id, phone: payload.phone };
  } catch {
    return null;
  }
};

const readRememberedUser = (): CustomerAuthUser | null => {
  if (typeof window === "undefined") return null;
  try {
    const stored = JSON.parse(browserLocalStorage.getItem(rememberedUserKey) || "null") as Partial<CustomerAuthUser> | null;
    if (!stored || typeof stored.id !== "string" || !stored.id || typeof stored.phone !== "string" || !stored.phone) return null;
    return { id: stored.id, phone: stored.phone };
  } catch {
    return null;
  }
};

export const readStoredCustomerAuthUser = () => readSessionPayload() || readRememberedUser();

export const isExternalCustomerAuth = Boolean(externalCustomerAuthUrl);

export const customerAuthRequest = async (path: string, init: CustomerAuthRequestInit = {}) => {
  await prepareBrowserStorage();
  const { tokenType, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  const token = readToken(tokenType || (path === "verify-otp" ? "pending" : "session"));
  if (token) headers.set("authorization", `Bearer ${token}`);
  const url = externalCustomerAuthUrl
    ? `${externalCustomerAuthUrl}/${path}`
    : `/api/customer-auth/${path}`;
  return fetch(url, {
    ...requestInit,
    headers,
    credentials: "include",
  });
};

export const saveCustomerAuthTokens = async (tokens: { pendingToken?: string; sessionToken?: string }) => {
  if (typeof window === "undefined") return;
  if (tokens.pendingToken) browserLocalStorage.setItem(pendingTokenKey, tokens.pendingToken);
  if (tokens.sessionToken) browserLocalStorage.setItem(sessionTokenKey, tokens.sessionToken);
  await flushBrowserStorage();
};

export const saveCustomerAuthUser = async (user: CustomerAuthUser) => {
  if (typeof window === "undefined") return;
  browserLocalStorage.setItem(rememberedUserKey, JSON.stringify({ id: user.id, phone: user.phone }));
  await flushBrowserStorage();
};

export const clearCustomerAuthTokens = async () => {
  if (typeof window === "undefined") return;
  browserLocalStorage.removeItem(pendingTokenKey);
  browserLocalStorage.removeItem(sessionTokenKey);
  browserLocalStorage.removeItem(rememberedUserKey);
  await flushBrowserStorage();
};

export const clearPendingCustomerAuthToken = async () => {
  if (typeof window === "undefined") return;
  browserLocalStorage.removeItem(pendingTokenKey);
  await flushBrowserStorage();
};
