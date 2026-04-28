-- 0012 — seed P1 (GeminiGen.AI) settings + per-asset provider toggles
--
-- Adds an alternative gen backend so admin can rotate Crun.ai (p2) and
-- GeminiGen (p1) per asset class without redeploying. Defaults all three
-- toggles to "p2" so existing deployments don't change behaviour until
-- admin flips them in /admin → App Settings.
--
-- Naming follows the original creative-hack-auto convention:
--   p1 = GeminiGen.AI (this migration)
--   p2 = Crun.ai      (already present)
--   p3 = RunningHub   (image upload host, already present)

insert into public.app_settings (key, value, description, category)
values
  -- P1 endpoint config — base URL + key + per-asset paths.
  ('p1_base',
   jsonb_build_object('url', 'https://api.geminigen.ai'),
   'GeminiGen.AI base URL (no trailing slash).',
   'provider'),
  ('p1_key',
   jsonb_build_object('key', ''),
   'GeminiGen.AI x-api-key. Get one at https://geminigen.ai dashboard.',
   'provider'),
  ('p1_veo_path',
   jsonb_build_object('path', '/uapi/v1/video-gen/veo'),
   'POST endpoint for Veo video generation (multipart form).',
   'provider'),
  ('p1_grok_path',
   jsonb_build_object('path', '/uapi/v1/video-gen/grok'),
   'POST endpoint for Grok video generation (multipart form).',
   'provider'),
  ('p1_image_path',
   jsonb_build_object('path', '/uapi/v1/generate_image'),
   'POST endpoint for image generation (multipart form).',
   'provider'),
  ('p1_status_path',
   jsonb_build_object('path', '/uapi/v1/history/{uuid}'),
   'GET endpoint for status polling. {uuid} is replaced with task uuid.',
   'provider'),

  -- Per-asset provider toggle. Default p2 to keep existing deployments
  -- on Crun until admin explicitly flips. Set to "p1" to route that
  -- asset class through GeminiGen instead.
  ('gen_provider_image',
   jsonb_build_object('provider', 'p2'),
   'Active backend for image generation. "p1" (GeminiGen) or "p2" (Crun.ai).',
   'provider'),
  ('gen_provider_video',
   jsonb_build_object('provider', 'p2'),
   'Active backend for video generation (Veo). "p1" (GeminiGen) or "p2" (Crun.ai).',
   'provider'),
  ('gen_provider_cinema',
   jsonb_build_object('provider', 'p2'),
   'Active backend for cinema generation (Grok). "p1" (GeminiGen) or "p2" (Crun.ai).',
   'provider')

on conflict (key) do nothing;
