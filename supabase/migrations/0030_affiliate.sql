-- Affiliate / referral system.
--
-- Adds 3 columns to profiles + 2 new tables + the admin-tunable rate.
-- See app/dashboard/tabs/affiliate.tsx for the user-facing UI and
-- app/api/payments/webhook/route.ts for the commission-grant flow.
--
-- Cookie attribution: middleware reads ?ref=<code> on landing pages and
-- stores it in a 30-day "peninglab_ref" cookie. /api/checkout reads the
-- cookie at signup time and stamps it on the payment row; the webhook
-- then resolves the referrer + stores it on the new user's profile.

-- ─── profiles columns ────────────────────────────────────────────────
alter table public.profiles
  add column if not exists referral_code text unique,
  add column if not exists referred_by text default null,
  add column if not exists wallet_balance numeric(12,2) not null default 0;

-- Backfill referral_code for existing users — first 8 chars of id, upper.
-- One-shot; new users get their code at webhook time via applyCheckoutSignup.
update public.profiles
   set referral_code = upper(substring(id::text from 1 for 8))
 where referral_code is null;

-- ─── referral_commissions ────────────────────────────────────────────
-- Log row per commission earned. Sum of `commission_amount` per
-- referrer_id = the all-time "Total Earned" on the affiliate UI.
create table if not exists public.referral_commissions (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referred_user_id uuid not null references public.profiles(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete set null,
  payment_amount numeric(12,2) not null,
  commission_rate numeric(5,2) not null,
  commission_amount numeric(12,2) not null,
  commission_type text not null default 'subscription',
  created_at timestamptz not null default now()
);

create index if not exists referral_commissions_referrer_idx
  on public.referral_commissions(referrer_id, created_at desc);
create index if not exists referral_commissions_referred_idx
  on public.referral_commissions(referred_user_id);

-- ─── cashout_requests ────────────────────────────────────────────────
-- User submits → status=pending. Wallet balance is HELD UNTIL PAID:
-- the cashout amount is reserved against wallet_balance via the
-- `available_balance` computation in the API but not deducted from
-- profiles.wallet_balance until admin flips status → paid.
create table if not exists public.cashout_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 50),
  bank_name text not null,
  bank_account_name text not null,
  bank_account_number text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','paid')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists cashout_requests_status_idx
  on public.cashout_requests(status, created_at desc);
create index if not exists cashout_requests_user_idx
  on public.cashout_requests(user_id, created_at desc);

-- ─── RLS — users see their own rows; service role bypasses ───────────
alter table public.referral_commissions enable row level security;
alter table public.cashout_requests     enable row level security;

drop policy if exists rc_select_own on public.referral_commissions;
create policy rc_select_own on public.referral_commissions
  for select to authenticated
  using (referrer_id = auth.uid());

drop policy if exists cr_select_own on public.cashout_requests;
create policy cr_select_own on public.cashout_requests
  for select to authenticated
  using (user_id = auth.uid());

-- INSERT/UPDATE go through service-role only (API routes), so no
-- additional policies needed for those.

-- ─── admin-tunable commission rate ───────────────────────────────────
-- Default 20%. Read by webhook's commission-grant block.
insert into public.app_settings (key, value, description, category)
values (
  'referral_commission_rate',
  '{"rate":20}'::jsonb,
  'Percentage of every subscription payment paid out to the referrer',
  'pricing'
)
on conflict (key) do nothing;
