-- ============================================================================
-- 0003 — Cinema tab (Grok Imagine via Crun.ai)
--   • Two new model keys for grok-imagine/t2v + grok-imagine/i2v
--   • cinema_rate_per_sec — admin-tunable RM-per-second cost. Default 0.03.
-- ============================================================================

insert into public.app_settings (key, value, description, category) values
  ('p2_model_grok_t2v', '{"model":"grok-imagine/t2v"}', 'Grok Imagine — text-to-video', 'model'),
  ('p2_model_grok_i2v', '{"model":"grok-imagine/i2v"}', 'Grok Imagine — image-to-video', 'model'),
  ('cinema_rate_per_sec', '{"rate":0.03}', 'Cinema (Grok Imagine) cost per second of generated video. RM.', 'pricing')
on conflict (key) do nothing;
