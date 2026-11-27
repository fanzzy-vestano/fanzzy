import { browserLocalStorage, prepareBrowserStorage, flushBrowserStorage } from "./browser-storage";
import { supabase } from "./supabase/client";

const externalSiteApiUrl = (process.env.NEXT_PUBLIC_SITE_API_URL ?? "").replace(/\/$/, "");
export const usesExternalSiteApi = Boolean(externalSiteApiUrl);
const vendorSessionKey = "fanzzy-vendor-session-token";
const customerSessionKey = "fanzzy-customer-session-token";

export const siteApiUrl = (path: string) => {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return externalSiteApiUrl ? `${externalSiteApiUrl}${normalized}` : `/api${normalized}`;
};

const withBearer = (init: RequestInit, token: string) => {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return { ...init, headers };
};

export const siteApiFetch = (path: string, init: RequestInit = {}) => fetch(siteApiUrl(path), init);

export const saveVendorSessionToken = async (token: string) => {
  if (typeof window !== "undefined" && token) browserLocalStorage.setItem(vendorSessionKey, token);
  await flushBrowserStorage();
};

export const clearVendorSessionToken = async () => {
  if (typeof window !== "undefined") browserLocalStorage.removeItem(vendorSessionKey);
  await flushBrowserStorage();
};

export const vendorApiFetch = async (path: string, init: RequestInit = {}) => {
  await prepareBrowserStorage();
  const token = typeof window !== "undefined" ? browserLocalStorage.getItem(vendorSessionKey) || "" : "";
  return siteApiFetch(path, withBearer(init, token));
};

export const customerApiFetch = async (path: string, init: RequestInit = {}) => {
  await prepareBrowserStorage();
  const token = typeof window !== "undefined" ? browserLocalStorage.getItem(customerSessionKey) || "" : "";
  return siteApiFetch(path, withBearer(init, token));
};

// Payments can use a different API base from the rest of the storefront.
// Carry the same signed customer identity to either configured backend.
export const customerAuthorizedFetch = (url: string, init: RequestInit = {}) => {
  const token = typeof window !== "undefined" ? window.localStorage.getItem(customerSessionKey) || "" : "";
  return fetch(url, { ...withBearer(init, token), credentials: "include" });
};

export const adminApiFetch = async (path: string, init: RequestInit = {}) => {
  const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token || "" : "";
  const firstResponse = await siteApiFetch(path, withBearer(init, token));
  const method = (init.method || "GET").toUpperCase();

  // An open admin tab can retain an expired Supabase access token while the
  // browser still has a refresh token. Recover one failed read in place so the
  // dashboard cannot silently fall back to an older locally saved order list.
  // Writes intentionally keep their existing one-request behavior.
  if (firstResponse.status !== 401 || method !== "GET" || !supabase) return firstResponse;

  try {
    const { data, error } = await supabase.auth.refreshSession();
    const refreshedToken = error ? "" : data.session?.access_token || "";
    if (!refreshedToken || refreshedToken === token) return firstResponse;
    return siteApiFetch(path, withBearer(init, refreshedToken));
  } catch {
    return firstResponse;
  }
};
