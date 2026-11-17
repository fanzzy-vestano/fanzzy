import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildVinextDevArgs,
  buildSanitizedLocalTestEnv,
  parseEnvFile,
  validateLocalTestEnv,
} from "../scripts/dev-test.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("local-test startup rejects production services", () => {
  const script = read("scripts/dev-test.mjs");
  assert.match(script, /pdrcrkxeyqxqgpwfxqpu/);
  assert.match(script, /rzp_test_/);
  assert.match(script, /track\.delhivery\.com/);
  assert.match(script, /process\.exit\(1\)/);
  assert.match(script, /"--mode", "test"/);
  assert.match(script, /"--envDir"/);
  assert.match(script, /mkdtempSync/);
});

test("normal localhost startup rejects the current production env", () => {
  const script = read("scripts/dev.mjs");
  assert.match(script, /production services/);
  assert.match(script, /RAZORPAY_KEY_ID\\s\*=\\s\*rzp_live_/);
});

test("local Delhivery supports mock and configurable staging endpoints", () => {
  const source = read("lib/delhivery.ts");
  assert.match(source, /DELHIVERY_MODE/);
  assert.match(source, /createMockDelhiveryShipment/);
  assert.match(source, /staging-express\.delhivery\.com|DELHIVERY_STAGING_HOST/);
});

test("local fixed OTP is gated by local-test", () => {
  const source = read("app/api/customer-auth/send-otp/route.ts");
  assert.match(source, /FANZZY_ENV === "local-test"/);
  assert.match(source, /LOCAL_TEST_OTP_CODE/);
});

test("site API worker routes mobile customer OTP endpoints", () => {
  const source = read("worker/site-api.ts");

  assert.match(source, /customer-auth\/send-otp/);
  assert.match(source, /customer-auth\/verify-otp/);
  assert.match(source, /customer-auth\/session/);
  assert.match(source, /customer-auth\/sign-out/);
  assert.match(source, /customerSendOtpRoute/);
  assert.match(source, /customerVerifyOtpRoute/);
});

const validFileEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://xxibqydsluzgezqiyyyx.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "dummy-publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: "dummy-service-role-key",
  RAZORPAY_KEY_ID: "rzp_test_dummy",
  RAZORPAY_KEY_SECRET: "dummy-razorpay-secret",
  CUSTOMER_AUTH_SECRET: "dummy-customer-secret",
  LOCAL_TEST_OTP_CODE: "123456",
  DELHIVERY_MODE: "mock",
};

test("mock courier mode removes external Delhivery One credentials", () => {
  const env = buildSanitizedLocalTestEnv({ ...validFileEnv, D1_CLIENT_SECRET: "external-secret", D1_MCP_URL: "https://example.invalid" }, {});
  assert.equal(env.D1_CLIENT_SECRET, undefined);
  assert.equal(env.D1_MCP_URL, undefined);
});

test("local database configuration accepts only explicit loopback database URLs", () => {
  for (const url of ["http://127.0.0.1:3000/local-db", "http://localhost:3000/local-db"]) {
    const env = buildSanitizedLocalTestEnv({ ...validFileEnv, NEXT_PUBLIC_SUPABASE_URL: url }, {});
    assert.deepEqual(validateLocalTestEnv(env), []);
  }
  for (const url of ["http://192.168.1.5:3000/local-db", "http://example.com:3000/local-db", "http://user:password@localhost:3000/local-db", "http://localhost:3000/local-db?target=remote", "http://localhost:3000/other", "http://localhost/local-db"]) {
    const env = buildSanitizedLocalTestEnv({ ...validFileEnv, NEXT_PUBLIC_SUPABASE_URL: url }, {});
    assert.match(validateLocalTestEnv(env).join("\n"), /loopback/);
  }
});

test("local-test child env is derived from the file and blocks inherited production overrides", () => {
  const env = buildSanitizedLocalTestEnv(validFileEnv, {
    NEXT_PUBLIC_SUPABASE_URL: "https://pdrcrkxeyqxqgpwfxqpu.supabase.co",
    SUPABASE_URL: "https://pdrcrkxeyqxqgpwfxqpu.supabase.co",
    NEXT_PUBLIC_FANZZY_ENV: "production",
    FANZZY_ENV: "production",
    NEXT_PUBLIC_SITE_API_URL: "https://example.invalid",
    RAZORPAY_KEY_ID: "rzp_live_dummy",
    PATH: "dummy-path",
  });

  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, validFileEnv.NEXT_PUBLIC_SUPABASE_URL);
  assert.equal(env.SUPABASE_URL, validFileEnv.NEXT_PUBLIC_SUPABASE_URL);
  assert.equal(env.RAZORPAY_KEY_ID, validFileEnv.RAZORPAY_KEY_ID);
  assert.equal(env.FANZZY_ENV, "local-test");
  assert.equal(env.NEXT_PUBLIC_FANZZY_ENV, "local-test");
  assert.equal(env.NEXT_PUBLIC_SITE_API_URL, "");
  assert.equal(env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, "false");
  assert.equal(env.CLOUDFLARE_INCLUDE_PROCESS_ENV, "false");
  assert.equal(env.PATH, "dummy-path");
  assert.deepEqual(validateLocalTestEnv(env), []);
});

