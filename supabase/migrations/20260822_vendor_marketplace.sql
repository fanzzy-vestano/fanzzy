-- Additive vendor marketplace migration.
-- Existing products, store_settings orders, customers, and platform workflows
-- remain valid. Existing products keep vendor_id NULL and remain platform items.

create extension if not exists pgcrypto;

create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  business_name text not null,
  owner_name text not null default '',
  login_email text not null unique,
  phone text not null default '',
  whatsapp text not null default '',
  logo_url text,
  cover_url text,
  description text not null default '',
  address text not null default '',
  city text not null default '',
  state text not null default '',
  pin_code text not null default '',
  gst_number text not null default '',
  pan_number text not null default '',
  status text not null default 'Active' check (status in ('Active', 'Suspended', 'Inactive')),
  store_visibility text not null default 'Hidden' check (store_visibility in ('Visible', 'Hidden')),
  featured boolean not null default false,
  commission_mode text not null default 'percentage' check (commission_mode in ('percentage', 'fixed')),
  commission_rate numeric(12,2) not null default 0,
  commission_fixed numeric(12,2) not null default 0,
  automatic_approval boolean not null default false,
  session_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_users (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null unique references public.vendors(id) on delete cascade,
  email text not null unique,
  password_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null unique references public.vendors(id) on delete cascade,
  account_holder_name text not null default '',
  account_number text not null default '',
  bank_name text not null default '',
  branch_name text not null default '',
  ifsc_code text not null default '',
  upi_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_commission_rules (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('global', 'vendor', 'category', 'product')),
  scope_id text,
  mode text not null default 'percentage' check (mode in ('percentage', 'fixed')),
  rate numeric(12,2) not null default 0,
  fixed_amount numeric(12,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope_type, scope_id)
);

