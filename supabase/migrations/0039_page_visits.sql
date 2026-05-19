-- 0039_page_visits.sql
-- Lightweight page-visit logging for the /admin/ads dashboard.
--
-- The browser fires ONE insert per session (sessionStorage guard in
-- FBPixel component), so volume is bounded by unique sessions per day,
-- not page navs. Bots are filtered via a UA heuristic at insert time.
--
-- We do NOT store raw IP — it's SHA-256 hashed so repeat visits from
-- the same network can still be counted as one visitor (within a date
-- range) without retaining PII.

create table if not exists public.page_visits (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  session_id text,
  ip_hash text,
  ua text,
  is_bot boolean default false,
  -- UTM capture so future per-source reports can be added without a
  -- schema change. Not used by the current admin UI (user opted for
  -- totals-only) but cheap to record now.
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  created_at timestamptz default now()
);

-- Primary query: count visits in a date range, ordered newest first.
create index if not exists page_visits_created_at_idx
  on public.page_visits (created_at desc);

-- Unique-visitor query: count DISTINCT session_id in a date range.
create index if not exists page_visits_session_created_idx
  on public.page_visits (session_id, created_at desc);

-- Service-role-only table. No RLS policies — only the admin client
-- (createAdminClient) inserts + reads. Anon/authed users never touch
-- this table directly; visit logging goes through /api/analytics/visit
-- which uses the service role on the server side.
alter table public.page_visits enable row level security;
