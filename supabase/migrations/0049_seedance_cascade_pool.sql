-- 0049 — give Seedance 2.0 its OWN cascade pool.
--
-- Seedance previously shared the `cinema` pool, so admin could not rotate
-- Seedance slots without also moving the Cinema tab. It now has the standard
-- 4 keys every other asset has, editable at /admin/settings → Cascade.
--
-- Also relevant (code, not schema): both the manual Resubmit route and the
-- settle auto-retry path used to bypass the cascade for Seedance entirely
-- with a hardcoded single p1CreateTask call — so a failed Seedance row could
-- only ever retry on p1 and never touched these fallback slots. Those
-- bypasses are removed, so Seedance now cascades + falls back like every
-- other asset, and Resubmit/auto-retry carry the original attachments.
--
-- Defaults mirror lib/cascade-rotation.ts (DEFAULT_SEEDANCE_MAIN/FALLBACK);
-- getSetting() falls back to those in code, so this seeding is for
-- discoverability in the admin UI rather than correctness.

insert into public.app_settings (key, value, description, category) values
  ('seedance_main_count',     '{"count":10}',
   'Seedance 2.0 cascade — number of MAIN slots', 'general'),
  ('seedance_fallback_count', '{"count":10}',
   'Seedance 2.0 cascade — number of FALLBACK slots', 'general'),
  ('seedance_main_slots',
   '{"slots":["p6-a","p6-b","none","none","none","none","none","none","none","none"]}',
   'Seedance 2.0 cascade — MAIN slot order', 'general'),
  ('seedance_fallback_slots',
   '{"slots":["p6-c","p1","none","none","none","none","none","none","none","none"]}',
   'Seedance 2.0 cascade — FALLBACK slot order', 'general')
on conflict (key) do nothing;
