-- Motion "Edit Video" — the seller's product photo gallery. Every product
-- photo a client uploads (browser → Modal → B2, motion-images/<user>/…) is
-- remembered here so it can be reused on the next video or removed.
-- Read / written through /api/motion/photos (service role, ownership checked);
-- RLS on with own-row policies as a second line of defence.
create table if not exists public.motion_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now(),
  unique (user_id, url)
);
create index if not exists motion_photos_user_created_idx on public.motion_photos (user_id, created_at desc);
alter table public.motion_photos enable row level security;
create policy "motion_photos own select" on public.motion_photos for select using (auth.uid() = user_id);
create policy "motion_photos own insert" on public.motion_photos for insert with check (auth.uid() = user_id);
create policy "motion_photos own delete" on public.motion_photos for delete using (auth.uid() = user_id);
