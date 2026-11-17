import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createCustomerSessionToken,
  createPendingOtpToken,
  getCustomerSession,
  getPendingOtp,
  matchesPendingOtp,
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
