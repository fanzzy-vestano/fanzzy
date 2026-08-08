create table if not exists public.products (
  sku text primary key,
  name text not null,
  category text not null default 'Uncategorised',
  stock integer not null default 0,
  price numeric(12, 2) not null default 0,
  status text not null default 'Draft',
  image text not null default '',
  hover_image text,
  compare_at numeric(12, 2),
  tag text,
  tone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  name text primary key,
  pieces integer not null default 0,
  image text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.store_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.products enable row level security;
alter table public.categories enable row level security;
alter table public.store_settings enable row level security;

drop policy if exists "Fanzzy products are public" on public.products;
create policy "Fanzzy products are public" on public.products for all to anon, authenticated using (true) with check (true);

drop policy if exists "Fanzzy categories are public" on public.categories;
create policy "Fanzzy categories are public" on public.categories for all to anon, authenticated using (true) with check (true);

drop policy if exists "Fanzzy settings are public" on public.store_settings;
create policy "Fanzzy settings are public" on public.store_settings for all to anon, authenticated using (true) with check (true);

insert into public.products (sku, name, category, stock, price, status, image, hover_image, compare_at, tag, tone)
values
  ('LST-AUR-01', 'Aurora Drop Earrings', 'Earrings', 24, 1290, 'Published', 'https://images.unsplash.com/photo-1635767798638-3e25273a8236?auto=format&fit=crop&w=900&q=85', 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=900&q=85', 1690, 'Bestseller', '#d9c4bc'),
  ('LST-SOL-02', 'Solstice Tennis Necklace', 'Necklaces', 8, 2480, 'Low stock', 'https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=900&q=85', 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=900&q=85', null, 'New in', '#dad7ce'),
  ('LST-MUS-03', 'Muse Sculpted Cuff', 'Bracelets', 0, 1860, 'Draft', 'https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=900&q=85', 'https://images.unsplash.com/photo-1573408301185-9146fe634ad0?auto=format&fit=crop&w=900&q=85', 2200, 'Limited', '#d0c2b0'),
  ('LST-ORB-04', 'Orbital Pearl Ring', 'Rings', 41, 990, 'Published', 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=900&q=85', 'https://images.unsplash.com/photo-1603561596112-0a132b757442?auto=format&fit=crop&w=900&q=85', null, null, '#e5ddd1')
on conflict (sku) do nothing;

insert into public.categories (name, pieces, sort_order, image)
values
  ('Earrings', 42, 1, 'https://images.unsplash.com/photo-1635767798638-3e25273a8236?auto=format&fit=crop&w=700&q=85'),
  ('Necklaces', 28, 2, 'https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=700&q=85'),
  ('Bracelets', 18, 3, 'https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=700&q=85'),
  ('Rings', 24, 4, 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=700&q=85')
on conflict (name) do nothing;

insert into public.store_settings (key, value)
values
  ('announcement', 'Complimentary shipping on orders above ₹999'),
  ('hero_image', 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=1200&q=90')
on conflict (key) do nothing;

insert into storage.buckets (id, name, public)
values ('fanzzy-assets', 'fanzzy-assets', true)
on conflict (id) do update set public = true;

drop policy if exists "Fanzzy assets are publicly readable" on storage.objects;
create policy "Fanzzy assets are publicly readable" on storage.objects for select to anon, authenticated using (bucket_id = 'fanzzy-assets');

drop policy if exists "Fanzzy assets can be uploaded" on storage.objects;
create policy "Fanzzy assets can be uploaded" on storage.objects for insert to anon, authenticated with check (bucket_id = 'fanzzy-assets');

drop policy if exists "Fanzzy assets can be updated" on storage.objects;
create policy "Fanzzy assets can be updated" on storage.objects for update to anon, authenticated using (bucket_id = 'fanzzy-assets') with check (bucket_id = 'fanzzy-assets');
