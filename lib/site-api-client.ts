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

export const adminApiFetch = async (path: string, init: RequestInit = {}) => {
  const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token || "" : "";
  return siteApiFetch(path, withBearer(init, token));
};
