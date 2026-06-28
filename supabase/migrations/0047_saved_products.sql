-- Saved product presets for Auto Content. Lightweight mapping so clients
-- never re-pick/re-type: a product (affiliate link OR manual name) remembers
-- its name, detail, and the 3 attachment URLs (the images already live in the
-- user's Attachments library — we only store the references here).
create table if not exists public.saved_products (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('affiliate', 'manual')),
  product_id   text,            -- TikTok/Shopee product_id (affiliate); null for manual
  product_name text not null,
  detail       text,
  attachments  jsonb not null default '[]'::jsonb,  -- array of attachment image URLs
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One saved record per affiliate product per user, and per manual name per user.
create unique index if not exists saved_products_affiliate_uniq
  on public.saved_products (user_id, product_id) where kind = 'affiliate';
create unique index if not exists saved_products_manual_uniq
  on public.saved_products (user_id, lower(product_name)) where kind = 'manual';

create index if not exists saved_products_user_idx on public.saved_products (user_id, updated_at desc);

alter table public.saved_products enable row level security;

drop policy if exists "own saved products" on public.saved_products;
create policy "own saved products" on public.saved_products
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
