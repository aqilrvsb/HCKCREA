-- 0038 — Dedicated AI script model for Storytelling.
--
-- Storytelling script generation is the heaviest single OpenRouter call
-- in the app: one request must produce 6-10K tokens of valid JSON
-- (12 scenes × ~800 chars of narration + image_prompt + lock blocks,
-- strict schema, no markdown fences). Cheaper/smaller models like
-- google/gemini-3.1-flash-lite frequently truncate or emit malformed
-- JSON for this load, surfacing as "AI returned invalid JSON" in the
-- Preview modal.
--
-- Auto Content's master plan ALSO uses model_auto but only generates
-- 1-2 scene plans at a time — Flash-Lite handles those fine. We don't
-- want to bump model_auto to a more expensive model just to make
-- Storytelling reliable.
--
-- Solution: split out a dedicated `storytelling_script_model` setting
-- that Storytelling's script route uses preferentially, falling back
-- to model_auto when this is empty. Admin can paste any OpenRouter
-- model id at /admin/settings → Storytelling — Scene Images card.
--
-- Default value is an empty string so existing installs keep using
-- model_auto unchanged. Admin opts in by entering a model id.

insert into public.app_settings (key, value, description, category)
values
  ('storytelling_script_model',
    '{"model":""}'::jsonb,
    'AI script model for Storytelling (independent from Auto Content). Empty = falls back to model_auto. Use a stronger model (gemini-3.1-pro / claude-haiku-4-5 / gpt-5.4) here when script gen fails with invalid JSON on a Flash-Lite-tier model.',
    'model')
on conflict (key) do update
  set description = excluded.description,
      category    = excluded.category;
