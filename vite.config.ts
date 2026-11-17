import vinext from "vinext";
import { defineConfig } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const defaultCustomerAuthApiUrl = "https://pdrcrkxeyqxqgpwfxqpu.supabase.co/functions/v1/customer-auth";
const defaultRazorpayApiUrl = "https://fanzzy-razorpay-api.fanzzy.workers.dev";
const defaultSiteApiUrl = "https://fanzzy-razorpay-api.fanzzy.workers.dev";
const runtimeBindingKeys = [
  "FANZZY_ENV", "NEXT_PUBLIC_FANZZY_ENV", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET", "DELHIVERY_MODE", "DELHIVERY_API_BASE_URL", "DELHIVERY_API_TOKEN",
  "DELHIVERY_CLIENT_NAME", "DELHIVERY_PICKUP_LOCATION", "DELHIVERY_ORIGIN_PIN", "DELHIVERY_SELLER_NAME",
  "DELHIVERY_SELLER_ADDRESS", "DELHIVERY_SELLER_GST_TIN", "DELHIVERY_PICKUP_TIME", "DELHIVERY_REQUIRE_ADMIN_WEIGHT",
  "DELHIVERY_DEFAULT_HSN_CODE", "DELHIVERY_DEFAULT_WEIGHT_GRAMS", "DELHIVERY_DEFAULT_LENGTH_CM",
  "DELHIVERY_DEFAULT_WIDTH_CM", "DELHIVERY_DEFAULT_HEIGHT_CM", "LOCAL_TEST_OTP_CODE", "CUSTOMER_AUTH_SECRET",
  "ADMIN_AUTH_SECRET", "ADMIN_LOGIN_EMAIL", "ADMIN_LOGIN_PASSWORD", "VENDOR_AUTH_SECRET", "VENDOR_DATA_ENCRYPTION_KEY",
  "D1_CLIENT_ID", "D1_CLIENT_SECRET", "D1_AUTH_URL", "D1_REALM", "D1_CLIENT_CMS", "D1_MCP_URL", "DELHIVERY_PICKUP_NAME",
] as const;

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat", "nodejs_compat_populate_process_env"],
  d1_databases: [],
  r2_buckets: [],
  vars: Object.fromEntries(runtimeBindingKeys.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]])),
};

export default defineConfig(async ({ command }) => {
  const isLocalTest = process.env.FANZZY_ENV === "local-test";
  const localDatabasePort = Number(process.env.FANZZY_LOCAL_DATABASE_PORT || "54321");
  // Sites runs Vite's build command without setting GITHUB_PAGES. Use the
  // deployed payment worker for every production bundle, but retain local API
  // routes while running the development server.
  const usesExternalPaymentApi = !isLocalTest && (process.env.GITHUB_PAGES === "true" || command === "build");
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    define: {
      // GitHub Pages is a public static host. Admin authentication there must
      // use Supabase's browser session, never a password embedded in the app.
      "process.env.NEXT_PUBLIC_STATIC_BUILD": JSON.stringify(process.env.GITHUB_PAGES === "true"),
      "process.env.NEXT_PUBLIC_FANZZY_ENV": JSON.stringify(isLocalTest ? "local-test" : process.env.NEXT_PUBLIC_FANZZY_ENV || ""),
      "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL || ""),
      "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ""),
      "process.env.NEXT_PUBLIC_CUSTOMER_AUTH_API_URL": JSON.stringify(
        !isLocalTest && process.env.GITHUB_PAGES === "true"
          ? process.env.CUSTOMER_AUTH_API_URL?.trim() || defaultCustomerAuthApiUrl
          : "",
      ),
      "process.env.NEXT_PUBLIC_RAZORPAY_API_URL": JSON.stringify(
        usesExternalPaymentApi ? process.env.RAZORPAY_API_URL?.trim() || defaultRazorpayApiUrl : "",
      ),
      "process.env.NEXT_PUBLIC_SITE_API_URL": JSON.stringify(
        !isLocalTest && process.env.GITHUB_PAGES === "true"
          ? process.env.SITE_API_URL?.trim() || defaultSiteApiUrl
          : "",
      ),
    },
    // The local preview can serve HTTP through a browser proxy that does not
    // keep Vite's HMR WebSocket open. Forwarding browser errors over that
    // socket then masks the actual storefront with a secondary `send` error.
    // HMR itself remains available where the socket is supported.
    server: {
      forwardConsole: false,
      ...(isLocalTest && process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http:") ? { proxy: { "/local-db": { target: `http://127.0.0.1:${localDatabasePort}`, changeOrigin: false, rewrite: (path: string) => path.replace(/^\/local-db/, ""), ws: false } } } : {}),
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        ...(isLocalTest ? { persistState: false } : {}),
        config: localBindingConfig,
      }),
    ],
  };
});
