export const PRODUCTION_SUPABASE_PROJECT_REF = "pdrcrkxeyqxqgpwfxqpu";
export const PRODUCTION_SITE_API_HOST = "fanzzy-razorpay-api.fanzzy.workers.dev";
export const DELHIVERY_PRODUCTION_HOST = "track.delhivery.com";
export const DELHIVERY_STAGING_HOST = "staging-express.delhivery.com";

type RuntimeEnvironment = Record<string, string | undefined>;

const value = (env: RuntimeEnvironment, key: string) => String(env[key] || "").trim();
const host = (input: string) => {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return "";
  }
};

export const isLocalTestEnvironment = (env: RuntimeEnvironment = process.env) =>
  value(env, "FANZZY_ENV") === "local-test" || value(env, "NEXT_PUBLIC_FANZZY_ENV") === "local-test";

export const isLoopbackTestDatabaseUrl = (input: string) => {
  try {
    const url = new URL(input);
    return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) && Boolean(url.port) && url.pathname === "/local-db" && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
};

export const assertLocalTestBrowserSafety = (env: RuntimeEnvironment = process.env) => {
  if (!isLocalTestEnvironment(env)) return;
  const supabaseUrl = value(env, "NEXT_PUBLIC_SUPABASE_URL");
  const supabaseHost = host(supabaseUrl);
  if ((!supabaseHost || !supabaseHost.endsWith(".supabase.co")) && !isLoopbackTestDatabaseUrl(supabaseUrl)) {
    throw new Error("Local test startup blocked: configure a separate Supabase test project URL.");
  }
  if (supabaseHost.startsWith(`${PRODUCTION_SUPABASE_PROJECT_REF}.`)) {
    throw new Error("Local test startup blocked: the configured Supabase project is production.");
  }
  for (const key of ["NEXT_PUBLIC_SITE_API_URL", "NEXT_PUBLIC_RAZORPAY_API_URL", "NEXT_PUBLIC_CUSTOMER_AUTH_API_URL"]) {
    if (host(value(env, key)) === PRODUCTION_SITE_API_HOST) {
      throw new Error(`Local test startup blocked: ${key} points to the production Worker.`);
    }
  }
};

export const assertLocalTestServerSafety = (env: RuntimeEnvironment = process.env) => {
  if (!isLocalTestEnvironment(env)) return;
  assertLocalTestBrowserSafety(env);
  const serverSupabaseUrl = value(env, "SUPABASE_URL") || value(env, "NEXT_PUBLIC_SUPABASE_URL");
  if (host(serverSupabaseUrl).startsWith(`${PRODUCTION_SUPABASE_PROJECT_REF}.`)) {
    throw new Error("Local test startup blocked: the server Supabase project is production.");
  }
  const razorpayKeyId = value(env, "RAZORPAY_KEY_ID");
  if (!razorpayKeyId.startsWith("rzp_test_")) {
    throw new Error("Local test startup blocked: RAZORPAY_KEY_ID must be a Razorpay Test Mode key.");
  }
  if (!value(env, "RAZORPAY_KEY_SECRET")) {
    throw new Error("Local test startup blocked: RAZORPAY_KEY_SECRET is missing.");
  }
  const delhiveryMode = value(env, "DELHIVERY_MODE") || "mock";
  if (!new Set(["mock", "staging"]).has(delhiveryMode)) {
    throw new Error("Local test startup blocked: DELHIVERY_MODE must be mock or staging.");
  }
  const delhiveryBaseUrl = value(env, "DELHIVERY_API_BASE_URL");
  if (host(delhiveryBaseUrl) === DELHIVERY_PRODUCTION_HOST) {
    throw new Error("Local test startup blocked: production Delhivery is forbidden.");
  }
  if (delhiveryMode === "staging" && host(delhiveryBaseUrl || `https://${DELHIVERY_STAGING_HOST}`) !== DELHIVERY_STAGING_HOST) {
    throw new Error("Local test startup blocked: Delhivery staging must use staging-express.delhivery.com.");
  }
};

export const requireLocalTestSupabaseUrl = (env: RuntimeEnvironment = process.env) => {
  if (isLocalTestEnvironment(env)) assertLocalTestBrowserSafety(env);
  return value(env, "NEXT_PUBLIC_SUPABASE_URL") || value(env, "SUPABASE_URL");
};
