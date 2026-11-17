import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const migration = readFileSync(new URL("../supabase/migrations/20261021_atomic_pos_sales.sql", import.meta.url), "utf8");
const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8").split("insert into public.products")[0];

test("atomic POS migration against local PostgreSQL", async t => {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  await db.exec(schema);
  await db.exec(migration);
  const reset = async (variants = {}, sizes = {}) => {
    await db.exec("truncate public.products, public.store_settings, public.pos_sale_commits;");
    await db.query("insert into public.products(sku,name,stock,price,status) values ('RING','Local ring',10,55,'Published'),('SIZE','Local size',5,20,'Published')");
    for (const [key, value] of Object.entries({ orders: [{ id: "#EXISTING", total: "₹1" }], product_variants: variants, product_size_stock: sizes, product_variant_type: {} })) {
      await db.query("insert into public.store_settings(key,value) values($1,$2)", [key, JSON.stringify(value)]);
    }
  };
  const bill = (id = "#FZ-POS-LOCAL001", extra = {}) => ({ id, date: "2026-10-21", customerName: "Local fixture", posPaymentMethod: "Cash", total: "₹110", couponDiscount: 0, items: [{ productId: "RING", name: "Local ring", quantity: 2, price: "₹55" }], ...extra });
  const commit = async order => (await db.query("select public.commit_pos_sale($1::jsonb) result", [JSON.stringify(order)])).rows[0].result;
  const stock = async sku => (await db.query("select stock from public.products where sku=$1", [sku])).rows[0].stock;
  const setting = async key => JSON.parse((await db.query("select value from public.store_settings where key=$1", [key])).rows[0].value);
  try {
    await t.test("cash order and stock commit together and existing orders survive", async () => {
      await reset();
      const result = await commit(bill());
      assert.equal(await stock("RING"), 8);
      assert.equal(result.order.paymentStatus, "cod_collected");
      assert.equal(result.order.inventoryAdjusted, true);
      assert.equal(result.orders.length, 2);
      assert.equal(result.orders[1].id, "#EXISTING");
      assert.equal(result.products[0].stock, 8);
    });
    await t.test("simultaneous retries and a lost-response replay never double deduct", async () => {
      await reset();
      const results = await Promise.all([commit(bill()), commit(bill()), commit(bill())]);
      assert.equal(await stock("RING"), 8);
      assert.equal(results.filter(r => !r.replayed).length, 1);
      assert.equal((await setting("orders")).length, 2);
      const replay = await commit(bill());
      assert.equal(replay.replayed, true);
      assert.equal(await stock("RING"), 8);
    });
    await t.test("manual card sale preserves discounts and commits stock with its paid bill", async () => {
      await reset();
      const result = await commit(bill("#FZ-POS-CARD001", { posPaymentMethod: "Card", total: "₹100", couponDiscount: 10 }));
      assert.equal(await stock("RING"), 8);
      assert.equal(result.order.paymentStatus, "paid");
      assert.equal(result.order.posPaymentMethod, "Card");
      assert.equal(result.order.total, "₹100");
      assert.equal(result.order.razorpayPaymentId, undefined);
    });
    await t.test("different payload cannot reuse a committed reference", async () => {
      await reset(); await commit(bill());
      await assert.rejects(commit(bill(undefined, { customerName: "Changed" })), /different bill/);
      assert.equal(await stock("RING"), 8);
    });
    await t.test("failure at the order write rolls back earlier stock and variant changes", async () => {
      await reset({ RING: [{ name: "Gold", stock: 4 }] });
      await db.exec("create function public.fail_pos_test() returns trigger language plpgsql as $$ begin if new.key='orders' then raise exception 'Injected order failure'; end if; return new; end $$; create trigger fail_pos_test before update on public.store_settings for each row execute function public.fail_pos_test();");
      try {
        await assert.rejects(commit(bill(undefined, { items: [{ productId: "RING", variantName: "Gold", quantity: 2, price: "₹55" }] })), /Injected order failure/);
        assert.equal(await stock("RING"), 10);
        assert.equal((await setting("product_variants")).RING[0].stock, 4);
        assert.equal((await setting("orders")).length, 1);
        assert.equal((await db.query("select count(*)::integer n from public.pos_sale_commits")).rows[0].n, 0);
      } finally { await db.exec("drop trigger fail_pos_test on public.store_settings; drop function public.fail_pos_test();"); }
    });
    await t.test("late shortage rolls back every earlier line", async () => {
      await reset();
      const order = bill(undefined, { total: "₹330", items: [{ productId: "RING", quantity: 2, price: "₹55" }, { productId: "SIZE", quantity: 11, price: "₹20" }] });
      await assert.rejects(commit(order), /Not enough/);
      assert.equal(await stock("RING"), 10); assert.equal(await stock("SIZE"), 5);
      assert.equal((await setting("orders")).length, 1);
    });
    await t.test("variant and size stocks are committed with the order", async () => {
      await reset({ SIZE: [{ name: "Small", size: "S", stock: 3, image: "" }] }, { SIZE: { S: 3 } });
      const result = await commit(bill(undefined, { total: "₹40", items: [{ productId: "SIZE", size: "S", quantity: 2, price: "₹20" }] }));
      assert.equal((await setting("product_variants")).SIZE[0].stock, 1);
      assert.equal((await setting("product_size_stock")).SIZE.S, 1);
      assert.equal(await stock("SIZE"), 3);
      assert.equal(result.products[0].sizeStock.S, 1);
    });
    await t.test("duplicate variant lines cannot exceed shared stock", async () => {
      await reset({ RING: [{ name: "Gold", stock: 3 }] });
      const item = { productId: "RING", variantName: "Gold", quantity: 2, price: "₹55" };
      await assert.rejects(commit(bill(undefined, { total: "₹220", items: [item, item] })), /Not enough variant/);
      assert.equal(await stock("RING"), 10);
      assert.equal((await setting("product_variants")).RING[0].stock, 3);
    });
    await t.test("invalid totals and unverified UPI are rejected without writes", async () => {
      for (const order of [bill(undefined, { total: "₹1" }), bill(undefined, { couponDiscount: -1 }), bill(undefined, { posPaymentMethod: "UPI" })]) {
        await reset(); await assert.rejects(commit(order));
        assert.equal(await stock("RING"), 10); assert.equal((await setting("orders")).length, 1);
      }
    });
    await t.test("browser roles cannot execute the privileged RPC or read its ledger", async () => {
      for (const role of ["anon", "authenticated"]) {
        await db.exec("set role " + role);
        try {
          await assert.rejects(commit(bill()), /permission denied/);
          await assert.rejects(db.query("select * from public.pos_sale_commits"), /permission denied/);
        } finally { await db.exec("reset role"); }
      }
    });
    const pendingUpi = bill("#FZ-POS-UPI001", { posPaymentMethod: "UPI", paymentStatus: "pending", razorpayOrderId: "order_LOCAL" });
    const savePendingUpi = async () => {
      await reset();
      await db.query("update public.store_settings set value=$1 where key='orders'", [JSON.stringify([pendingUpi, { id: "#EXISTING" }])]);
    };
    const finalizeUpi = async (amount = 11000) => (await db.query("select public.finalize_pos_payment($1,$2,$3) result", ["order_LOCAL", "pay_LOCAL", amount])).rows[0].result;
    await t.test("verified UPI replaces the pending bill and retries never deduct twice", async () => {
      await savePendingUpi();
      const result = await finalizeUpi();
      assert.equal(result.order.paymentStatus, "paid"); assert.equal(result.order.razorpayPaymentId, "pay_LOCAL");
      assert.equal(result.orders.length, 2); assert.equal(await stock("RING"), 8);
      assert.equal((await finalizeUpi()).replayed, true); assert.equal(await stock("RING"), 8);
    });
    await t.test("UPI amount mismatch and write failure preserve pending bill and stock", async () => {
      await savePendingUpi(); await assert.rejects(finalizeUpi(10999), /does not match/);
      assert.equal(await stock("RING"), 10);
      await db.exec("create function public.fail_upi_test() returns trigger language plpgsql as $$ begin if new.key='orders' then raise exception 'Injected UPI order failure'; end if; return new; end $$; create trigger fail_upi_test before update on public.store_settings for each row execute function public.fail_upi_test();");
      try {
        await assert.rejects(finalizeUpi(), /Injected UPI order failure/);
        assert.equal(await stock("RING"), 10);
        assert.equal((await setting("orders"))[0].paymentStatus, "pending");
      } finally { await db.exec("drop trigger fail_upi_test on public.store_settings; drop function public.fail_upi_test();"); }
    });
  } finally { await db.close(); }
});
