-- ============================================================================
-- 0004 — Saved Prompts library
--
-- Every successful generation auto-saves its prompt here so users can:
--   • Browse a personal prompt library by project
--   • Star their best wins (those become memory for the AI agents)
--   • Recreate variants of past hits with one click
--
-- Linked to history (so the user can see "this prompt produced THIS video")
-- and to projects (so prompts are scoped per campaign).
-- ============================================================================

create table if not exists public.saved_prompts (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete set null,
  history_id      uuid references public.history(id) on delete cascade,

  -- The actual prompt that fired (post-edits if user adjusted in confirmation dialog)
  prompt_text     text not null,

  -- Where it came from
  bucket          text not null,        -- 'ugc' | 'cinema' | 'image' | 'auto'
  model           text,                  -- 'veo-r2v' | 'grok-i2v' | 'banana-pro' | 'gpt-image-2' etc.
  scene_template  text,                  -- 'Kitchen · Sambal' if a scene template was used; null otherwise
  reference_url   text,                  -- product / character ref image used (if any)

  -- Generation params snapshot (so Recreate works without ambiguity)
  duration        int,                   -- seconds (video) or null (image)
  aspect_ratio    text,                  -- '9:16' / '1:1' / '16:9'
  cost            numeric(12,2) default 0 not null,

  -- Outcome
  outcome         text default 'success' not null,  -- 'success' | 'failed'

  -- User curation
  starred         boolean default false not null,   -- "this is my winner — agent should learn from it"
  user_notes      text,                              -- optional annotation ("converted 12% on TikTok")

  -- Source — was this saved automatically after a generation, or manually by the user?
  source          text default 'auto' not null,     -- 'auto' | 'manual' | 'agent'

  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);

create index if not exists saved_prompts_user_idx
  on public.saved_prompts(user_id, created_at desc);

create index if not exists saved_prompts_project_idx
  on public.saved_prompts(project_id, created_at desc)
  where project_id is not null;

create index if not exists saved_prompts_starred_idx
  on public.saved_prompts(user_id, starred, created_at desc)
  where starred = true;

create index if not exists saved_prompts_bucket_idx
  on public.saved_prompts(user_id, bucket, created_at desc);

drop trigger if exists saved_prompts_touch on public.saved_prompts;
create trigger saved_prompts_touch
  before update on public.saved_prompts
  for each row execute function public.touch_updated_at();

alter table public.saved_prompts enable row level security;

drop policy if exists "saved_prompts_select_own" on public.saved_prompts;
create policy "saved_prompts_select_own" on public.saved_prompts
  for select using (auth.uid() = user_id);

drop policy if exists "saved_prompts_modify_own" on public.saved_prompts;
create policy "saved_prompts_modify_own" on public.saved_prompts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill — copy prompts from existing history rows that are 'done' so the
-- user's first visit to /saved-prompts isn't empty.
-- One-shot insert; subsequent ingestion happens via the auto-save in the
-- generate routes.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.saved_prompts
  (user_id, project_id, history_id, prompt_text, bucket, model, reference_url,
   duration, aspect_ratio, cost, outcome, source)
select
  h.user_id,
  h.project_id,
  h.id,
  h.prompt,
  case
    when h.tab = 'video'  then 'ugc'
    when h.tab = 'cinema' then 'cinema'
    when h.tab = 'image'  then 'image'
    when h.tab = 'auto'   then 'auto'
    when h.tab = 'clone'  then 'ugc'
    else 'ugc'
  end,
  coalesce(h.metadata->>'model', null),
  h.reference_url,
  h.duration,
  coalesce(h.metadata->>'aspectRatio', h.metadata->>'aspect_ratio'),
  h.cost,
  h.status,
  'auto'
from public.history h
where h.status = 'done'
  and h.prompt is not null
  and trim(h.prompt) <> ''
  and not exists (
    select 1 from public.saved_prompts sp where sp.history_id = h.id
  );
