-- 0033_attachments.sql
-- Per-user attachment library: images uploaded once, picked from every tab.
--
-- Backed by Backblaze B2 (peninglab-storage bucket, public S3 URLs).
-- Key layout: attachments/{user_id}/{id}.{ext}
--
-- Reads are RLS-scoped to auth.uid() = user_id. Writes happen server-side
-- via the service role inside /api/attachments/upload.

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  b2_key text not null,
  public_url text not null,
  content_type text not null,
  size_bytes bigint not null,
  width int,
  height int,
  created_at timestamptz default now()
);

create index if not exists attachments_user_created_idx
  on public.attachments (user_id, created_at desc);

alter table public.attachments enable row level security;

drop policy if exists "attachments_select_own" on public.attachments;
create policy "attachments_select_own" on public.attachments
  for select using (auth.uid() = user_id);

drop policy if exists "attachments_update_own" on public.attachments;
create policy "attachments_update_own" on public.attachments
  for update using (auth.uid() = user_id);

drop policy if exists "attachments_delete_own" on public.attachments;
create policy "attachments_delete_own" on public.attachments
  for delete using (auth.uid() = user_id);
