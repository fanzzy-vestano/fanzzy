import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const routePath = "app/api/admin/pos-checkout/route.ts";
const edgePath = "supabase/functions/pos-checkout/index.ts";
const posLogicPath = "supabase/functions/_shared/pos-checkout.ts";
const saleId = "#FZ-POS-0123456789AB";
const amount = 5500;
const providerOrder = {
  id: "order_counter1", amount, currency: "INR", receipt: saleId.slice(1),
  status: "attempted", notes: { fanzzy_order_id: saleId, fanzzy_payment_source: "pos_checkout" },
};
const captured = {
  id: "pay_counter1", order_id: providerOrder.id, status: "captured",
  captured: true, method: "upi", currency: "INR", amount,
};

function load(path, imports = {}, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports, btoa, Headers, Request, Response, URL, URLSearchParams, AbortSignal,
    process: { env: { FANZZY_ENV: "local-test", RAZORPAY_KEY_ID: "rzp_test_counter", RAZORPAY_KEY_SECRET: "fixture-secret" } },
    require(name) {
      assert.ok(Object.hasOwn(imports, name), `Unmocked import: ${name}`);
      return imports[name];
    },
    ...globals,
  });
  return exports;
}

function fixture({ order = providerOrder, payments = [captured], allowed = true, providerError, edge = false } = {}) {
  const reads = [];
  const creates = [];
  const checkout = load(posLogicPath, {}, {
    async fetch(url, init) {
      assert.match(init.headers.authorization, /^Basic /);
      if (init.method !== "POST") {
        const path = url.replace("https://api.razorpay.com/v1/", "");
        reads.push(path);
        if (path === `orders/${providerOrder.id}`) return Response.json(order);
        assert.equal(path, `orders/${providerOrder.id}/payments`);
        return Response.json({ items: payments });
      }
      assert.equal(url, "https://api.razorpay.com/v1/orders");
      creates.push(JSON.parse(init.body));
      return providerError ? Response.json({ error: { description: providerError } }, { status: 400 })
        : Response.json(order);
    },
  });
  if (edge) {
    let handler;
    const env = { SUPABASE_URL: origin, RAZORPAY_KEY_ID: "rzp_live_counter", RAZORPAY_KEY_SECRET: "fixture-secret" };
    load(edgePath, { "../_shared/pos-checkout.ts": checkout }, {
      Deno: {
        env: { get: (name) => env[name] },
        serve: (callback) => { handler = callback; },
      },
      async fetch(url, init) {
        assert.equal(url, `${origin}/auth/v1/user`);
        assert.equal(init.headers.apikey, "publishable-fixture");
        assert.equal(init.headers.authorization, "Bearer signed-session");
        return Response.json({
          email: allowed ? "fanzzy@vestanoretail.com" : "customer@example.invalid",
          email_confirmed_at: "2026-01-01T00:00:00Z",
        });
      },
    });
    return { handler, reads, creates, env };
  }
  const route = load(routePath, {
    "../../../../lib/admin-auth": { isAdminSessionValid: () => allowed },
    "../../../../lib/payment-policy": load("lib/payment-policy.ts"),
    "../../../../supabase/functions/_shared/pos-checkout": checkout,
  });
  return { route, reads, creates };
}

const origin = "https://isolated.invalid";
const checkoutUrl = `${origin}/api/admin/pos-checkout`;
const createRequest = (value = { saleId, amount }) => new Request(checkoutUrl, { method: "POST", body: JSON.stringify(value) });
const statusRequest = (id = saleId) => new Request(`${checkoutUrl}?${new URLSearchParams({ saleId: id, id: providerOrder.id })}`);

test("unauthenticated requests and invalid bills never reach Razorpay", async () => {
  const unauthorized = fixture({ allowed: false });
  assert.equal((await unauthorized.route.POST(createRequest())).status, 401);
  assert.equal((await unauthorized.route.GET(statusRequest())).status, 401);
  assert.deepEqual([...unauthorized.creates, ...unauthorized.reads], []);

  const { route, creates } = fixture();
  for (const value of [null, { saleId: "customer-order", amount }, { saleId, amount: 99 }, { saleId, amount: 500.5 }]) {
    assert.equal((await route.POST(createRequest(value))).status, 400);
  }
  assert.deepEqual(creates, []);
});

test("opens UPI-only Checkout with the exact bill and checks the same order after dismissal", async () => {
  const { route, creates, reads } = fixture();
  let options;
  let closed = false;
  const client = load("lib/pos-upi-client.ts", {
    "./supabase/client": { supabase: null },
    "./site-api-client": {
      adminApiFetch(path, init) {
        const request = new Request(`${origin}/api${path}`, init);
        return init.method === "POST" ? route.POST(request) : route.GET(request);
      },
    },
  }, {
    crypto: { randomUUID: () => "01234567-89ab-cdef-0123-456789abcdef" },
    window: { Razorpay: class {
      constructor(input) { options = input; }
      open() {}
    } },
  });

  const order = await client.createPosCheckoutOrder(amount);
  assert.equal(order.id, providerOrder.id);
  assert.equal(order.keyId, "rzp_test_counter");
  assert.equal(order.amount, amount);
  assert.equal(order.saleId, saleId);
  assert.deepEqual(creates, [{
    amount, receipt: providerOrder.receipt, currency: "INR", partial_payment: false, notes: providerOrder.notes,
  }]);
  const checkout = await client.preparePosCheckout(order, { name: "", phone: "" }, () => {}, () => { closed = true; });
  checkout.open();
  assert.equal(options.order_id, providerOrder.id);
  assert.equal(options.amount, amount);
  assert.equal(options.config.display.blocks.posupi.instruments[0].method, "upi");
  assert.equal(options.config.display.preferences.show_default_blocks, false);
  options.modal.ondismiss();
  assert.ok(closed);
  const result = await client.readPosCheckoutStatus(order);
  assert.equal(result.status, "paid");
  assert.equal(result.paymentId, captured.id);
  assert.equal(result.amount, amount);
  assert.deepEqual(reads, [`orders/${providerOrder.id}`, `orders/${providerOrder.id}/payments`]);
});

