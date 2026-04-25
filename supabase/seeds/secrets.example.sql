-- ============================================================================
-- LOCAL-ONLY secrets seed — DO NOT COMMIT WITH REAL KEYS
--
-- Copy this file to `local-secrets.sql` (gitignored), fill in your real keys,
-- then paste into Supabase Dashboard → SQL Editor → Run.
--
-- After this runs once, you can also rotate keys from the in-app /admin page
-- without ever touching SQL again.
-- ============================================================================

update public.app_settings set value = jsonb_build_object('key', 'PASTE-OPENROUTER-KEY-HERE')   where key = 'or_key';
update public.app_settings set value = jsonb_build_object('key', 'PASTE-CRUN-KEY-HERE')         where key = 'p2_key';
update public.app_settings set value = jsonb_build_object('key', 'PASTE-FAL-KEY-HERE')          where key = 'fal_key';

-- Mark yourself as admin so you can edit settings via /admin without using SQL
update public.profiles
   set is_admin = true
 where id = (select id from auth.users where email = 'YOUR-EMAIL-HERE@example.com');