create table if not exists public.vendor_sessions (
  id uuid primary key default gen_random_uuid(),
  vendor_user_id uuid not null references public.vendor_users(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  token_hash text not null unique,
  session_version integer not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.products add column if not exists vendor_id uuid references public.vendors(id) on delete set null;
alter table public.products add column if not exists vendor_status text;
alter table public.products add column if not exists vendor_rejection_reason text;
alter table public.products add column if not exists public_vendor_visible boolean not null default true;
alter table public.products add column if not exists low_stock_limit integer not null default 5;

create table if not exists public.vendor_orders (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references public.vendors(id) on delete set null,
  main_order_id text not null,
  sub_order_number text not null unique,
  order_date timestamptz not null default now(),
  customer_snapshot jsonb not null default '{}'::jsonb,
  gross_product_amount numeric(12,2) not null default 0,
  allocated_discount numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  shipping_amount numeric(12,2) not null default 0,
  refund_amount numeric(12,2) not null default 0,
  commission_rate numeric(12,2) not null default 0,
  commission_mode text not null default 'percentage',
  commission_amount numeric(12,2) not null default 0,
  vendor_net_amount numeric(12,2) not null default 0,
  commission_rule_snapshot jsonb not null default '{}'::jsonb,
  payout_eligible_at timestamptz,
  payout_status text not null default 'Not Eligible',
  status text not null default 'New',
  payment_method text not null default '',
  payment_status text not null default 'pending',
  courier_name text,
  tracking_number text,
  tracking_url text,
  return_period_days integer not null default 7,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vendor_id, main_order_id)
);

create table if not exists public.vendor_order_items (
  id uuid primary key default gen_random_uuid(),
  vendor_order_id uuid not null references public.vendor_orders(id) on delete cascade,
  product_sku text not null,
  product_name text not null,
  quantity integer not null default 0,
  unit_price numeric(12,2) not null default 0,
  allocated_discount numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  shipping_amount numeric(12,2) not null default 0,
  refund_amount numeric(12,2) not null default 0,
  commission_amount numeric(12,2) not null default 0,
  vendor_net_amount numeric(12,2) not null default 0,
  product_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.vendor_order_status_history (
  id uuid primary key default gen_random_uuid(),
  vendor_order_id uuid not null references public.vendor_orders(id) on delete cascade,
  actor_type text not null,
  actor_id text,
  from_status text,
  to_status text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.vendor_payouts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  payout_number text not null unique,
  status text not null default 'Pending',
  amount numeric(12,2) not null default 0,
  payment_method text not null default '',
  transaction_reference text,
  payout_date timestamptz,
  payment_proof_url text,
  adjustment_amount numeric(12,2) not null default 0,
  adjustment_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_payout_items (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.vendor_payouts(id) on delete cascade,
  vendor_order_id uuid not null unique references public.vendor_orders(id) on delete restrict,
  amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.vendor_notifications (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.vendor_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null,
  actor_id text,
  vendor_id uuid references public.vendors(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists vendors_status_visibility_idx on public.vendors(status, store_visibility);
create index if not exists vendors_slug_idx on public.vendors(slug);
create index if not exists vendor_users_email_idx on public.vendor_users(email);
create index if not exists vendor_sessions_token_hash_idx on public.vendor_sessions(token_hash);
create index if not exists vendor_commission_rules_scope_idx on public.vendor_commission_rules(scope_type, scope_id, active);
create index if not exists products_vendor_id_idx on public.products(vendor_id);
create index if not exists products_vendor_status_idx on public.products(vendor_status, public_vendor_visible);
create index if not exists vendor_orders_vendor_id_idx on public.vendor_orders(vendor_id, created_at desc);
create index if not exists vendor_orders_main_order_idx on public.vendor_orders(main_order_id);
create index if not exists vendor_order_items_product_idx on public.vendor_order_items(product_sku);
create index if not exists vendor_order_history_order_idx on public.vendor_order_status_history(vendor_order_id, created_at desc);
create index if not exists vendor_payouts_vendor_status_idx on public.vendor_payouts(vendor_id, status, created_at desc);
create index if not exists vendor_notifications_vendor_idx on public.vendor_notifications(vendor_id, created_at desc);
create index if not exists vendor_audit_logs_vendor_idx on public.vendor_audit_logs(vendor_id, created_at desc);

alter table public.vendors enable row level security;
alter table public.vendor_users enable row level security;
alter table public.vendor_bank_accounts enable row level security;
alter table public.vendor_sessions enable row level security;
alter table public.vendor_commission_rules enable row level security;
alter table public.vendor_orders enable row level security;
alter table public.vendor_order_items enable row level security;
alter table public.vendor_order_status_history enable row level security;
alter table public.vendor_payouts enable row level security;
alter table public.vendor_payout_items enable row level security;
alter table public.vendor_notifications enable row level security;
alter table public.vendor_audit_logs enable row level security;

drop policy if exists "Public can view visible vendors" on public.vendors;
create policy "Public can view visible vendors" on public.vendors for select to anon, authenticated using (status = 'Active' and store_visibility = 'Visible');

drop policy if exists "Fanzzy public products preserve platform catalog" on public.products;
drop policy if exists "Fanzzy products are public" on public.products;
create policy "Fanzzy public products preserve platform catalog" on public.products for select to anon, authenticated using (vendor_id is null or (public_vendor_visible = true and vendor_status = 'Approved'));
drop policy if exists "Fanzzy platform catalog writes" on public.products;
create policy "Fanzzy platform catalog writes" on public.products for all to anon, authenticated using (vendor_id is null or (public_vendor_visible = true and vendor_status = 'Approved')) with check (vendor_id is null or (public_vendor_visible = true and vendor_status = 'Approved'));

-- No browser role receives access to vendor credentials, sessions, financials,
-- order mappings, notifications, or audit rows. Server routes use the service
-- role and enforce admin/vendor authorization before every query.

-- Rollback (run only after exporting vendor data):
-- drop table if exists public.vendor_audit_logs, public.vendor_notifications,
-- public.vendor_payout_items, public.vendor_payouts, public.vendor_order_items,
-- public.vendor_orders, public.vendor_sessions, public.vendor_bank_accounts,
-- public.vendor_order_status_history, public.vendor_commission_rules,
-- public.vendor_users, public.vendors cascade;
-- alter table public.products drop column if exists vendor_id;
-- alter table public.products drop column if exists vendor_status;
-- alter table public.products drop column if exists vendor_rejection_reason;
-- alter table public.products drop column if exists public_vendor_visible;
-- alter table public.products drop column if exists low_stock_limit;
