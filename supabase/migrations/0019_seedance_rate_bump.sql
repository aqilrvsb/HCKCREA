-- Bump Seedance Fast rate from RM0.10/sec → RM0.40/sec.
--
-- 0018 seeded the rate at RM0.10/sec as a placeholder. Real Seedance Fast
-- pricing on Crun/GeminiGen lands at RM0.40/sec — an 8s clip costs RM3.20,
-- a 15s clip costs RM6.00. Force-update so deployments that already ran
-- 0018 get the corrected rate.

UPDATE app_settings
SET value = '{"per_second":0.40}',
    description = 'Seedance Fast rate per second — RM0.40/sec. 8s clip = RM3.20, 15s = RM6.00.'
WHERE key = 'seedance_rate';

-- If the row doesn't exist (fresh deploy that skipped 0018), insert it.
INSERT INTO app_settings (key, value, description, category)
SELECT
  'seedance_rate',
  '{"per_second":0.40}',
  'Seedance Fast rate per second — RM0.40/sec. 8s clip = RM3.20, 15s = RM6.00.',
  'pricing'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'seedance_rate');
