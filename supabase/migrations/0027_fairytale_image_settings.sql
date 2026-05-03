-- 0027 — admin-configurable image model + rate for the Fairytale tab.
--
-- Two new app_settings keys so admin can switch which model the Fairytale
-- scene-image generator uses, and what to charge users per image,
-- WITHOUT touching the global image-tab defaults.
--
--   fairytale_image_model = { model: "z-image" }
--     Any Crun model id (z-image, nano-banana-pro, gpt-image-2, etc.).
--     Falls back to the global cfg.imageDefault when unset.
--
--   fairytale_image_rate  = { rate: 0.05 }
--     Per-image RM charge. Falls back to the global image_generate rate
--     when unset (which is plan-tier dependent).
--
-- Defaults seeded as z-image @ RM 0.05 — Crun's z-image is roughly half
-- the cost of nano-banana-pro and ships with prompt_extend auto-enhance
-- which gives better cinematic results for storytelling scenes.

insert into public.app_settings (key, value, description, category)
values
  ('fairytale_image_model', '{"model":"z-image"}'::jsonb,
    'Image gen model used for Fairytale scene images. Any Crun model id (z-image / nano-banana-pro / gpt-image-2). Falls back to imageDefault when unset.',
    'fairytale'),
  ('fairytale_image_rate', '{"rate":0.05}'::jsonb,
    'Per-image RM charge for Fairytale scenes (10 scenes per story = 10x this). Falls back to plan-tier image_generate rate when unset.',
    'fairytale')
on conflict (key) do update
  set description = excluded.description,
      category = excluded.category;
