import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createCustomerSessionToken,
  createPendingOtpToken,
  completeOtpSendCaptcha,
  getCustomerSession,
  getPendingOtp,
  getOtpSendCaptchaRequirement,
  matchesPendingOtp,
  recordOtpSend,
} from "../lib/customer-sms-auth.ts";

process.env.CUSTOMER_AUTH_SECRET = "isolated-customer-auth-regression-secret";
const phone = "919999900098";
const request = (token, cookie = false) => new Request("http://localhost/api/customer-auth/session", {
  headers: cookie ? { cookie: `fanzzy_customer_session=${token}` } : { authorization: `Bearer ${token}` },
});
const signedFixture = (data) => {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${createHmac("sha256", process.env.CUSTOMER_AUTH_SECRET).update(payload).digest("base64url")}`;
};

test("pending OTP bearer token cannot authenticate before verification", () => {
  const token = createPendingOtpToken({ phone, code: "123456", expiresAt: Date.now() + 60000 });
  assert.equal(getCustomerSession(request(token)), null);
});

test("pending OTP token cannot authenticate through the session cookie", () => {
  const token = createPendingOtpToken({ phone, code: "123456", expiresAt: Date.now() + 60000 });
  assert.equal(getCustomerSession(request(token, true)), null);
});

test("verified session tokens still authenticate with bearer and cookie", () => {
  const token = createCustomerSessionToken(phone);
  for (const cookie of [false, true]) {
    assert.deepEqual(getCustomerSession(request(token, cookie)), { id: `phone:${phone}`, phone: `+${phone}` });
  }
});

test("expired and tampered tokens are rejected", () => {
  assert.equal(getCustomerSession(request(signedFixture({ id: `phone:${phone}`, phone: `+${phone}`, expiresAt: Date.now() - 1 }))), null);
  assert.equal(getCustomerSession(request(createCustomerSessionToken(phone) + "tampered")), null);
  assert.equal(getCustomerSession(request("malformed")), null);
});

test("signed values without a valid matching customer identity are rejected", () => {
  for (const value of [null, {}, { id: 1, phone }, { id: `phone:${phone}`, phone: 1 }, { id: `phone:${phone}`, phone: "+919999900099" }]) {
    assert.equal(getCustomerSession(request(signedFixture(value))), null);
  }
});

test("pending tokens remain usable for OTP verification without exposing the code", () => {
  const token = createPendingOtpToken({ phone, code: "123456", expiresAt: Date.now() + 60000 });
  const pending = getPendingOtp(request(token));
  assert.equal(pending.phone, phone);
  assert.equal(matchesPendingOtp(pending, "123456"), true);
  assert.equal(matchesPendingOtp(pending, "654321"), false);
  assert.equal(JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString()).code, undefined);
});

test("a CAPTCHA is required before the fifth OTP send within five minutes", () => {
  const captchaPhone = "919999900099";
  const captchaRequest = new Request("http://localhost/api/customer-auth/send-otp", {
    headers: { "x-forwarded-for": "captcha-test-client" },
  });
  for (let index = 0; index < 4; index += 1) {
    assert.equal(getOtpSendCaptchaRequirement(captchaRequest, captchaPhone).allowed, true);
    recordOtpSend(captchaRequest, captchaPhone);
  }

  const required = getOtpSendCaptchaRequirement(captchaRequest, captchaPhone);
  assert.equal(required.allowed, false);
  assert.match(required.captcha.image, /^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(required.captcha.image.split(",")[1], "base64").toString();
  assert.doesNotMatch(svg, /<text/i);
  completeOtpSendCaptcha(required.captcha.token);
  assert.equal(getOtpSendCaptchaRequirement(captchaRequest, captchaPhone, required.captcha.token).allowed, false);
});

test("sends to other numbers on the same IP never trigger an early CAPTCHA", () => {
  const sameIp = new Request("http://localhost/api/customer-auth/send-otp", {
    headers: { "x-forwarded-for": "shared-network" },
  });
  for (let index = 0; index < 4; index += 1) recordOtpSend(sameIp, "919999900091");
  for (let index = 0; index < 3; index += 1) {
    assert.equal(getOtpSendCaptchaRequirement(sameIp, "919999900092").allowed, true);
    recordOtpSend(sameIp, "919999900092");
  }
  assert.equal(getOtpSendCaptchaRequirement(sameIp, "919999900092").allowed, true);
  assert.equal(getOtpSendCaptchaRequirement(sameIp, "919999900093").allowed, true);
});

test("changing IP does not reset the same mobile number's send count", () => {
  const firstIp = new Request("http://localhost", { headers: { "x-forwarded-for": "first-network" } });
  const secondIp = new Request("http://localhost", { headers: { "x-forwarded-for": "second-network" } });
  for (let index = 0; index < 4; index += 1) recordOtpSend(firstIp, "919999900094");
  assert.equal(getOtpSendCaptchaRequirement(secondIp, "919999900094").allowed, false);
});

test("CAPTCHA expires exactly when fewer than four sends remain in five minutes", (context) => {
  const start = 1_800_000_000_000;
  context.mock.timers.enable({ apis: ["Date"], now: start });
  const currentRequest = new Request("http://localhost");
  const currentPhone = "919999900095";
  for (let index = 0; index < 4; index += 1) {
    if (index) context.mock.timers.tick(45_000);
    recordOtpSend(currentRequest, currentPhone);
  }
  const captcha = getOtpSendCaptchaRequirement(currentRequest, currentPhone).captcha;
  assert.equal(captcha.expiresAt, start + 300_000);
  context.mock.timers.tick(164_999);
  assert.equal(getOtpSendCaptchaRequirement(currentRequest, currentPhone).allowed, false);
  context.mock.timers.tick(1);
  assert.equal(getOtpSendCaptchaRequirement(currentRequest, currentPhone).allowed, true);
  recordOtpSend(currentRequest, currentPhone);
  const nextCaptcha = getOtpSendCaptchaRequirement(currentRequest, currentPhone).captcha;
  assert.equal(nextCaptcha.expiresAt, start + 345_000, "four recent sends require a fresh challenge again");
});

test("five sends spread over more than five minutes do not require a CAPTCHA", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 1_800_100_000_000 });
  const currentRequest = new Request("http://localhost");
  for (let index = 0; index < 5; index += 1) {
    if (index) context.mock.timers.tick(110_000);
    recordOtpSend(currentRequest, "919999900096");
  }
  assert.equal(getOtpSendCaptchaRequirement(currentRequest, "919999900096").allowed, true);
});
