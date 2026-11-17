# Local test database

Run `npm run dev:test -- --hostname 127.0.0.1 --port 3000` from the project folder. The existing `.env.local.test` selects `http://127.0.0.1:3000/local-db`; the launcher starts PostgreSQL, the local REST adapter, and the website together.

The database persists in `.local-test/postgres` (ignored by Git). Initial setup applies the checkout migrations and seeds three published test products. Subsequent starts retain products, offers, and orders. Do not remove this folder if you want to keep that data.

The local API listens on `127.0.0.1:54321`, and PostgreSQL on `127.0.0.1:55432`. The website proxies `/local-db` so admin writes use the signed admin session cookie. Anonymous writes and checkout RPC calls are blocked; server checkout uses the local service key.

This workspace uses PostgreSQL and `pg` from `payment-audit-2026-10-19/db-test/node_modules`. For a different installation, set `FANZZY_TEST_PG_RUNTIME` to a directory containing `pg` and `@embedded-postgres/windows-x64`. The adapter covers catalog/settings storage, checkout RPCs, and vendor marketplace tables. Vendor credentials, sessions, and financial tables require the server service key; public vendor reads expose only visible storefront fields. Supabase Storage uploads and Realtime are not provided.

With the project running, `node scripts/verify-local-database.mjs` verifies admin authentication, protected product/offer writes, customer OTP, a website offer discount, COD checkout, and stock reservation. It removes its own temporary fixtures afterward.

`node scripts/verify-local-vendors.mjs` checks vendor management and report APIs, creates a disposable vendor, verifies vendor login and dashboard APIs, and checks credential privacy. It removes its own vendor and dependent records afterward. Both scripts use the local database and never contact production services. Allow at least a minute between checkout verification runs because OTP requests are rate limited.

Local customer sign-in uses the OTP configured in `.env.local.test`; no SMS is sent. This setup is isolated from production.
