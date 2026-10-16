import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const helperSource = await readFile(new URL("../lib/pos-cash-payment.ts", import.meta.url), "utf8");
const helperExports = {};
new Function("exports", ts.transpileModule(helperSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(helperExports);
const { calculateCashPayment, formatPosCurrency } = helperExports;

test("cash received covers the bill and returns only the excess", () => {
  assert.deepEqual(calculateCashPayment(55, "100"), {
    receivedPaise: 10000, changePaise: 4500, shortfallPaise: 0, canConfirm: true,
  });
  assert.deepEqual(calculateCashPayment(55, "55"), {
    receivedPaise: 5500, changePaise: 0, shortfallPaise: 0, canConfirm: true,
  });
  assert.deepEqual(calculateCashPayment(55, "50"), {
    receivedPaise: 5000, changePaise: 0, shortfallPaise: 500, canConfirm: false,
  });
});

test("cash calculation preserves paise and avoids floating point shortfalls", () => {
  assert.deepEqual(calculateCashPayment(55.55, "100"), {
    receivedPaise: 10000, changePaise: 4445, shortfallPaise: 0, canConfirm: true,
  });
  assert.equal(calculateCashPayment(55.55, "55.55").canConfirm, true);
  assert.equal(calculateCashPayment(0.1 + 0.2, ".30").shortfallPaise, 0);
  assert.equal(calculateCashPayment(0.1 + 0.2, ".30").canConfirm, true);
  assert.equal(calculateCashPayment(55.55, "55.54").shortfallPaise, 1);
  assert.equal(formatPosCurrency(55.55), "₹55.55");
  assert.equal(formatPosCurrency(44.5), "₹44.50");
  assert.equal(formatPosCurrency(100000), "₹1,00,000");
});

test("invalid cash input cannot be confirmed or presented as change", () => {
  for (const received of ["", "   ", "abc", "-1", "NaN", "Infinity", "55.001", "1e2", "1..2", "9007199254740991"]) {
    const payment = calculateCashPayment(55, received);
    assert.equal(payment.canConfirm, false, received);
    assert.equal(payment.receivedPaise, null, received);
    assert.equal(payment.changePaise, null, received);
  }
  for (const total of [NaN, Infinity, -1, Number.MAX_VALUE]) {
    assert.equal(calculateCashPayment(total, "100").canConfirm, false, String(total));
  }
});

test("a fully discounted bill requires an explicit zero instead of an empty field", () => {
  assert.equal(calculateCashPayment(0, "").canConfirm, false);
  assert.deepEqual(calculateCashPayment(0, "0"), {
    receivedPaise: 0, changePaise: 0, shortfallPaise: 0, canConfirm: true,
  });
});

// Execute the real sale handler with local storage and stock/order APIs isolated.
const pageSource = await readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
const pageAst = ts.createSourceFile("admin.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const workspace = pageAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "PosWorkspace");
let saleHandler;
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(pageAst) === "completeSale") saleHandler = node.initializer;
  ts.forEachChild(node, visit);
};
visit(workspace);
assert.ok(saleHandler, "POS completion handler must exist");
const saleCode = ts.transpileModule(`return (${saleHandler.getText(pageAst)});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function saleHarness({ cashDialogOpen = true, stockGate } = {}) {
  const writes = [];
  const state = { dialogOpen: cashDialogOpen, error: "", busy: false, lastSale: null, change: null };
  const product = { sku: "TEST-RING", name: "Test ring", price: "₹55", stock: 10, status: "Published", variants: [] };
  const selection = { sku: product.sku, productName: product.name, price: product.price, stock: product.stock, image: "/ring.png" };
  const dependencies = {
    cartLines: [{ product, selection, quantity: 1 }],
    products: [product],
    checkoutBusyRef: { current: false },
    paymentMethod: "Cash", total: 55, discount: 0, cashDialogOpen,
    calculateCashPayment, formatPosCurrency, filterVisibleOrders: (orders) => orders,
    upiPaymentConfirmed: false, posQr: { status: "idle" }, posQrRef: { current: { status: "idle" } }, posOrderIdRef: { current: "" },
    customerName: "", customerPhone: "", isSupabaseReady: true,
    decrementCatalogStock: async (lines) => { writes.push({ kind: "stock", lines }); if (stockGate) await stockGate; return { error: null }; },
    hasSellableStock: (stock) => stock > 0,
    setProducts: () => {},
    persistCatalog: (rows) => { writes.push({ kind: "catalog", rows }); },
    saveProductVariants: async () => {}, saveProductSizeStock: async () => {},
    fetchStoreOrders: async () => ({ data: [], error: null }),
    saveStoreOrders: async (orders) => { writes.push({ kind: "orders", orders }); return null; },
    window: {
      localStorage: { getItem: () => null, setItem: (key, value) => { writes.push({ kind: "local", key, value }); } },
      dispatchEvent: () => {}, requestAnimationFrame: (callback) => callback(),
    },
    inputRef: { current: { focus: () => {} } },
    setError: (value) => { state.error = value; },
    setCashDialogOpen: (value) => { state.dialogOpen = value; },
    setCheckoutBusy: (value) => { state.busy = value; },
    setCart: () => {}, setDiscountValue: () => {}, setCustomerName: () => {}, setCustomerPhone: () => {}, setLastProduct: () => {}, setPosQr: () => {},
    setLastSale: (order) => { state.lastSale = order; },
    setLastCashChange: (value) => { state.change = value; },
    onNotify: () => {},
  };
  const completeSale = new Function(...Object.keys(dependencies), saleCode)(...Object.values(dependencies));
  return { completeSale, writes, state };
}

test("Pay Cash opens confirmation without writing an order or deducting stock", async () => {
  const sale = saleHarness({ cashDialogOpen: false });
  await sale.completeSale();
  assert.equal(sale.state.dialogOpen, true);
  assert.equal(sale.state.busy, false);
  assert.deepEqual(sale.writes, []);
});

test("cash confirmation rejects insufficient amounts and bypasses without any writes", async () => {
  for (const received of ["", "50", "-100", "100.001"]) {
    const sale = saleHarness();
    await sale.completeSale(received);
    assert.deepEqual(sale.writes, [], received);
    assert.ok(sale.state.error, received);
    assert.equal(sale.state.dialogOpen, true);
  }
  const closed = saleHarness({ cashDialogOpen: false });
  await closed.completeSale("100");
  assert.deepEqual(closed.writes, []);
  assert.ok(closed.state.error);
});

test("confirmed cash saves the itemized bill once even when confirmation is submitted twice", async () => {
  let releaseStock;
  const stockGate = new Promise((resolve) => { releaseStock = resolve; });
  const sale = saleHarness({ stockGate });
  const first = sale.completeSale("100");
  const duplicate = sale.completeSale("100");
  assert.equal(sale.state.busy, true);
  assert.equal(sale.writes.filter((write) => write.kind === "stock").length, 1);
  releaseStock();
  await Promise.all([first, duplicate]);
  assert.equal(sale.state.error, "");
  assert.equal(sale.writes.filter((write) => write.kind === "orders").length, 1);
  assert.equal(sale.state.lastSale.total, "₹55");
  assert.equal(sale.state.lastSale.paymentStatus, "cod_collected");
  assert.equal(sale.state.lastSale.items[0].productId, "TEST-RING");
  assert.equal(sale.state.lastSale.items[0].quantity, 1);
  assert.equal(sale.state.change, 45);
  assert.equal(sale.state.dialogOpen, false);
  assert.equal(sale.state.busy, false);
});
