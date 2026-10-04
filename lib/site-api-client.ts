import { supabase } from "./supabase/client";

const externalSiteApiUrl = (process.env.NEXT_PUBLIC_SITE_API_URL ?? "").replace(/\/$/, "");
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

export const saveVendorSessionToken = (token: string) => {
  if (typeof window !== "undefined" && token) window.localStorage.setItem(vendorSessionKey, token);
};

export const clearVendorSessionToken = () => {
  if (typeof window !== "undefined") window.localStorage.removeItem(vendorSessionKey);
};

export const vendorApiFetch = (path: string, init: RequestInit = {}) => {
  const token = typeof window !== "undefined" ? window.localStorage.getItem(vendorSessionKey) || "" : "";
  return siteApiFetch(path, withBearer(init, token));
};

export const customerApiFetch = (path: string, init: RequestInit = {}) => {
  const token = typeof window !== "undefined" ? window.localStorage.getItem(customerSessionKey) || "" : "";
  return siteApiFetch(path, withBearer(init, token));
};

export const adminApiFetch = async (path: string, init: RequestInit = {}) => {
  const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token || "" : "";
  return siteApiFetch(path, withBearer(init, token));
};
