import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");
const apiRoute = read("app/api/razorpay/pos-qr/route.ts");
const workerApi = read("worker/razorpay-api.ts");
const adminPage = read("app/admin/page.tsx");

test("POS QR creation remains fixed-amount and single-use in both server paths", () => {
  for (const source of [apiRoute, workerApi]) {
    assert.match(source, /usage:\s*["']single_use["']/);
    assert.match(source, /fixed_amount:\s*true/);
    assert.match(source, /payment_amount:\s*amount/);
  }
});

test("POS QR status accepts only an exact captured UPI payment", () => {
  for (const source of [apiRoute, workerApi]) {
    assert.match(source, /payment\.status === ["']captured["']/);
    assert.match(source, /payment\.method === ["']upi["']/);
    assert.match(source, /payment_amount:\s*amount/);
  }
  assert.match(adminPage, /Number\(payload\.amount\) !== Number\(posQr\.amount\)/);
});

test("POS QR never falls back to a hosted Payment Link", () => {
  for (const source of [apiRoute, workerApi]) {
    assert.doesNotMatch(source, /v1\/payment_links/);
    assert.doesNotMatch(source, /payment_link/);
  }
});

test("admin POS exposes QR expiry handling without embedding Razorpay secrets", () => {
  assert.match(adminPage, /status: ["']expired["']/);
  assert.match(adminPage, /Expires in/);
  assert.doesNotMatch(adminPage, /RAZORPAY_KEY_SECRET/);
});
