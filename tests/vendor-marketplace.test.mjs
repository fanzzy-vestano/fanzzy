import assert from "node:assert/strict";
import test from "node:test";
import { allocateProRata, calculateCommission, groupOrderItemsByVendor, resolveCommissionRule, slugifyVendorName } from "../lib/vendor-marketplace.ts";

test("vendor slugs are stable and public-safe", () => {
  assert.equal(slugifyVendorName("Asha & Co. Jewellery"), "asha-co-jewellery");
});

test("discount allocation is proportional and sums exactly", () => {
  const values = allocateProRata(10, [30, 70]);
  assert.deepEqual(values, [3, 7]);
  assert.equal(values.reduce((sum, value) => sum + value, 0), 10);
});

test("commission priority and vendor net are calculated from discounted product amount", () => {
  const rule = resolveCommissionRule({ product: { source: "product", mode: "percentage", rate: 20, fixedAmount: 0 }, vendor: { source: "vendor", mode: "percentage", rate: 5, fixedAmount: 0 }, global: { source: "global", mode: "percentage", rate: 1, fixedAmount: 0 } });
  const result = calculateCommission({ grossProductAmount: 100, allocatedDiscount: 10, rule });
  assert.equal(result.commissionAmount, 18);
  assert.equal(result.vendorNetAmount, 72);
});

test("mixed legacy order lines are grouped into vendor and platform sub-orders", () => {
  const groups = groupOrderItemsByVendor({ id: "#FZ-1", total: "₹300", items: [
    { productId: "sku-a", name: "A", quantity: 1, price: "₹100" },
    { productId: "sku-b", name: "B", quantity: 2, price: "₹100" },
  ] }, { "sku-a": { vendorId: "vendor-a", vendorName: "A" }, "sku-b": { vendorId: null } });
  assert.equal(groups.length, 2);
  assert.equal(groups.find((group) => group.vendorId === "vendor-a")?.itemTotal, 100);
  assert.equal(groups.find((group) => group.vendorId === null)?.itemTotal, 200);
});
