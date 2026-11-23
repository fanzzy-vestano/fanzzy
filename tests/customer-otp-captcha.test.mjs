import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import * as nodeCrypto from "node:crypto";

const require = createRequire(import.meta.url);
const sources = {
  local: "app/api/customer-auth/send-otp/route.ts",
  edge: "supabase/functions/customer-auth/index.ts",
};
const bundles = Object.fromEntries(Object.entries(sources).map(([runtime, source]) => [runtime, buildSync({
  entryPoints: [fileURLToPath(new URL(`../${source}`, import.meta.url))],
  bundle: true,
  platform: "node",
  format: "cjs",
  alias: { "npm:libphonenumber-js@1.13.17": require.resolve("libphonenumber-js") },
  write: false,
}).outputFiles[0].text]));

// Exercise both real request handlers with a virtual clock and an SMS stub.
// No production credentials, real SMS calls, or running preview counters are used.
const loadHandler = (runtime, shared = { now: 1_800_000_000_000, rows: new Map() }) => {
  let handler;
  let delivered = 0;
  shared.tokenCounter ??= 0;
  const testRandomBytes = (length) => length === 5 ? Buffer.alloc(length) : Buffer.alloc(length, length === 10 ? (++shared.tokenCounter * 2) % 256 : ++shared.tokenCounter);
  const env = {
    CUSTOMER_AUTH_SECRET: "isolated-captcha-route-secret",
    FANZZY_ENV: "local-test",
    LOCAL_TEST_OTP_CODE: "123456",
    SANGAMAM_SMS_ACCESS_TOKEN: "isolated-provider-token",
    SANGAMAM_SMS_ACCESS_TOKEN_KEY: "isolated-provider-secret",
    SUPABASE_URL: "http://captcha.test",
    SUPABASE_SERVICE_ROLE_KEY: "isolated-service-key",
  };
  const bundledModule = { exports: {} };
  const sandbox = vm.createContext({
    module: bundledModule, exports: bundledModule.exports,
    require: (name) => name === "node:crypto" ? { ...nodeCrypto, randomBytes: testRandomBytes } : require(name),
    Buffer, Request, Response, Headers, URL, TextEncoder, TextDecoder, AbortSignal,
    crypto: { subtle: globalThis.crypto.subtle, getRandomValues: (array) => {
      array.fill(array.length === 5 ? 0 : array.length === 10 ? (++shared.tokenCounter * 2) % 256 : ++shared.tokenCounter);
      return array;
    } }, btoa, atob,
    Date: class extends Date { static now() { return shared.now; } },
    process: { env },
    console: { info() {}, log() {}, error() {} },
    fetch: async (url, init) => {
      if (url === "http://captcha.test/rest/v1/rpc/fanzzy_otp_captcha_op_v1") {
        if (shared.failStore) return Response.json({ error: "unavailable" }, { status: 503 });
        const op = JSON.parse(init.body);
        const row = shared.rows.get(op.p_phone) || { sends: [], challenges: new Map() };
        shared.rows.set(op.p_phone, row);
        row.sends = row.sends.filter((t) => t > shared.now - 300_000);
        const until = row.sends.length >= 4 ? row.sends.at(-4) + 300_000 : 0;
        const challenge = row.challenges.get(op.p_token);
        const newChallenge = () => { row.challenges.set(op.p_new_token, { answer: op.p_new_answer, client: op.p_client, expires: until, verified: false }); };
        let result;
        if (op.p_action === "commit") {
          if (row.committed === op.p_reservation) result = { status: "committed" };
          else if (row.reservation !== op.p_reservation) return Response.json({ error: "invalid reservation" }, { status: 400 });
          else { row.sends = row.reset ? [shared.now] : [...row.sends, shared.now]; row.committed = op.p_reservation; row.reservation = null; if (row.reset) row.challenges.clear(); result = { status: "committed" }; }
        } else if (op.p_action === "abort") {
          if (row.reservation === op.p_reservation) row.reservation = null;
          result = { status: "aborted" };
        } else if (op.p_action === "reserve") {
          if (row.reservation && row.reservationExpires > shared.now) result = { status: "busy" };
          else if (until > shared.now && !(op.p_token && challenge && challenge.client === op.p_client && challenge.verified && challenge.expires > shared.now)) { newChallenge(); result = { status: "challenge", expiresAt: until }; }
          else { row.reservation = op.p_reservation; row.reservationExpires = shared.now + 120_000; row.reset = until > shared.now; result = { status: "ready" }; }
        } else if (until <= shared.now) result = { status: "not-required" };
        else if (op.p_action === "refresh") {
          if (!op.p_token || !challenge || challenge.client !== op.p_client || challenge.expires <= shared.now) result = { status: "invalid" };
          else { row.challenges.delete(op.p_token); newChallenge(); result = { status: "refreshed", expiresAt: until }; }
        } else if (op.p_action === "verify") {
          if (!op.p_token || !challenge || challenge.client !== op.p_client || challenge.expires <= shared.now || challenge.answer !== op.p_answer) { row.challenges.delete(op.p_token); newChallenge(); result = { status: "incorrect", expiresAt: until }; }
          else { challenge.verified = true; result = { status: "verified" }; }
        } else throw new Error("Unexpected CAPTCHA operation");
        return Response.json(result);
      }
      assert.equal(url, "https://fastsms.sangamamonline.in/api/sms/v1.0/send-sms");
      delivered += 1;
      return Response.json({ status: "success", httpStatusCode: 200 });
    },
    Deno: {
      env: { get: (name) => env[name] },
      serve: (route) => { handler = route; },
    },
  });
  vm.runInContext(bundles[runtime], sandbox);
  if (runtime === "local") handler = bundledModule.exports.POST;
  return {
    advance: (ms) => { shared.now += ms; },
    failService: () => { env.LOCAL_TEST_OTP_CODE = ""; env.CUSTOMER_AUTH_SECRET = ""; },
    restoreService: () => { env.LOCAL_TEST_OTP_CODE = "123456"; env.CUSTOMER_AUTH_SECRET = "isolated-captcha-route-secret"; },
    delivered: () => delivered,
    send: async (phone, extra = {}, ip = "192.0.2.1") => {
      const response = await handler(new Request("http://localhost/api/customer-auth/send-otp", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ phone, ...extra }),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
};

test("edge: fifth attempt and CAPTCHA verification work across independent instances", async () => {
  const shared = { now: 1_800_000_000_000, rows: new Map() };
  const first = loadHandler("edge", shared);
  const second = loadHandler("edge", shared);
  const phone = "919999900089";
  for (let count = 0; count < 4; count += 1) {
    assert.equal((await (count % 2 ? second : first).send(phone)).status, 200);
    first.advance(45_000);
  }
  const fifth = await first.send(phone);
  assert.equal(fifth.status, 429);
  assert.equal(fifth.body.captchaRequired, true);
  const verified = await second.send(phone, { captchaToken: fifth.body.captcha.token, captchaAnswer: "AaAaA", verifyCaptcha: true });
  assert.equal(verified.body.captchaVerified, true);
  const resent = await first.send(phone, { captchaToken: fifth.body.captcha.token });
  assert.equal(resent.status, 200);
  assert.equal(resent.body.sent, true);
});

test("edge: unavailable shared storage never sends an OTP", async () => {
  const shared = { now: 1_800_000_000_000, rows: new Map(), failStore: true };
  const app = loadHandler("edge", shared);
  const result = await app.send("919999900089");
  assert.ok(result.status >= 500);
  assert.equal(app.delivered(), 0);
});

for (const runtime of Object.keys(sources)) {
  test(`${runtime}: international numbers never reach an unconfigured production SMS route`, async () => {
    const app = loadHandler(runtime);
    const result = await app.send("+12025550123");
    if (runtime === "local") {
      assert.equal(result.status, 200);
      assert.equal(result.body.channel, "local-test");
    } else {
      assert.equal(result.status, 503);
      assert.match(result.body.error, /International SMS login is not configured/);
      assert.equal(app.delivered(), 0);
    }
  });
  test(`${runtime}: fifth attempt requires separate CAPTCHA verification before resending`, async () => {
    const app = loadHandler(runtime);
    const phone = "919999900081";
    for (let count = 1; count <= 4; count += 1) {
      const result = await app.send(phone);
      assert.equal(result.status, 200);
      assert.equal(result.body.sent, true);
      assert.equal(result.body.captchaRequired, undefined);
      app.advance(45_000);
    }
    const fifth = await app.send(phone);
    assert.equal(fifth.status, 429);
    assert.equal(fifth.body.sent, undefined);
    assert.equal(fifth.body.captchaRequired, true);
    assert.match(fifth.body.error, /enter and verify the CAPTCHA/i);
    const challenge = fifth.body.captcha;
    assert.match(challenge.image, /^data:image\/svg\+xml;base64,/);
    assert.equal(challenge.prompt, undefined);
    const image = Buffer.from(challenge.image.split(",")[1], "base64").toString();
    assert.doesNotMatch(image, /AaAaA|<text/i);
    assert.match(image, /fill="#ffffff"/);
    assert.match(image, /stroke="#4b1c2b"/);
    assert.equal((image.match(/M1 12 L5 0 L7 0 L11 12/g) || []).length, 3, "three uppercase glyphs match the answer");
    assert.equal((image.match(/M9 4 Q2 1 2 8/g) || []).length, 2, "two lowercase glyphs match the answer");
    const changed = await app.send(phone, { captchaToken: challenge.token, refreshCaptcha: true });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.captchaRequired, true);
    assert.notEqual(changed.body.captcha.token, challenge.token);
    assert.notEqual(changed.body.captcha.image, challenge.image);
    assert.equal(changed.body.sent, undefined, "changing the image must not send another OTP");
    if (runtime === "edge") assert.equal(app.delivered(), 4);
    const wrongClient = await app.send(phone, { captchaToken: changed.body.captcha.token, refreshCaptcha: true }, "192.0.2.9");
    assert.equal(wrongClient.status, 400, "other clients cannot replace a challenge");
    const oldToken = await app.send(phone, { captchaToken: challenge.token, refreshCaptcha: true });
    assert.equal(oldToken.status, 400, "the old challenge is invalidated");
    const bypass = await app.send(phone, { captchaToken: changed.body.captcha.token, captchaAnswer: "AaAaA" });
    assert.equal(bypass.status, 429, "submitting an answer as a resend must not bypass verification");
    const wrong = await app.send(phone, { captchaToken: changed.body.captcha.token, captchaAnswer: "AAAAA", verifyCaptcha: true });
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.error, /Incorrect CAPTCHA/i);
    assert.equal(wrong.body.captchaRequired, true, "same letters in the wrong case are rejected");
    const verified = await app.send(phone, {
      captchaToken: wrong.body.captcha.token,
      captchaAnswer: "AaAaA",
      verifyCaptcha: true,
    });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.captchaVerified, true);
    assert.equal(verified.body.sent, undefined, "verifying CAPTCHA never sends an OTP");
    if (runtime === "edge") assert.equal(app.delivered(), 4);
    const refreshedAfterVerification = await app.send(phone, { captchaToken: wrong.body.captcha.token, refreshCaptcha: true });
    assert.equal(refreshedAfterVerification.status, 200);
    const resendWithoutReverification = await app.send(phone, { captchaToken: refreshedAfterVerification.body.captcha.token });
    assert.equal(resendWithoutReverification.status, 429, "changing CAPTCHA requires verification again");
    const reverified = await app.send(phone, { captchaToken: refreshedAfterVerification.body.captcha.token, captchaAnswer: "AaAaA", verifyCaptcha: true });
    assert.equal(reverified.status, 200);
    assert.equal(reverified.body.captchaVerified, true);
    const solved = await app.send(phone, { captchaToken: refreshedAfterVerification.body.captcha.token });
    assert.equal(solved.status, 200);
    assert.equal(solved.body.sent, true);
    for (let count = 0; count < 3; count += 1) {
      app.advance(45_000);
      const next = await app.send(phone);
      assert.equal(next.status, 200, "the next cycle permits sends before its fifth attempt");
      assert.equal(next.body.captchaRequired, undefined);
    }
    app.advance(45_000);
    const replay = await app.send(phone, { captchaToken: refreshedAfterVerification.body.captcha.token });
    assert.equal(replay.status, 429, "the next fifth attempt needs a fresh CAPTCHA, not the used token");
    assert.equal(replay.body.captchaRequired, true);
    assert.notEqual(replay.body.captcha.token, refreshedAfterVerification.body.captcha.token);
    const otherPhone = await app.send("919999900082");
    assert.equal(otherPhone.status, 200);
    assert.equal(otherPhone.body.captchaRequired, undefined);
    assert.equal(otherPhone.body.captcha, undefined);
    if (runtime === "edge") assert.equal(app.delivered(), 9, "missing/incorrect CAPTCHA never sends SMS");
  });

  test(`${runtime}: a failed OTP delivery cannot reset the CAPTCHA cycle`, async () => {
    const app = loadHandler(runtime);
    const phone = "919999900085";
    for (let count = 0; count < 4; count += 1) {
      assert.equal((await app.send(phone)).status, 200);
      app.advance(45_000);
    }
    const first = await app.send(phone);
    assert.equal(first.status, 429);
    const verified = await app.send(phone, { captchaToken: first.body.captcha.token, captchaAnswer: "AaAaA", verifyCaptcha: true });
    assert.equal(verified.body.captchaVerified, true);
    app.failService();
    const failed = await app.send(phone, { captchaToken: first.body.captcha.token });
    assert.ok(failed.status >= 500);
    app.restoreService();
    app.advance(45_000);
    const unverified = await app.send(phone);
    assert.equal(unverified.status, 429, "CAPTCHA remains required after a failed delivery");
    const retried = await app.send(phone, { captchaToken: first.body.captcha.token });
    assert.equal(retried.status, 200, "verified token remains usable after a failed delivery");
  });

  test(`${runtime}: sends outside five minutes and failed deliveries do not trigger CAPTCHA`, async () => {
    const app = loadHandler(runtime);
    const premature = await app.send("919999900083", { refreshCaptcha: true });
    assert.equal(premature.status, 200);
    assert.equal(premature.body.captchaRequired, false);
    assert.equal(premature.body.sent, undefined);
    for (let count = 0; count < 5; count += 1) {
      const result = await app.send("919999900083");
      assert.equal(result.status, 200);
      assert.equal(result.body.captchaRequired, undefined);
      app.advance(80_000);
    }
    app.failService();
    for (let count = 0; count < 5; count += 1) {
      const result = await app.send("919999900084", {}, "192.0.2.2");
      assert.ok(result.status >= 500);
      assert.equal(result.body.captchaRequired, undefined);
      app.advance(45_000);
    }
    app.restoreService();
    const firstSuccess = await app.send("919999900084", {}, "192.0.2.2");
    assert.equal(firstSuccess.status, 200);
    assert.equal(firstSuccess.body.captchaRequired, undefined);
  });
}
