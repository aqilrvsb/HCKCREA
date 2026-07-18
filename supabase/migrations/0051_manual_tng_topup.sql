-- 0051 — Manual Touch 'n Go top-up (replaces CHIP/FPX for credit top-ups).
--
-- Flow: client picks an amount → sees the admin's Touch 'n Go account number +
-- QR → transfers → uploads the transfer screenshot → submits. A credit_topup
-- payment row is created with status='pending' and metadata.method='tng' +
-- metadata.proof_url. Admin reviews the screenshot on /admin/topups and
-- approves — only then are the credits added to the client's wallet.
--
-- No schema change needed: payments already has status ('pending'|'paid'|
-- 'failed') + a jsonb metadata column that holds { method, proof_url }.
-- This migration only seeds the two admin-config keys.

insert into public.app_settings (key, value, description, category) values
  ('tng_account',
   '{"number":"","name":""}',
   'Touch n Go top-up destination — account number + holder name shown to clients', 'general'),
  ('tng_qr_url',
   '{"url":""}',
   'Touch n Go top-up QR code image URL shown to clients', 'general')
on conflict (key) do nothing;
