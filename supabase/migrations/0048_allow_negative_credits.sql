-- 0048 — let credits go NEGATIVE instead of silently absorbing overspend.
--
-- Problem (observed in production on nl@gmail.com):
--   decrement_credits floored the balance with greatest(0, credits - amount).
--   Generations are checked at submit (`credits >= cost`) but only charged at
--   settle, 3-29 minutes later. So a client could queue ~13 videos on RM9 of
--   credit — every click saw the full balance and passed — and the overspend
--   was then swallowed by the floor. Symptom: a run of credit_transactions
--   each recording -1.50 with balance_after = 0.00, i.e. the transaction log
--   claims RM1.50 was taken when only RM0.15 (or nothing) actually was.
--   Measured: RM754.20 billed on paper vs RM743.55 really taken → RM10.65 free.
--
-- Fix: drop the floor. Overspend now lands as a visible negative balance (a
-- debt) instead of vanishing. Two things follow for free:
--   1. hasEnoughCredits()/priceAndCheck() compare `credits >= cost`, so a
--      negative balance blocks every subsequent generation across ALL tabs —
--      no per-route guard needed.
--   2. Every top-up path does `current + credits` (payments webhook:
--      applyCreditTopup / applySubscription, /api/credit/topup), so a top-up
--      automatically settles the debt: -10.65 + 50 = 39.35.
--
-- balance_after in credit_transactions now reflects the true post-charge
-- balance, so the ledger stops lying.

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
  -- No greatest(0, …): overspend must surface as a negative balance so it is
  -- visible, blocks further generations, and is recovered on the next top-up.
  update public.profiles
  set credits = credits - p_amount
  where id = p_user_id
  returning credits into new_balance;
  return coalesce(new_balance, 0);
end;
$$;

revoke all on function public.decrement_credits(uuid, numeric) from public, authenticated, anon;
grant execute on function public.decrement_credits(uuid, numeric) to service_role;
