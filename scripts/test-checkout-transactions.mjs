// Disposable PostgreSQL, localhost only. DATABASE_URL/PGHOST and .env files are
// deliberately ignored. No Supabase or Razorpay credentials are used.
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

const root = resolve(import.meta.dirname, "..");
const runtime = resolve(process.env.FANZZY_TEST_PG_RUNTIME || join(root, "../../../payment-audit-2026-10-19/db-test/node_modules"));
const { initdb, pg_ctl } = await import(pathToFileURL(join(runtime, "@embedded-postgres/windows-x64/dist/index.js")));
const { default: pg } = await import(pathToFileURL(join(runtime, "pg/lib/index.js")));
const data = join(root, "work", `checkout-fixtures-${randomUUID()}`);
if (relative(root, data).startsWith("..")) throw new Error("Test database must stay inside the workspace");
await mkdir(data, { recursive: true });
const server = createServer();
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
console.log("Initializing disposable localhost PostgreSQL fixture");
execFileSync(initdb, ["-D", data, "-U", "postgres", "-A", "trust", "--encoding=UTF8", "--locale=C"], { stdio: "pipe", timeout: 60000 });
let started = false;
const pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", database: "postgres", password: "", ssl: false, max: 32, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
try {
  // Windows server children can inherit anonymous pipes and keep spawnSync
  // waiting after pg_ctl has exited. A file log and ignored standard handles
  // keep this bounded while preserving the server diagnostics.
  execFileSync(pg_ctl, ["-D", data, "-l", join(data, "fixture-server.log"), "-o", `-h 127.0.0.1 -p ${port} -c max_connections=64`, "-w", "start"], { stdio: "ignore", timeout: 60000, windowsHide: true });
  started = true;
  console.log("Applying checkout migration to empty fixture database");
  await pool.query(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.jwt() returns jsonb language sql as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to public;
    create table public.store_settings(key text primary key,value text not null,updated_at timestamptz default now());
    create table public.products(sku text primary key,name text default 'Fixture',price numeric(12,2) not null,stock integer not null check(stock>=0),status text not null default 'Published',updated_at timestamptz default now());
    alter table public.store_settings enable row level security;
    alter table public.products enable row level security;
    grant all on public.store_settings,public.products to anon,authenticated;
    create policy "Fanzzy settings are public" on public.store_settings for all to anon,authenticated using(true) with check(true);
    create policy "Fanzzy products are public" on public.products for all to anon,authenticated using(true) with check(true);
  `);
  await pool.query(await readFile(join(root, "supabase/migrations/20261019_transactional_checkout.sql"), "utf8"));
  const onlineOffersMigration = await readFile(join(root, "supabase/migrations/20261028_online_sales_promotions.sql"), "utf8");
  await pool.query(onlineOffersMigration);
  await pool.query(onlineOffersMigration);
  const { runTransactionTests } = await import("../tests/checkout-transactions.integration.mjs");
  await runTransactionTests(pool);
  const { runOnlineOfferTransactionTests } = await import("../tests/online-offers-transactions.integration.mjs");
  await runOnlineOfferTransactionTests(pool);
} finally {
  await pool.end();
  if (started) execFileSync(pg_ctl, ["-D", data, "-m", "fast", "-w", "stop"], { stdio: "ignore", timeout: 30000, windowsHide: true });
}
