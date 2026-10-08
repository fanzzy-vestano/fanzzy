import paymentWorker from "./razorpay-api";
import { createAdminSessionCookie } from "../lib/admin-auth";
import * as publicVendorsRoute from "../app/api/vendors/route";
import * as publicVendorRoute from "../app/api/vendors/[slug]/route";
import * as vendorLoginRoute from "../app/api/vendor-auth/login/route";
import * as vendorLogoutRoute from "../app/api/vendor-auth/logout/route";
import * as vendorSessionRoute from "../app/api/vendor-auth/session/route";
import * as vendorDashboardRoute from "../app/api/vendor/dashboard/route";
import * as vendorCategoriesRoute from "../app/api/vendor/categories/route";
import * as vendorProductsRoute from "../app/api/vendor/products/route";
import * as vendorProductRoute from "../app/api/vendor/products/[sku]/route";
import * as vendorOrdersRoute from "../app/api/vendor/orders/route";
import * as vendorOrderTrackingRoute from "../app/api/vendor/orders/[id]/tracking/route";
import * as vendorPayoutsRoute from "../app/api/vendor/payouts/route";
import * as adminVendorsRoute from "../app/api/admin/vendors/route";
import * as adminVendorRoute from "../app/api/admin/vendors/[id]/route";
import * as adminVendorProductsRoute from "../app/api/admin/vendors/[id]/products/route";
import * as adminVendorOrdersRoute from "../app/api/admin/vendors/[id]/orders/route";
import * as adminVendorProductRoute from "../app/api/admin/vendors/[id]/products/[sku]/route";
import * as adminVendorCommissionsRoute from "../app/api/admin/vendor-commissions/route";
import * as adminVendorPayoutsRoute from "../app/api/admin/vendor-payouts/route";
import * as adminVendorReportsRoute from "../app/api/admin/vendor-reports/route";
import * as adminDelhiveryConfigRoute from "../app/api/admin/delhivery/config/route";
import * as adminDelhiveryCreateRoute from "../app/api/admin/delhivery/create/route";
import * as confirmCodRoute from "../app/api/orders/confirm-cod/route";
import * as orderTrackingRoute from "../app/api/orders/track/route";
import * as delhiveryTrackingRoute from "../app/api/delhivery/track/route";
import * as restorePaymentRoute from "../app/api/razorpay/restore-order-details/route";
import * as syncPaymentsRoute from "../app/api/razorpay/sync-payments/route";

type WorkerEnv = {
  RAZORPAY_KEY_ID: string;
  RAZORPAY_KEY_SECRET: string;
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  ADMIN_LOGIN_EMAIL?: string;
  ADMIN_AUTH_SECRET?: string;
  AUTH_SECRET?: string;
  VENDOR_AUTH_SECRET?: string;
  VENDOR_DATA_ENCRYPTION_KEY?: string;
  CUSTOMER_AUTH_SECRET?: string;
  DELHIVERY_API_TOKEN?: string;
  DELHIVERY_CLIENT_NAME?: string;
  DELHIVERY_PICKUP_NAME?: string;
  DELHIVERY_PICKUP_LOCATION?: string;
  DELHIVERY_ORIGIN_PIN?: string;
  DELHIVERY_SELLER_NAME?: string;
  DELHIVERY_SELLER_ADDRESS?: string;
  DELHIVERY_SELLER_GST_TIN?: string;
  DELHIVERY_PICKUP_TIME?: string;
  DELHIVERY_DEFAULT_HSN_CODE?: string;
  DELHIVERY_DEFAULT_WEIGHT_GRAMS?: string;
  DELHIVERY_REQUIRE_ADMIN_WEIGHT?: string;
  DELHIVERY_DEFAULT_LENGTH_CM?: string;
  DELHIVERY_DEFAULT_WIDTH_CM?: string;
  DELHIVERY_DEFAULT_HEIGHT_CM?: string;
};

const allowedOrigins = new Set([
  "https://fanzzy.in",
  "https://www.fanzzy.in",
  "http://localhost:3000",
  "http://localhost:5173",
]);

const corsHeaders = (request: Request) => ({
  "access-control-allow-origin": allowedOrigins.has(request.headers.get("origin") || "")
    ? request.headers.get("origin") || "https://fanzzy.in"
    : "https://fanzzy.in",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-credentials": "true",
  "access-control-max-age": "86400",
  vary: "Origin",
});

const withCors = (request: Request, response: Response) => {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(request))) headers.set(name, value);
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

const json = (request: Request, body: Record<string, unknown>, status = 200) =>
  withCors(request, Response.json(body, { status }));

const methodHandler = (
  request: Request,
  route: Record<string, ((request: Request, context?: never) => Promise<Response>) | undefined>,
  context?: unknown,
) => {
  const handler = route[request.method];
  if (!handler) return Promise.resolve(Response.json({ error: "Method not allowed" }, { status: 405 }));
  return handler(request, context as never);
};

const supabaseUrl = (env: WorkerEnv) => (env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "https://pdrcrkxeyqxqgpwfxqpu.supabase.co").replace(/\/$/, "");
const supabasePublishableKey = (env: WorkerEnv) => env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_OTSfS6G2tlrAGINfyY3VGA_yi_3BPAV";

