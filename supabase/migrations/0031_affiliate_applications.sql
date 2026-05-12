-- Affiliate sign-up applications.
--
-- Public visitors fill in the form on /affiliate. Each submission lands
-- here at status='pending'. Admin reviews at /admin/affiliate and on
-- Approve, the row triggers user creation (Pro plan, 30 days, 10 credits)
-- via /api/admin/affiliate POST. On Reject the row flips to 'rejected'
-- with an admin note; no user is created.
--
-- The form fields are intentionally minimal — name, email, whatsapp.
-- No password: a temp password is generated at approval time and sent
-- to the applicant via WhatsApp, mirroring the existing checkout_signup
-- flow.

create table if not exists public.affiliate_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  whatsapp text not null,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  admin_note text,
  approved_user_id uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists affiliate_applications_status_idx
  on public.affiliate_applications(status, created_at desc);

-- One PENDING application per email — prevents accidental spam from a
-- visitor repeatedly hitting submit. Approved / rejected rows are kept
-- for history; the partial-unique only constrains pending rows.
create unique index if not exists affiliate_applications_email_pending_idx
  on public.affiliate_applications(lower(email))
  where status = 'pending';

-- ─── RLS ─────────────────────────────────────────────────────────────
-- The PUBLIC /affiliate route inserts via service-role (API route) so
-- no insert policy needed. Reads are admin-only — bypassed via service
-- role on /admin/affiliate.
alter table public.affiliate_applications enable row level security;
-- No select policy = no authenticated row visibility. Service role
-- (admin API) bypasses RLS so admin sees everything.
