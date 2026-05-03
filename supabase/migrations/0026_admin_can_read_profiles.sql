-- 0026 — let admins read all profiles rows.
--
-- The transactions admin page queries profiles via the browser Supabase
-- client to display each customer's live name + whatsapp on the row.
-- The only existing select policy is profiles_select_own (auth.uid() = id),
-- so the admin's browser only ever got back their own profile — every
-- other customer's row came back empty. The page then fell back to the
-- frozen signup metadata in payment.metadata.signup, which never reflects
-- admin edits made in /admin/clients.
--
-- Same fix pattern as 0024 (payments_select_admin) — adds a parallel
-- admin-bypass policy that lets profiles.is_admin = true select all rows.
-- The existing user-scoped policy is unchanged so normal users still
-- only see their own profile.
--
-- Updates / inserts remain admin-write-via-service-role (handled by
-- /api/admin/clients/update + handle_new_user trigger).

drop policy if exists "profiles_select_admin" on public.profiles;

create policy "profiles_select_admin" on public.profiles
  for select
  using (
    exists (
      select 1 from public.profiles me
      where me.id = auth.uid()
        and me.is_admin = true
    )
  );
