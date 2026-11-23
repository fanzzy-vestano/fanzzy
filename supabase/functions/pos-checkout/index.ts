// @ts-expect-error Deno Edge imports use explicit TypeScript file extensions.
import { createPosCheckout, posCheckoutResponse, readPosCheckout } from "../_shared/pos-checkout.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const origins = new Set(["https://fanzzy.in", "https://www.fanzzy.in"]);

async function isFanzzyAdmin(request: Request) {
  const bearer = request.headers.get("authorization") || "";
  const apiKey = request.headers.get("apikey") || "";
  const authUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  if (!authUrl || !apiKey || !/^Bearer [^\s]+$/i.test(bearer)) return false;

  try {
    const response = await fetch(`${authUrl}/auth/v1/user`, {
      headers: { apikey: apiKey, authorization: bearer },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const user = await response.json() as { email?: string; email_confirmed_at?: string };
    const adminEmail = (Deno.env.get("ADMIN_LOGIN_EMAIL") || "fanzzy@vestanoretail.com").trim().toLowerCase();
    return Boolean(user.email_confirmed_at && user.email?.trim().toLowerCase() === adminEmail);
  } catch {
    return false;
  }
}

async function checkoutRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "GET" && request.method !== "POST") {
    return posCheckoutResponse({ error: "Method not allowed." }, 405);
  }
  if (!await isFanzzyAdmin(request)) return posCheckoutResponse({ error: "Admin authentication required." }, 401);

  const keyId = Deno.env.get("RAZORPAY_KEY_ID")?.trim() || "";
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET")?.trim() || "";
  if (!keyId.startsWith("rzp_live_") || !keySecret) {
    return posCheckoutResponse({ error: "Razorpay Live Mode is not configured for POS." }, 503);
  }

  const credentials = { keyId, keySecret };
  return request.method === "POST" ? createPosCheckout(request, credentials) : readPosCheckout(request, credentials);
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !origins.has(origin)) return posCheckoutResponse({ error: "Origin not allowed." }, 403);

  const response = await checkoutRequest(request);
  const headers = new Headers(response.headers);
  headers.set("vary", "Origin");
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
    headers.set("access-control-allow-headers", "authorization, apikey, content-type, x-client-info");
  }
  return new Response(response.body, { status: response.status, headers });
});
