import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const productionProjectRef = "pdrcrkxeyqxqgpwfxqpu";
const passThroughEnvNames = new Set([
  "APPDATA",
  "CI",
  "COMSPEC",
  "HOME",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "Path",
  "SystemRoot",
  "TEMP",
  "TERM",
  "TMP",
  "USERPROFILE",
  "WINDIR",
]);

export function parseEnvFile(content) {
  const env = {};
  const errors = [];
  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsAt = line.indexOf("=");
    if (equalsAt <= 0) {
      errors.push(`Invalid .env.local.test entry on line ${index + 1}.`);
      continue;
    }
    const key = line.slice(0, equalsAt).trim();
    let value = line.slice(equalsAt + 1).trim();
    if (!/^[A-Z0-9_]+$/i.test(key)) {
      errors.push(`Invalid .env.local.test key on line ${index + 1}.`);
      continue;
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return { env, errors };
}

export function buildSanitizedLocalTestEnv(fileEnv, inheritedEnv = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (passThroughEnvNames.has(key) || key.startsWith("npm_")) {
      env[key] = value;
    }
  }
  Object.assign(env, fileEnv);
  // Vinext binds its local preview to `localhost`. Keep the browser Supabase
  // client on that same origin so its `/local-db` request uses Vite's proxy;
  // some Windows hosts do not expose the localhost listener through 127.0.0.1.
  try {
    const localDatabaseUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL || "");
    if (localDatabaseUrl.protocol === "http:" && localDatabaseUrl.hostname === "127.0.0.1" && localDatabaseUrl.pathname === "/local-db") {
      localDatabaseUrl.hostname = "localhost";
      env.NEXT_PUBLIC_SUPABASE_URL = localDatabaseUrl.toString().replace(/\/$/, "");
    }
  } catch {
    // Validation below reports a clear configuration error for an invalid URL.
  }
  env.FANZZY_ENV = "local-test";
  env.NEXT_PUBLIC_FANZZY_ENV = "local-test";
  env.DELHIVERY_MODE = fileEnv.DELHIVERY_MODE || "mock";
  if (env.DELHIVERY_MODE === "mock") {
    for (const key of Object.keys(env)) {
      if (key.startsWith("D1_")) delete env[key];
    }
  }
  env.SUPABASE_URL = fileEnv.NEXT_PUBLIC_SUPABASE_URL || "";
  env.SUPABASE_PUBLISHABLE_KEY = fileEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
  env.NEXT_PUBLIC_SITE_API_URL = "";
  env.NEXT_PUBLIC_RAZORPAY_API_URL = "";
  env.NEXT_PUBLIC_CUSTOMER_AUTH_API_URL = "";
  env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
  env.CLOUDFLARE_INCLUDE_PROCESS_ENV = "false";
  return env;
}

export function validateLocalTestEnv(env) {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || "";
  const razorpayKeyId = env.RAZORPAY_KEY_ID || "";
  const delhiveryMode = env.DELHIVERY_MODE || "mock";
  const errors = [];
  const localDatabase = (() => { try { const url = new URL(supabaseUrl); return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) && Boolean(url.port) && url.pathname === "/local-db" && !url.username && !url.password && !url.search && !url.hash; } catch { return false; } })();
  if (!localDatabase && !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/i.test(supabaseUrl)) errors.push("NEXT_PUBLIC_SUPABASE_URL must be a Supabase test project or loopback /local-db URL.");
  if (supabaseUrl.includes(productionProjectRef)) errors.push("NEXT_PUBLIC_SUPABASE_URL points to the production Fanzzy project.");
  if (!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) errors.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing.");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) errors.push("SUPABASE_SERVICE_ROLE_KEY is missing.");
  if (!razorpayKeyId.startsWith("rzp_test_")) errors.push("RAZORPAY_KEY_ID must start with rzp_test_.");
  if (!env.RAZORPAY_KEY_SECRET) errors.push("RAZORPAY_KEY_SECRET is missing.");
  if (!new Set(["mock", "staging"]).has(delhiveryMode)) errors.push("DELHIVERY_MODE must be mock or staging.");
  if ((env.DELHIVERY_API_BASE_URL || "").includes("track.delhivery.com")) errors.push("Production Delhivery is forbidden in local-test.");
  if (!env.CUSTOMER_AUTH_SECRET) errors.push("CUSTOMER_AUTH_SECRET is missing.");
  if (!env.LOCAL_TEST_OTP_CODE?.match(/^\d{6}$/)) errors.push("LOCAL_TEST_OTP_CODE must contain exactly six digits.");
  return errors;
}

export function loadSanitizedEnv(envFilePath, inheritedEnv = process.env) {
  if (!existsSync(envFilePath)) {
    return {
      env: null,
      errors: ["Create .env.local.test from config/local-test.env.example."],
    };
  }
  const parsed = parseEnvFile(readFileSync(envFilePath, "utf8"));
  const env = buildSanitizedLocalTestEnv(parsed.env, inheritedEnv);
  return {
    env,
    errors: [...parsed.errors, ...validateLocalTestEnv(env)],
  };
}