test("local-test validation fails closed for production or incomplete file configuration", () => {
  const productionEnv = buildSanitizedLocalTestEnv({
    ...validFileEnv,
    NEXT_PUBLIC_SUPABASE_URL: "https://pdrcrkxeyqxqgpwfxqpu.supabase.co",
  }, {});
  assert.match(validateLocalTestEnv(productionEnv).join("\n"), /production Fanzzy project/);

  const incompleteEnv = buildSanitizedLocalTestEnv({
    NEXT_PUBLIC_SUPABASE_URL: validFileEnv.NEXT_PUBLIC_SUPABASE_URL,
  }, {});
  assert.match(validateLocalTestEnv(incompleteEnv).join("\n"), /PUBLISHABLE_KEY|SERVICE_ROLE_KEY|RAZORPAY|CUSTOMER_AUTH|OTP/);
});

test("malformed local-test env files are rejected before launch", () => {
  const parsed = parseEnvFile("NEXT_PUBLIC_SUPABASE_URL\nVALID_KEY=value\nBAD KEY=value");
  assert.equal(parsed.env.VALID_KEY, "value");
  assert.equal(parsed.errors.length, 2);
});

test("dev:test forces Vinext test mode so .env.local is not auto-selected", () => {
  const args = buildVinextDevArgs(["--host", "127.0.0.1"], "C:/tmp/isolated-env");
  assert.deepEqual(args.slice(1, 6), ["dev", "--mode", "test", "--envDir", "C:/tmp/isolated-env"]);
  assert.deepEqual(args.slice(6), ["--hostname", "127.0.0.1"]);
});

test("caller-provided Vinext modes cannot override local-test isolation", () => {
  const longMode = buildVinextDevArgs(["--mode", "development", "--port", "3100"], "C:/tmp/isolated-env");
  assert.deepEqual(longMode.slice(1), ["dev", "--mode", "test", "--envDir", "C:/tmp/isolated-env", "--port", "3100"]);

  const equalsMode = buildVinextDevArgs(["--mode=production", "-m=local", "--host", "127.0.0.1"], "C:/tmp/isolated-env");
  assert.deepEqual(equalsMode.slice(1), ["dev", "--mode", "test", "--envDir", "C:/tmp/isolated-env", "--hostname", "127.0.0.1"]);

  const shortMode = buildVinextDevArgs(["-m", "production"], "C:/tmp/isolated-env");
  assert.deepEqual(shortMode.slice(1), ["dev", "--mode", "test", "--envDir", "C:/tmp/isolated-env"]);
});

test("caller-provided Vinext envDir cannot point back at repository env files", () => {
  const args = buildVinextDevArgs([
    "--envDir",
    ".",
    "--envDir=.",
    "--host",
    "127.0.0.1",
  ], "C:/tmp/isolated-env");
  assert.deepEqual(args.slice(1), ["dev", "--mode", "test", "--envDir", "C:/tmp/isolated-env", "--hostname", "127.0.0.1"]);
});

test("caller-provided host aliases are translated to Vinext hostname flags", () => {
  const spaced = buildVinextDevArgs(["--host", "127.0.0.1", "--port", "3137"], "C:/tmp/isolated-env");
  assert.deepEqual(spaced.slice(1), [
    "dev",
    "--mode",
    "test",
    "--envDir",
    "C:/tmp/isolated-env",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3137",
  ]);

  const equals = buildVinextDevArgs(["--host=127.0.0.1", "--port=3137"], "C:/tmp/isolated-env");
  assert.deepEqual(equals.slice(1), [
    "dev",
    "--mode",
    "test",
    "--envDir",
    "C:/tmp/isolated-env",
    "--hostname=127.0.0.1",
    "--port=3137",
  ]);
});

test("local-test disables Cloudflare persistent runtime state", () => {
  const source = read("vite.config.ts");
  assert.match(source, /isLocalTest \? \{ persistState: false \} : \{\}/);
});
