type CustomerAuthRequestInit = RequestInit & { tokenType?: "pending" | "session" };
export type CustomerAuthUser = { id: string; phone: string };

const externalCustomerAuthUrl = (process.env.NEXT_PUBLIC_CUSTOMER_AUTH_API_URL ?? "").replace(/\/$/, "");
const pendingTokenKey = "fanzzy-customer-pending-token";
const sessionTokenKey = "fanzzy-customer-session-token";

const readToken = (type: "pending" | "session") => {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(type === "pending" ? pendingTokenKey : sessionTokenKey) || "";
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

export const readStoredCustomerAuthUser = () => readSessionPayload();

export const isExternalCustomerAuth = Boolean(externalCustomerAuthUrl);

export const customerAuthRequest = (path: string, init: CustomerAuthRequestInit = {}) => {
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

export const saveCustomerAuthTokens = (tokens: { pendingToken?: string; sessionToken?: string }) => {
  if (typeof window === "undefined") return;
  if (tokens.pendingToken) window.localStorage.setItem(pendingTokenKey, tokens.pendingToken);
  if (tokens.sessionToken) window.localStorage.setItem(sessionTokenKey, tokens.sessionToken);
};

export const clearCustomerAuthTokens = () => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(pendingTokenKey);
  window.localStorage.removeItem(sessionTokenKey);
};

export const clearPendingCustomerAuthToken = () => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(pendingTokenKey);
};
