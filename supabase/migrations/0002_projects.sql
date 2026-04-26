-- ============================================================================
-- 0002 — Projects (Higgsfield-style folders for grouping generations)
--   • projects table (max 4 per user — enforced at API layer)
--   • history.project_id + batches.project_id (nullable, set null on delete)
--   • RLS so users only see their own projects
-- ============================================================================

create table if not exists public.projects (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz default now() not null,
  updated_at  timestamptz default now() not null
);

create index if not exists projects_user_idx on public.projects(user_id, created_at desc);

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch
  before update on public.projects
  for each row execute function public.touch_updated_at();

alter table public.projects enable row level security;

drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects
  for select using (auth.uid() = user_id);

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects
  for insert with check (auth.uid() = user_id);

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects
  for update using (auth.uid() = user_id);

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects
  for delete using (auth.uid() = user_id);

-- Add project_id to history + batches (nullable; existing rows stay unscoped)
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='history' and column_name='project_id') then
    alter table public.history add column project_id uuid references public.projects(id) on delete set null;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='batches' and column_name='project_id') then
    alter table public.batches add column project_id uuid references public.projects(id) on delete set null;
  end if;
end $$;

create index if not exists history_project_idx on public.history(project_id, created_at desc) where project_id is not null;
create index if not exists batches_project_idx on public.batches(project_id, created_at desc) where project_id is not null;

-- Admin-tunable project cap. Edit from /admin → app_settings.
insert into public.app_settings (key, value, description, category) values
  ('project_limit', '{"value":4}', 'Max projects each user can create', 'plan')
on conflict (key) do nothing;
