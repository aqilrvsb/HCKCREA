-- 0025 — set profiles.credits column default back to 0.
--
-- The original 0001_init.sql created profiles.credits with DEFAULT 0.
-- Production drifted to DEFAULT 10 (likely changed via the Supabase
-- Dashboard table editor) which caused every new signup to land with
-- 10 free credits — even though migration 0011 had already set the
-- plan_pro.credits + signup_bonus.credits to 0 in app_settings.
--
-- Why this is the actual fix: handle_new_user() runs
--   insert into public.profiles (id, full_name, whatsapp) values (...)
-- without specifying credits, so PostgreSQL falls back to the column
-- DEFAULT. Forcing the default to 0 closes the leak at the source.
--
-- Reference: https://www.postgresql.org/docs/current/sql-altertable.html
-- "SET DEFAULT" doesn't touch existing rows, only future inserts.

alter table public.profiles
  alter column credits set default 0;
