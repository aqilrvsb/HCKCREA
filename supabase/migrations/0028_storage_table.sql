-- 0028 — permanent user storage (B2-backed) + admin quota setting.
--
-- The `storage` table is the persistent index of files a user has saved
-- from their temporary Crun history rows into their B2 folder. Each row
-- maps a B2 object key to its source history row + bytes used for the
-- per-user quota check.
--
-- Why a separate table (vs putting `b2_key` on history): a single history
-- row can be saved to storage once (one-to-one) but the storage record
-- needs to outlive the history row (history rows can be deleted to free
-- the dashboard grid while keeping the file in storage). FK to history
-- with on delete set null preserves the storage row when history goes.

create table if not exists public.storage (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  history_id      uuid references public.history(id) on delete set null,
  type            text not null,                   -- image / video / fairytale / ugc / auto / cinema / clone
  b2_bucket       text not null,                   -- usually peninglab-storage
  b2_key          text not null unique,            -- users/{user_id}/{type}/{history_id}.{ext}
  size_bytes      bigint not null default 0,
  content_type    text,                            -- video/mp4 / image/png / etc.
  source_url      text,                            -- the temp Crun URL we copied from (for audit)
  cached_url      text,                            -- last-issued signed URL (frontend uses; refreshed on demand)
  cached_url_exp  timestamptz,                     -- when cached_url stops working
  created_at      timestamptz default now() not null
);

create index if not exists storage_user_idx on public.storage(user_id, created_at desc);
create index if not exists storage_history_idx on public.storage(history_id);

alter table public.storage enable row level security;

drop policy if exists "storage_select_own" on public.storage;
create policy "storage_select_own" on public.storage
  for select using (auth.uid() = user_id);

drop policy if exists "storage_select_admin" on public.storage;
create policy "storage_select_admin" on public.storage
  for select using (public.is_admin_uid(auth.uid()));

drop policy if exists "storage_delete_own" on public.storage;
create policy "storage_delete_own" on public.storage
  for delete using (auth.uid() = user_id);

-- Inserts/updates done server-side via service role (B2 ops + signed URL
-- caching) so no insert/update policies needed.

-- Admin-tunable per-user quota. Defaults to 1024 MB = 1 GB per user.
-- Pro users could later get a larger quota via a separate plan_quota
-- override; for now everyone shares this number.
insert into public.app_settings (key, value, description, category)
values
  ('storage_quota_per_user_mb', '{"mb":1024}'::jsonb,
    'How many MB of permanent storage each user gets (across all types). Save button blocks once over.',
    'storage')
on conflict (key) do update
  set description = excluded.description,
      category = excluded.category;
