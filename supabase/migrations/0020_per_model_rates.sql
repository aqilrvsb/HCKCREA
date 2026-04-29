-- Per-model pricing — one rate row per generation model so admin can
-- price each independently in /admin/settings without touching the
-- plan-rate fallback. priceFor() consults these first; if a row is
-- missing it falls back to plan_pro.image_rate / plan_pro.video_rate
-- / cinema_rate / seedance_rate so existing deployments keep working.
--
-- Defaults seeded with current-known-good values:
--   - Banana Pro     RM 0.15 / image
--   - GPT Image      RM 0.30 / image
--   - Veo            RM 0.40 / 8s clip, RM 0.80 / 16s clip
--   - Grok           RM 0.10 / second
--   - Seedance       RM 0.40 / second

INSERT INTO app_settings (key, value, description, category) VALUES
  ('rate_banana_pro',
   '{"per_image":0.15}',
   'Banana Pro image generation — RM per image.',
   'pricing'),
  ('rate_gpt_image',
   '{"per_image":0.30}',
   'GPT Image generation — RM per image.',
   'pricing'),
  ('rate_veo',
   '{"per_video_8s":0.40,"per_video_16s":0.80}',
   'Veo video generation — RM per 8s clip / 16s clip.',
   'pricing'),
  ('rate_grok',
   '{"per_second":0.10}',
   'Grok (Story tab) video generation — RM per second.',
   'pricing'),
  ('rate_seedance',
   '{"per_second":0.40}',
   'Seedance (Cinema tab) video generation — RM per second.',
   'pricing')
ON CONFLICT (key) DO NOTHING;
