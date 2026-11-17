import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");
const apiRoute = read("app/api/razorpay/verify/route.ts");
const workerApi = read("worker/razorpay-api.ts");
const adminPage = read("app/admin/page.tsx");

test("admin POS creates an order and opens Checkout.js with UPI enabled", () => {
  assert.match(adminPage, /adminRazorpayApiUrl\("order"\)/);
  assert.match(adminPage, /loadAdminRazorpayCheckout/);
  assert.match(adminPage, /method: \{ upi: true \}/);
  assert.match(adminPage, /order_id: current\.orderId/);
  assert.doesNotMatch(adminPage, /adminRazorpayApiUrl\("pos-qr"\)/);
  assert.match(adminPage, /requestController\.signal/);
  assert.match(adminPage, /timed out/);
  assert.match(adminPage, /Tap Pay with UPI to open UPI and QR options/);
});

test("POS verification requires captured UPI payment and exact amount", () => {
  for (const source of [apiRoute, workerApi]) {
    assert.match(source, /body\.posSale === true/);
    assert.match(source, /payment\.status !== ["']captured["']/);
    assert.match(source, /payment\.method !== ["']upi["']/);
    assert.match(source, /Number\(payment\.amount\) !== expectedAmount/);
  }
});

test("customer verification still finalizes normal orders", () => {
  for (const source of [apiRoute, workerApi]) assert.match(source, /finalizeRazorpayPayment|finalizeOrderInventory/);
});

test("POS Checkout cancellation and retry are explicit", () => {
  assert.match(adminPage, /status: ["']cancelled["']/);
  assert.match(adminPage, /Retry UPI payment/);
  assert.match(adminPage, /posQr.status === ["']paid["']/);
});

test("admin POS never uses native QR or hosted Payment Links", () => {
  assert.doesNotMatch(adminPage, /pos-qr/);
  for (const source of [apiRoute, workerApi]) assert.doesNotMatch(source, /payment_links/);
  assert.doesNotMatch(adminPage, /RAZORPAY_KEY_SECRET/);
});
