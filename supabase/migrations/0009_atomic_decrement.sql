-- Atomic credit decrement — eliminates the read-then-write race in
-- lib/deduct.ts.
--
-- Symptom we saw in production: two generations finishing within
-- ~100ms both read profiles.credits = 53.40, both compute after =
-- 53.20, both write 53.20. Two rows in credit_transactions show
-- balance_after = 53.20 (one of them should be 53.00). User gets a
-- free generation because the second deduction's update was a no-op.
--
-- Fix: a SECURITY DEFINER function that does UPDATE … RETURNING in a
-- single statement. Postgres serialises concurrent updates on the
-- same row, so each caller gets the actual post-decrement value.

create or replace function public.decrement_credits(
  p_user_id uuid,
  p_amount  numeric
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric;
begin
  update public.profiles
  set credits = greatest(0, credits - p_amount)
  where id = p_user_id
  returning credits into new_balance;
  return coalesce(new_balance, 0);
end;
$$;

-- Service role only — the deduct() helper uses the admin client.
revoke all on function public.decrement_credits(uuid, numeric) from public, authenticated, anon;
grant execute on function public.decrement_credits(uuid, numeric) to service_role;