export function buildVinextDevArgs(userArgs = [], isolatedEnvDir = "") {
  const args = [resolve("node_modules/vinext/dist/cli.js"), "dev", "--mode", "test"];
  if (isolatedEnvDir) args.push("--envDir", isolatedEnvDir);
  for (let index = 0; index < userArgs.length; index += 1) {
    const arg = userArgs[index];
    if (arg === "--mode" || arg === "-m" || arg === "--envDir") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--mode=") || arg.startsWith("-m=") || arg.startsWith("--envDir=")) continue;
    if (arg === "--host") {
      const value = userArgs[index + 1];
      if (value !== undefined) {
        args.push("--hostname", value);
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--host=")) {
      args.push(`--hostname=${arg.slice("--host=".length)}`);
      continue;
    }
    args.push(arg);
  }
  return args;
}

async function main() {
  const root = process.cwd();
  const realDataPreview = process.argv.includes("--real-data-preview");
  const appArgs = process.argv.slice(2).filter((argument) => argument !== "--real-data-preview");
  const localPreviewPort = (() => {
    const index = appArgs.findIndex((argument) => argument === "--port");
    if (index >= 0 && /^\d+$/.test(appArgs[index + 1] || "")) return appArgs[index + 1];
    const inline = appArgs.find((argument) => argument.startsWith("--port="));
    return inline && /^\d+$/.test(inline.slice("--port=".length)) ? inline.slice("--port=".length) : "3000";
  })();
  const envFile = resolve(root, ".env.local.test");
  const { env, errors } = loadSanitizedEnv(envFile);
  if (env) {
    env.FANZZY_DATA_MODE = realDataPreview ? "production-snapshot" : "test-fixtures";
    env.NEXT_PUBLIC_FANZZY_DATA_MODE = env.FANZZY_DATA_MODE;
    env.FANZZY_LOCAL_DATABASE_PORT = realDataPreview ? "54322" : "54321";
    if (realDataPreview) {
      const localPreviewUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
      localPreviewUrl.hostname = "localhost";
      localPreviewUrl.port = localPreviewPort;
      localPreviewUrl.pathname = "/local-db";
      env.NEXT_PUBLIC_SUPABASE_URL = localPreviewUrl.toString().replace(/\/$/, "");
      env.SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
      const productionEnvFile = resolve(root, ".env.local");
      if (!existsSync(productionEnvFile)) {
        errors.push("The real admin credentials are unavailable because .env.local is missing.");
      } else {
        const productionAdminEnv = parseEnvFile(readFileSync(productionEnvFile, "utf8"));
        const email = productionAdminEnv.env.ADMIN_LOGIN_EMAIL?.trim();
        const password = productionAdminEnv.env.ADMIN_LOGIN_PASSWORD || "";
        if (!email || !password) {
          errors.push("ADMIN_LOGIN_EMAIL and ADMIN_LOGIN_PASSWORD are required in .env.local for the real-data preview.");
        } else {
          // Only the local preview process receives these two values. Its
          // admin cookie remains signed with the local test secret, so it
          // cannot authenticate against the deployed site.
          env.ADMIN_LOGIN_EMAIL = email;
          env.ADMIN_LOGIN_PASSWORD = password;
        }
      }
    }
  }
  if (realDataPreview && !existsSync(resolve(root, ".local-real-preview", "snapshot.json"))) {
    errors.push("Create the read-only local snapshot first with: node scripts/snapshot-production-readonly.mjs");
  }
  if (!env || errors.length) {
    console.error(`Local test startup blocked:\n- ${errors.join("\n- ")}`);
    process.exit(1);
  }

  console.log(`${realDataPreview ? "Local real-data preview" : "Local test"} safety check passed. Starting Vinext in local-test mode.`);
  const database = env.NEXT_PUBLIC_SUPABASE_URL.startsWith("http:")
    ? await (await import("./local-database.mjs")).startLocalDatabase(env)
    : null;
  const isolatedEnvDir = mkdtempSync(join(tmpdir(), "fanzzy-vinext-test-env-"));
  const node = process.execPath;
  const app = spawn(node, buildVinextDevArgs(appArgs, isolatedEnvDir), {
    stdio: "inherit",
    env,
  });
  const cleanup = () => rmSync(isolatedEnvDir, { recursive: true, force: true });
  const stop = async () => { if (!app.killed) app.kill(); await database?.stop(); cleanup(); };
  process.on("SIGINT", () => { void stop().then(() => process.exit(130)); });
  process.on("SIGTERM", () => { void stop().then(() => process.exit(143)); });
  app.once("exit", (code) => { void database?.stop().finally(() => { cleanup(); process.exit(code ?? 0); }); if (!database) { cleanup(); process.exit(code ?? 0); } });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch((error) => { console.error(error.message); process.exit(1); });
}