test("keeps authorized payments pending and permits retry when no payment is in flight", async () => {
  const authorized = fixture({ payments: [{ ...captured, status: "authorized", captured: false }] });
  assert.equal((await (await authorized.route.GET(statusRequest())).json()).status, "pending");
  const failed = fixture({ payments: [{ ...captured, status: "failed", captured: false }] });
  assert.equal((await (await failed.route.GET(statusRequest())).json()).status, "waiting");
  const awaitingCapture = fixture({ order: { ...providerOrder, status: "paid" }, payments: [] });
  assert.equal((await (await awaitingCapture.route.GET(statusRequest())).json()).status, "pending");
});

test("only a captured INR UPI payment for the saved POS order and amount confirms the bill", async () => {
  for (const change of [{ method: "card" }, { amount: 100 }, { currency: "USD" }, { captured: false }]) {
    const { route } = fixture({ payments: [{ ...captured, ...change }] });
    assert.equal((await (await route.GET(statusRequest())).json()).status, "review");
  }
  const unrelated = fixture({ order: { ...providerOrder, notes: { ...providerOrder.notes, fanzzy_payment_source: "storefront" } } });
  assert.equal((await unrelated.route.GET(statusRequest())).status, 409);
  assert.equal(unrelated.reads.length, 1);
});

test("surfaces provider errors and rejects a mismatched Checkout order", async () => {
  const rejected = fixture({ providerError: "Razorpay rejected this request." });
  const response = await rejected.route.POST(createRequest());
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /rejected this request/);
  const mismatch = fixture({ order: { ...providerOrder, amount: 100 } });
  assert.equal((await mismatch.route.POST(createRequest())).status, 502);
});

test("the GitHub Pages POS uses the Supabase function with the signed admin session", async () => {
  const { handler, creates, reads } = fixture({ edge: true });
  const authHeaders = { origin: "https://fanzzy.in", apikey: "publishable-fixture", authorization: "Bearer signed-session" };
  const edgeUrl = `${origin}/functions/v1/pos-checkout`;
  const client = load("lib/pos-upi-client.ts", {
    "./site-api-client": { adminApiFetch: () => assert.fail("Pages must use the POS Edge Function.") },
    "./supabase/client": {
      supabase: {
        functions: {
          async invoke(path, options) {
            assert.match(path, /^pos-checkout(?:\?|$)/);
            const response = await handler(new Request(`${origin}/functions/v1/${path}`, {
              method: options.method,
              headers: authHeaders,
              body: options.body ? JSON.stringify(options.body) : undefined,
            }));
            if (response.ok) return { data: await response.json(), error: null };
            return { data: null, error: new Error("Edge response failed."), response };
          },
        },
      },
    },
  }, {
    process: { env: { NEXT_PUBLIC_STATIC_BUILD: true } },
    crypto: { randomUUID: () => "01234567-89ab-cdef-0123-456789abcdef" },
  });

  const preflight = await handler(new Request(edgeUrl, { method: "OPTIONS", headers: { origin: "https://fanzzy.in" } }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://fanzzy.in");
  assert.equal((await handler(new Request(edgeUrl))).status, 401);
  assert.equal((await handler(new Request(edgeUrl, { headers: { ...authHeaders, origin: "https://example.invalid" } }))).status, 403);
  const customer = fixture({ edge: true, allowed: false });
  assert.equal((await customer.handler(new Request(edgeUrl, { headers: authHeaders }))).status, 401);
  assert.deepEqual([...customer.creates, ...customer.reads], []);
  assert.deepEqual([...creates, ...reads], []);

  const order = await client.createPosCheckoutOrder(amount);
  assert.equal(order.keyId, "rzp_live_counter");
  assert.equal(order.amount, amount);
  const confirmed = await client.readPosCheckoutStatus(order);
  assert.equal(confirmed.status, "paid");
  assert.equal(confirmed.paymentId, captured.id);
  assert.equal(creates.length, 1);
  assert.equal(reads.length, 2);
});

test("the POS screen uses Checkout and the error icon has its own class", () => {
  const adminPage = read("app/admin/page.tsx");
  const styles = read("app/admin/admin-polish.css");
  assert.match(adminPage, /preparePosCheckout\(/);
  assert.match(adminPage, /posUpi\.status === "paid"/);
  assert.match(adminPage, /const order = attempt\?\.order \?\? await createPosCheckoutOrder\(/);
  assert.doesNotMatch(adminPage, /adminRazorpayApiUrl\("pos-qr"\)/);
  assert.match(styles, /\.pos-upi-qr-error-icon\s*\{/);
  assert.doesNotMatch(styles, /\.pos-upi-qr-error\s*\{/);
});
