-- 0017 — extension auto-post support
--
-- The PeningLab Chrome extension reads recent UGC + Auto Content videos
-- for the signed-in user, posts them to TikTok Studio, and flips a flag
-- so we can show "Posted" / "Not Posted" badges next time the extension
-- opens. This migration adds:
--   1. app_settings rows for extension_version + extension_download_url
--      (admin sets in /admin → image 3 reference). Extension blocks
--      itself when its bundled version != admin's setting.
--   2. history.posted_to_tiktok BOOLEAN — flipped when the extension
--      finishes the auto-post flow for that row. Pure UI state for the
--      extension; doesn't affect generation/billing.
--   3. history.posted_at TIMESTAMPTZ — when the post landed. Useful
--      for the extension's history sort + later analytics.

insert into public.app_settings (key, value, description, category)
values
  ('extension_version',
   jsonb_build_object('value', '3.0.0'),
   'Current PeningLab Chrome extension version. Extension prompts users to update if their bundled version is older.',
   'general'),
  ('extension_download_url',
   jsonb_build_object('url', ''),
   'Public download URL for the extension (Google Drive / direct link). Shown in the dashboard so clients can install.',
   'general')
on conflict (key) do nothing;

alter table public.history
  add column if not exists posted_to_tiktok boolean default false not null;

alter table public.history
  add column if not exists posted_at timestamptz;

-- Index for the extension's "show me my unposted videos" queries.
create index if not exists history_posted_idx
  on public.history (user_id, posted_to_tiktok, created_at desc);