const authorizeAdmin = async (request: Request, env: WorkerEnv) => {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!token) return null;
  try {
    const response = await fetch(`${supabaseUrl(env)}/auth/v1/user`, {
      headers: { apikey: supabasePublishableKey(env), authorization: `Bearer ${token}` },
    });
    const user = await response.json() as { email?: string };
    const expectedEmail = (env.ADMIN_LOGIN_EMAIL || "fanzzy@vestanoretail.com").trim().toLowerCase();
    if (!response.ok || !user.email || user.email.trim().toLowerCase() !== expectedEmail) return null;
    const headers = new Headers(request.headers);
    headers.set("cookie", createAdminSessionCookie());
    return new Request(request, { headers });
  } catch {
    return null;
  }
};

const adminRoute = async (
  request: Request,
  env: WorkerEnv,
  route: Record<string, ((request: Request, context?: never) => Promise<Response>) | undefined>,
  context?: unknown,
) => {
  const verifiedRequest = await authorizeAdmin(request, env);
  if (!verifiedRequest) return Response.json({ error: "Admin authentication required." }, { status: 401 });
  return methodHandler(verifiedRequest, route, context);
};

const routeRequest = async (request: Request, env: WorkerEnv): Promise<Response> => {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const path = `/${segments.join("/")}`;

  if (path === "/" && request.method === "GET") return Response.json({ ok: true, service: "fanzzy-site-api" });

  if (["/order", "/verify", "/reserve-stock", "/release-stock", "/pos-qr"].includes(path)) {
    return paymentWorker.fetch(request, env);
  }

  if (path === "/vendors") return methodHandler(request, publicVendorsRoute);
  if (segments[0] === "vendors" && segments.length === 2) {
    return methodHandler(request, publicVendorRoute, { params: Promise.resolve({ slug: segments[1] }) });
  }

  if (path === "/vendor-auth/login") return methodHandler(request, vendorLoginRoute);
  if (path === "/vendor-auth/logout") return methodHandler(request, vendorLogoutRoute);
  if (path === "/vendor-auth/session") return methodHandler(request, vendorSessionRoute);
  if (path === "/vendor/dashboard") return methodHandler(request, vendorDashboardRoute);
  if (path === "/vendor/categories") return methodHandler(request, vendorCategoriesRoute);
  if (path === "/vendor/products") return methodHandler(request, vendorProductsRoute);
  if (segments[0] === "vendor" && segments[1] === "products" && segments.length === 3) {
    return methodHandler(request, vendorProductRoute, { params: Promise.resolve({ sku: segments[2] }) });
  }
  if (path === "/vendor/orders") return methodHandler(request, vendorOrdersRoute);
  if (segments[0] === "vendor" && segments[1] === "orders" && segments[3] === "tracking" && segments.length === 4) {
    return methodHandler(request, vendorOrderTrackingRoute, { params: Promise.resolve({ id: segments[2] }) });
  }
  if (path === "/vendor/payouts") return methodHandler(request, vendorPayoutsRoute);

  if (path === "/orders/confirm-cod") return methodHandler(request, confirmCodRoute);
  if (path === "/orders/track") return methodHandler(request, orderTrackingRoute);
  if (path === "/delhivery/track") return methodHandler(request, delhiveryTrackingRoute);

  if (path === "/razorpay/restore-order-details") {
    const verifiedRequest = await authorizeAdmin(request, env);
    return verifiedRequest
      ? methodHandler(verifiedRequest, restorePaymentRoute)
      : Response.json({ error: "Admin authentication required." }, { status: 401 });
  }
  if (path === "/razorpay/sync-payments") {
    return methodHandler(request, syncPaymentsRoute);
  }

  if (path === "/admin/vendors") return adminRoute(request, env, adminVendorsRoute);
  if (path === "/admin/vendor-commissions") return adminRoute(request, env, adminVendorCommissionsRoute);
  if (path === "/admin/vendor-payouts") return adminRoute(request, env, adminVendorPayoutsRoute);
  if (path === "/admin/vendor-reports") return adminRoute(request, env, adminVendorReportsRoute);
  if (path === "/admin/delhivery/config") return adminRoute(request, env, adminDelhiveryConfigRoute);
  if (path === "/admin/delhivery/create") return adminRoute(request, env, adminDelhiveryCreateRoute);
  if (segments[0] === "admin" && segments[1] === "vendors" && segments.length === 3) {
    return adminRoute(request, env, adminVendorRoute, { params: Promise.resolve({ id: segments[2] }) });
  }
  if (segments[0] === "admin" && segments[1] === "vendors" && segments[3] === "products" && segments.length === 4) {
    return adminRoute(request, env, adminVendorProductsRoute, { params: Promise.resolve({ id: segments[2] }) });
  }
  if (segments[0] === "admin" && segments[1] === "vendors" && segments[3] === "orders" && segments.length === 4) {
    return adminRoute(request, env, adminVendorOrdersRoute, { params: Promise.resolve({ id: segments[2] }) });
  }
  if (segments[0] === "admin" && segments[1] === "vendors" && segments[3] === "products" && segments.length === 5) {
    return adminRoute(request, env, adminVendorProductRoute, { params: Promise.resolve({ id: segments[2], sku: segments[4] }) });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
};

export default {
  async fetch(request: Request, env: WorkerEnv) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    try {
      return withCors(request, await routeRequest(request, env));
    } catch (error) {
      return json(request, { error: error instanceof Error ? error.message : "The Fanzzy API is temporarily unavailable." }, 500);
    }
  },
};
