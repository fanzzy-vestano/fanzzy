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

test("POS QR fallback accepts only an exact captured UPI payment", () => {
  for (const source of [apiRoute, workerApi]) {
    assert.match(source, /payment\.status === ["']captured["']/);
    assert.match(source, /payment\.method === ["']upi["']/);
    assert.match(source, /Number\(payment\.amount\) === Number\(result\.amount\)/);
    assert.match(source, /Number\(result\.amount_paid\) === Number\(result\.amount\)/);
  }
});

test("admin POS exposes QR expiry handling without embedding Razorpay secrets", () => {
  assert.match(adminPage, /status: ["']expired["']/);
  assert.match(adminPage, /Expires in/);
  assert.doesNotMatch(adminPage, /RAZORPAY_KEY_SECRET/);
});
