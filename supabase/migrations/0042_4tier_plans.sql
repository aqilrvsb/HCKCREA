-- 0042 — 4-tier subscription pricing.
--
-- Replaces single Pro plan + standalone Topup with 4 monthly tiers.
-- Each tier costs a fixed RM amount per 30 days and grants a fixed
-- RM credit allotment. Existing Pro users grandfathered — their
-- profiles.plan + plan_expires_at stay valid until expiry.
--
-- Admin can still tune any price/credits via /admin/settings without
-- a redeploy (matches existing plan_pro pattern).

-- Update existing Pro plan to new Pro tier pricing.
update public.app_settings
  set value = '{"price":100,"days":30,"credits":50,"label":"Pro"}'::jsonb,
      description = 'Pro plan — RM100/30 days + RM50 credits. Best seller tier.'
  where key = 'plan_pro';

-- Add 3 sibling tier rows.
insert into public.app_settings (key, value, description, category)
values
  ('plan_starter', '{"price":35,"days":30,"credits":10,"label":"Starter"}'::jsonb,
    'Starter plan — RM35/30 days + RM10 credits. Entry-level access tier.',
    'plan'),
  ('plan_standard', '{"price":50,"days":30,"credits":25,"label":"Standard"}'::jsonb,
    'Standard plan — RM50/30 days + RM25 credits.',
    'plan'),
  ('plan_premium', '{"price":200,"days":30,"credits":100,"label":"Premium"}'::jsonb,
    'Premium plan — RM200/30 days + RM100 credits. Highest tier.',
    'plan')
on conflict (key) do nothing;
