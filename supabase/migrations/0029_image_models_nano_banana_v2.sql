-- ============================================================================
-- 0029 — Register google/nano-banana-v2 in the image_models mapping
--
-- The 0001_init seed only knew about nano-banana-pro / nano-banana-2 / gpt-image-2.
-- The admin Storytelling dropdown gained a "nano-banana (Google — balanced)"
-- option saving key="nano-banana-v2", but no mapping existed for it — so the
-- scene-image dispatcher was sending the literal string "nano-banana-v2" to
-- Crun's API, which rejected it as unknown ("crun expects google/nano-banana-v2").
--
-- This migration merges the new entry into the existing JSON value rather
-- than overwriting, so any custom additions a self-hosted operator made are
-- preserved. Idempotent — re-running is a no-op.
-- ============================================================================

UPDATE public.app_settings
SET value = (value::jsonb || '{"nano-banana-v2": "google/nano-banana-v2"}'::jsonb)
WHERE key = 'image_models'
  AND NOT (value::jsonb ? 'nano-banana-v2');
