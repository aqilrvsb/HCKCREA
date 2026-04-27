-- 0010 — drop the NOT NULL on public.payments.user_id
--
-- Background: 0001_init.sql declared payments.user_id as nullable (with the
-- comment "user_id NULLABLE — populated after auto-register for
-- checkout_signup type"). Production drifted at some point and added a
-- NOT NULL constraint, which breaks /api/checkout (the public signup flow)
-- because the row is intentionally inserted with user_id=null and patched
-- after auto-register inside the webhook.
--
-- Symptom on prod before this migration:
--   23502 null value in column "user_id" of relation "payments" violates
--   not-null constraint
--
-- This makes the production schema match the original migration. The FK to
-- auth.users is preserved; only the NOT NULL is dropped.

alter table public.payments
  alter column user_id drop not null;
