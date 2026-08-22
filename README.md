# Fanzzy

Premium jewellery storefront and control room built with Next.js, TypeScript, Tailwind CSS, and a Cloudflare-compatible Vinext starter.

## Getting started

1. Copy `.env.example` to `.env.local` and add service credentials when connecting a database, image storage, analytics, or Razorpay.
2. Install dependencies with `pnpm install`.
3. Run `pnpm dev` and open the local URL.
4. Visit `/` for the storefront and `/admin` for the merchant control room.

## Razorpay checkout

The checkout uses Razorpay Standard Checkout. Add the API credentials from Razorpay Dashboard → Account & Settings → API Keys to `.env.local`:

```env
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
```

Use test keys while validating payments. `RAZORPAY_KEY_SECRET` is server-only and must never be exposed as a `NEXT_PUBLIC_` variable or committed to source control. The server creates the Razorpay order and verifies the returned payment signature before saving the customer order.

## Product direction

The current implementation is a polished, interactive vertical slice with a centralized visual system. Storefront interactions include category filtering, search, wishlist, quick view, cart drawer, quantity changes, promo-code copy, newsletter signup, and responsive mobile layout. The admin surface includes catalog search, inventory health, revenue visualization, order status, tasks, campaign status, and navigation scaffolding for catalog, orders, customers, marketing, homepage, and settings.

## Production extension points

The UI is ready to connect to Prisma/Drizzle models for products, variants, inventory, carts, orders, coupons, shipping rules, reviews, banners, homepage sections, and audit logs. Keep secrets in environment variables and perform authoritative pricing, coupon, inventory, and payment verification on the server.

## Vendor marketplace

The additive vendor module is defined in `supabase/migrations/20260822_vendor_marketplace.sql`. Apply it to the existing Supabase project after the current schema. It adds nullable vendor ownership to products and normalized vendor operational tables; existing platform products remain `vendor_id = NULL` and existing `store_settings.orders` records are preserved.

Server deployment requirements:

- `SUPABASE_SERVICE_ROLE_KEY` for vendor/admin mutations and vendor order projections.
- `VENDOR_AUTH_SECRET` (or the existing `ADMIN_AUTH_SECRET`/`AUTH_SECRET`) for HTTP-only vendor sessions.
- `VENDOR_DATA_ENCRYPTION_KEY` for encrypted bank account numbers.

Vendor routes:

- Public: `/vendors`, `/vendors/{vendor-slug}`
- Vendor: `/vendor/login`, `/vendor`
- Admin: `/admin` → `Vendors` workspace
- Server APIs: `/api/vendors`, `/api/vendor-auth/*`, `/api/vendor/*`, `/api/admin/vendors/*`, `/api/admin/vendor-payouts`

Vendor product visibility requires an active vendor, `store_visibility = Visible`, `vendor_status = Approved`, and `public_vendor_visible = true`. Commission resolution is product → category → vendor → global; the resolved rule and resulting monetary values are snapshotted on each vendor order. Payout creation accepts only delivered vendor orders and uses the unique `vendor_payout_items.vendor_order_id` constraint to prevent duplicate payouts.

## GitHub Pages customer OTP

GitHub Pages serves the storefront statically and cannot execute the app's `/api/customer-auth` routes. The static build therefore uses `CUSTOMER_AUTH_API_URL` when it is set, normally:

```text
https://pdrcrkxeyqxqgpwfxqpu.supabase.co/functions/v1/customer-auth
```

Deploy `supabase/functions/customer-auth/index.ts` to the existing Supabase project and configure the function secrets `TWO_FACTOR_API_KEY` and `CUSTOMER_AUTH_SECRET`. The function sends SMS-only OTPs through the approved transactional template. Keep the 2Factor key in the function secrets; never put it in `NEXT_PUBLIC_*` variables or the GitHub Pages build.


