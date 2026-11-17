import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(imports, extras = {}) {
  const source = readFileSync(new URL("../lib/cancellation-razorpay-refunds.ts", import.meta.url), "utf8");
  const exports = {};
  const sandbox = {
    exports,
    module: { exports },
    Buffer,
    Response,
    AbortSignal,
    process: {
      env: {
        FANZZY_ENV: "local-test",
        RAZORPAY_KEY_ID: "rzp_test_fixture",
        RAZORPAY_KEY_SECRET: "fixture-secret",
      },
    },
    fetch: async () => {
      throw new Error("Unmocked provider request");
    },
    require: (name) => {
      if (!(name in imports)) throw new Error(`Unmocked import: ${name}`);
      return imports[name];
    },
    ...extras,
  };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    sandbox,
  );
  return sandbox.module.exports;
}

class CheckoutError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

const paidOrder = () => ({
  id: "#FZ-REFUND-01",
  status: "Cancelled",
  paymentMethod: "online",
  paymentStatus: "paid",
  total: "₹22",
  razorpayOrderId: "order_fixture",
  razorpayPaymentId: "pay_fixture",
  cancellationRecords: [
    {
      id: "cancel_fixture",
      itemIndexes: [0],
      refundAmount: 22,
      refundStatus: "Pending",
      reason: "Ordered by mistake",
      createdAt: "2026-11-16T00:00:00.000Z",
      fullOrder: true,
    },
  ],
});

const capturedPayment = {
  id: "pay_fixture",
  order_id: "order_fixture",
  amount: 2200,
  currency: "INR",
  status: "captured",
  captured: true,
};

function refundModule(orders, options = {}) {
  const writes = [];
  const providerReads = [];
  const module = load({
    "node:crypto": { createHash },
    "./payment-policy": {
      paymentConfigurationError: () => null,
      assertCapturedPayment: (payment, order) => {
        assert.equal(payment.id, order.razorpayPaymentId);
        assert.equal(payment.status, "captured");
        assert.equal(payment.amount, 2200);
      },
    },
    "./razorpay-provider": {
      razorpayRead: async (path) => {
        providerReads.push(path);
        if (path.startsWith("payments/pay_fixture/refunds")) {
          return { items: options.existingRefund ? [options.existingRefund] : [] };
        }
        if (path === "payments/pay_fixture") return capturedPayment;
        throw new Error(`Unexpected read ${path}`);
      },
    },
    "./transactional-checkout": {
      CheckoutError,
      readTransactionalOrders: async () => orders,
      patchTransactionalOrders: async (value) => { writes.push(structuredClone(value)); },
    },
  }, {
    fetch: options.fetch || (async (url, init) => {
      assert.match(url, /payments\/pay_fixture\/refund$/);
      const body = JSON.parse(init.body);
      assert.equal(body.amount, 2200);
      assert.equal(body.notes.fanzzy_order_id, "#FZ-REFUND-01");
      assert.equal(body.notes.fanzzy_cancellation_id, "cancel_fixture");
      return Response.json({
        id: "rfnd_fixture",
        payment_id: "pay_fixture",
        amount: 2200,
        currency: "INR",
        receipt: body.receipt,
        status: "processed",
      });
    }),
  });
  return { module, writes, providerReads };
}

test("server-side cancelled-order refund uses the saved cancellation amount and records Razorpay's reference", async () => {
  const orders = [paidOrder()];
  const { module, writes } = refundModule(orders);
  const result = await module.issueCancellationRazorpayRefund("#FZ-REFUND-01", "cancel_fixture");

  assert.equal(result.refundReference, "rfnd_fixture");
  assert.equal(result.providerStatus, "processed");
  assert.equal(orders[0].cancellationRecords[0].refundStatus, "Completed");
  assert.equal(orders[0].cancellationRecords[0].refundReference, "rfnd_fixture");
  assert.equal(orders[0].refundStatus, "Refunded");
  assert.equal(orders[0].returnStatus, "Refunded");
  assert.equal(writes.length, 1);
});

test("existing deterministic Razorpay refund is recorded without another provider write", async () => {
  const orders = [paidOrder()];
  const receipt = `fanzzy-cancel-${createHash("sha256").update("#FZ-REFUND-01:cancel_fixture").digest("hex").slice(0, 20)}`;
  const { module, writes, providerReads } = refundModule(orders, {
    existingRefund: {
      id: "rfnd_existing",
      payment_id: "pay_fixture",
      amount: 2200,
      currency: "INR",
      receipt,
      status: "processed",
    },
    fetch: async () => {
      throw new Error("A saved Razorpay refund must not be created twice");
    },
  });

  const result = await module.issueCancellationRazorpayRefund("#FZ-REFUND-01", "cancel_fixture");
  assert.equal(result.refundReference, "rfnd_existing");
  assert.equal(writes.length, 1);
  assert.equal(providerReads.some((path) => path.includes("/refunds")), true);
});

test("COD or uncaptured orders are rejected before Razorpay is called", async () => {
  const order = paidOrder();
  order.paymentMethod = "cod";
  const { module, writes, providerReads } = refundModule([order]);
  await assert.rejects(
    () => module.issueCancellationRazorpayRefund("#FZ-REFUND-01", "cancel_fixture"),
    /Only captured online payments/,
  );
  assert.equal(writes.length, 0);
  assert.equal(providerReads.length, 0);
});

test("old local placeholder payments are never sent to Razorpay", async () => {
  const order = paidOrder();
  order.razorpayPaymentId = "pay_local_cancel_razorpay_001";
  const { module, writes, providerReads } = refundModule([order]);
  await assert.rejects(
    () => module.issueCancellationRazorpayRefund("#FZ-REFUND-01", "cancel_fixture"),
    /local sample cancellation/,
  );
  assert.equal(writes.length, 0);
  assert.equal(providerReads.length, 0);
});
