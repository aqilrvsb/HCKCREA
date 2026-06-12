-- 0043 — Livehost package.
--
-- A SEPARATE subscription package (RM500/30 days) outside the 4-tier
-- generation product. Livehost users get their own (currently blank)
-- dashboard, grant no generation credits, and their billing shows only
-- the Livehost package. Price/days/credits/label are admin-tunable via
-- /admin/settings without a redeploy (same plan_* pattern as the tiers).

insert into public.app_settings (key, value, description, category)
values
  ('plan_livehost', '{"price":500,"days":30,"credits":0,"label":"Livehost"}'::jsonb,
    'Livehost package — RM500/30 days. Separate dashboard, no generation credits.',
    'plan')
on conflict (key) do nothing;
