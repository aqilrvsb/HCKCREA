-- 0037 — Storytelling drafts (resume unfinished wizard sessions).
--
-- Backs the new "Drafts" sub-tab in the Storytelling history grid.
-- When the user clicks Preview in Step 1 of the wizard, the full
-- wizard state is upserted into this table so they can close the
-- browser / switch devices and resume later by clicking the draft
-- card.
--
-- One row = one in-progress story. The `state` JSONB blob holds
-- EVERYTHING the wizard needs to rehydrate:
--   • step (0 / 1 / 2 — which wizard panel was visible)
--   • Step 1 config: prompt, style, tone, language, scene_count,
--     seconds_per_slide, visual_style
--   • Voice: voice_id, voice_speed, enable_voice
--   • CTA: cta_mode, cta_text
--   • Music: music_track_id, voice_volume, music_volume
--   • Animation: transition, scene_animation
--   • Text: enable_text, text_animation, text_placement, font_type,
--           text_size, text_color, uppercase, text_background
--   • Scenes array (per scene: idx, narration, image_prompt, image_url,
--     user_image_url, image_status, image_history_id, animation,
--     transition)
--   • Audio cache map (scene_idx → public audio URL)
--
-- Notes:
--   • We do NOT save the user's File objects or data URLs — only
--     uploaded-to-storage public URLs. Resume can't restore an
--     in-memory upload; the user re-uploads if needed.
--   • title is auto-derived from the first scene's narration on save
--     so the Drafts tab can show a meaningful label without an extra
--     input field.
--   • updated_at is auto-touched by trigger so the Drafts tab can
--     sort by "most recently edited" without the app having to set it.

create table if not exists public.fairytale_drafts (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  project_id      text,                            -- optional project association
  title           text,                            -- auto from first scene narration (or "Untitled draft")
  step            int  not null default 0,         -- 0 / 1 / 2 — last wizard panel
  state           jsonb not null,                  -- full wizard snapshot
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);

-- Index for the Drafts tab query: "my drafts, newest first"
create index if not exists fairytale_drafts_user_idx
  on public.fairytale_drafts(user_id, updated_at desc);

-- RLS — owner can do everything, admin can read all (for support).
alter table public.fairytale_drafts enable row level security;

drop policy if exists "ft_drafts_select_own"   on public.fairytale_drafts;
create policy "ft_drafts_select_own"   on public.fairytale_drafts
  for select using (auth.uid() = user_id);

drop policy if exists "ft_drafts_insert_own"   on public.fairytale_drafts;
create policy "ft_drafts_insert_own"   on public.fairytale_drafts
  for insert with check (auth.uid() = user_id);

drop policy if exists "ft_drafts_update_own"   on public.fairytale_drafts;
create policy "ft_drafts_update_own"   on public.fairytale_drafts
  for update using (auth.uid() = user_id);

drop policy if exists "ft_drafts_delete_own"   on public.fairytale_drafts;
create policy "ft_drafts_delete_own"   on public.fairytale_drafts
  for delete using (auth.uid() = user_id);

drop policy if exists "ft_drafts_select_admin" on public.fairytale_drafts;
create policy "ft_drafts_select_admin" on public.fairytale_drafts
  for select using (public.is_admin_uid(auth.uid()));

-- Auto-bump updated_at on every row mutation so the Drafts tab can
-- order by "last edited" without the API layer having to set it.
create or replace function public.fairytale_drafts_touch_updated()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists fairytale_drafts_touch_updated_trg on public.fairytale_drafts;
create trigger fairytale_drafts_touch_updated_trg
  before update on public.fairytale_drafts
  for each row execute function public.fairytale_drafts_touch_updated();
