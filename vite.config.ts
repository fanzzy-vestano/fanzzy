import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const defaultCustomerAuthApiUrl = "https://pdrcrkxeyqxqgpwfxqpu.supabase.co/functions/v1/customer-auth";
const defaultRazorpayApiUrl = "https://fanzzy-razorpay-api.fanzzy.workers.dev";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command }) => {
  // Sites runs Vite's build command without setting GITHUB_PAGES. Use the
  // deployed payment worker for every production bundle, but retain local API
  // routes while running the development server.
  const usesExternalPaymentApi = process.env.GITHUB_PAGES === "true" || command === "build";
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    define: {
      "process.env.NEXT_PUBLIC_STATIC_ADMIN_EMAIL": JSON.stringify(
        process.env.GITHUB_PAGES === "true" ? process.env.ADMIN_LOGIN_EMAIL?.trim() ?? "" : "",
      ),
      "process.env.NEXT_PUBLIC_STATIC_ADMIN_PASSWORD": JSON.stringify(
        process.env.GITHUB_PAGES === "true" ? process.env.ADMIN_LOGIN_PASSWORD ?? "" : "",
      ),
      "process.env.NEXT_PUBLIC_CUSTOMER_AUTH_API_URL": JSON.stringify(
        process.env.GITHUB_PAGES === "true"
          ? process.env.CUSTOMER_AUTH_API_URL?.trim() || defaultCustomerAuthApiUrl
          : "",
      ),
      "process.env.NEXT_PUBLIC_RAZORPAY_API_URL": JSON.stringify(
        usesExternalPaymentApi ? process.env.RAZORPAY_API_URL?.trim() || defaultRazorpayApiUrl : "",
      ),
    },
    // The local preview can serve HTTP through a browser proxy that does not
    // keep Vite's HMR WebSocket open. Forwarding browser errors over that
    // socket then masks the actual storefront with a secondary `send` error.
    // HMR itself remains available where the socket is supported.
    server: {
      forwardConsole: false,
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
