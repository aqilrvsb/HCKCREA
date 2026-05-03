-- 0026 — let admins read all profiles rows (corrected, no recursion).
--
-- The transactions admin page queries profiles via the browser Supabase
-- client to display each customer's live name + whatsapp on the row.
-- The only existing select policy is profiles_select_own (auth.uid() = id),
-- so the admin's browser only ever got back their own profile — every
-- other customer's row came back empty.
--
-- ⚠️ Naive admin-bypass attempt (DON'T DO THIS):
--   create policy "profiles_select_admin" on public.profiles for select
--     using (exists (select 1 from public.profiles
--                    where id = auth.uid() and is_admin = true));
--
-- That recurses infinitely — the policy on profiles queries profiles, which
-- triggers the policy again. Postgres returns nothing → admin layout sees
-- is_admin=false → redirects every admin to /dashboard.
--
-- Correct pattern: SECURITY DEFINER helper. Function runs with owner's
-- privileges (postgres, which bypasses RLS), so the SELECT inside the
-- function body doesn't re-trigger the policy. The policy calls the
-- function, gets true/false, decides — no recursion.

-- Helper that returns whether a user id is an admin. SECURITY DEFINER
-- bypasses RLS for the SELECT inside, so it can be called from the
-- profiles policy without recursing.
create or replace function public.is_admin_uid(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and is_admin = true
  );
$$;

-- Admin-bypass policy on profiles. Existing profiles_select_own (user's
-- own row) is unchanged — both policies OR together for SELECT.
drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin" on public.profiles
  for select
  using (public.is_admin_uid(auth.uid()));
