-- 0050 — add p7 (PixelByte / api.muvi.video) as the Seedance 2.0 mini gateway.
--
-- p7 runs Seedance WITHOUT ByteDance's "input image may contain real person"
-- face filter, so AI-face storyboards actually pass (p6/APIPod 403s on faces).
-- Make p7 the PRIMARY Seedance slot; p6 stays as fallback.
--
-- The API key must be set separately (secret — not committed):
--   insert into app_settings (key, value, category)
--   values ('p7_key', '{"key":"YOUR_PIXELBYTE_KEY"}', 'general')
--   on conflict (key) do update set value = excluded.value;

update public.app_settings
set value = '{"slots":["p7","p6-a","none","none","none","none","none","none","none","none"]}'::jsonb
where key = 'seedance_main_slots';

update public.app_settings
set value = '{"slots":["p6-b","p1","none","none","none","none","none","none","none","none"]}'::jsonb
where key = 'seedance_fallback_slots';

-- Seed the rows if they don't exist yet (fresh installs).
insert into public.app_settings (key, value, description, category) values
  ('seedance_main_slots',
   '{"slots":["p7","p6-a","none","none","none","none","none","none","none","none"]}',
   'Seedance 2.0 cascade — MAIN slot order (p7 = PixelByte, no face filter)', 'general'),
  ('seedance_fallback_slots',
   '{"slots":["p6-b","p1","none","none","none","none","none","none","none","none"]}',
   'Seedance 2.0 cascade — FALLBACK slot order', 'general')
on conflict (key) do nothing;
