-- 0011 — set the plan_pro signup-bonus credits back to 0
--
-- The original 0001_init.sql seeded plan_pro with credits=0 (subscription
-- unlocks access, not a credit pile — top-ups are separate). Production
-- drifted to credits=10 to match an old "10 kredit free" landing claim,
-- which is now confusing for paying customers ("why am I starting with
-- 10? I want a clean balance").
--
-- This forces it back to 0. The merge keeps any other tuned fields
-- (price, days, label, image_rate, video_rate, features) untouched —
-- jsonb-set surgically replaces just the `credits` key.

update public.app_settings
set value = jsonb_set(value, '{credits}', '0'::jsonb, true)
where key = 'plan_pro';

-- Also force the dedicated signup_bonus key to 0 (it's already the
-- migration default, but cover the case where it was edited).
update public.app_settings
set value = jsonb_set(value, '{credits}', '0'::jsonb, true)
where key = 'signup_bonus';
