-- 0035 — Grsai (p4) provider for image generation.
--
-- p4 = Grsai (grsaiapi.com) is image-only. Replaces p3 (Mountsea) as the
-- preferred image provider because Grsai is ~3× cheaper for Nano Banana
-- Pro at 2K and exposes nano-banana-fast which we route to from
-- Storytelling for high-volume scene-image batches.
--
-- Settings added:
--   p4_key                = { key: "sk-..." }            — Grsai API key
--   p4_image_default      = { model: "nano-banana-pro" } — fallback model
--
-- Defaults flipped to p4 for ALL image generation:
--   image_provider        = { provider: "p4" }           — Image tab
--   viral_provider        = { provider: "p4" }           — Talking Object
--   storytelling_provider = { provider: "p4" }           — Storytelling
--
-- Per-tab default model (still admin-editable, but seeded sensible):
--   viral_image_model     = { model: "nano-banana-pro" } — Talking Object uses pro
--   fairytale_image_model = { model: "nano-banana-fast" } — Storytelling uses fast
--     (overrides the earlier 0027 "z-image" seed — fast is exclusive to p4
--      and the cheapest option for high-volume scene batches.)

insert into public.app_settings (key, value, description, category)
values
  ('p4_key', '{"key":"sk-e52290fab6da4d6cbdb4b2e6f26a6fde"}'::jsonb,
    'Grsai API key. Used by lib/p4.ts (image provider).',
    'provider'),
  ('p4_image_default', '{"model":"nano-banana-pro"}'::jsonb,
    'Default model for p4 when image-cascade has no explicit primary model.',
    'provider'),
  ('image_provider', '{"provider":"p4"}'::jsonb,
    'Primary provider for the Image tab. p2 (Crun), p3 (Mountsea), or p4 (Grsai). Cascade falls back to the other p2/p4 partner.',
    'provider'),
  ('viral_provider', '{"provider":"p4"}'::jsonb,
    'Primary provider for Viral Talking Object image step. p2 / p3 / p4.',
    'provider'),
  ('storytelling_provider', '{"provider":"p4"}'::jsonb,
    'Primary provider for Storytelling scene images. p2 / p3 / p4.',
    'provider')
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      category = excluded.category;

-- Bump the Storytelling default model to nano-banana-fast (p4 exclusive).
update public.app_settings
  set value = '{"model":"nano-banana-fast"}'::jsonb,
      description = 'Image gen model used for Storytelling scene images. Defaults to nano-banana-fast (p4 exclusive) for cheapest high-volume batch.'
  where key = 'fairytale_image_model';

-- Seed viral_image_model (Talking Object) to nano-banana-pro if not set.
insert into public.app_settings (key, value, description, category)
values
  ('viral_image_model', '{"model":"nano-banana-pro"}'::jsonb,
    'Image gen model for Viral Talking Object start-frame. Defaults to nano-banana-pro (best quality).',
    'provider')
on conflict (key) do nothing;
