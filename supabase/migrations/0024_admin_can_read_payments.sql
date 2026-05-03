-- 0024 — let admins read all payments rows.
--
-- Admin Transactions tab (/admin/transactions) was showing empty/wrong data
-- because it queries the `payments` table via the browser Supabase client,
-- which is RLS-enforced. The only existing policy is `payments_select_own`
-- (auth.uid() = user_id), so the admin only saw their own purchases.
--
-- This adds a parallel admin-bypass policy: any user with profiles.is_admin
-- = true can SELECT every row. Normal users still only see their own
-- (the existing policy is unchanged).
--
-- Inserts/updates remain server-side via service role — no admin write
-- policy needed (admins do refunds/recheck via /api/payments/* routes).

drop policy if exists "payments_select_admin" on public.payments;

create policy "payments_select_admin" on public.payments
  for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_admin = true
    )
  );
