-- Motion tab web-search cache (lib/motion-search.ts).
-- One row per (kind, normalised query, gl, hl, num) — key is the sha256 of
-- `${kind}|${normQuery}|${gl}|${hl}|${num}`. Rows younger than 30 days are
-- served instead of calling Serper / Brave / Tavily again.
-- Service role only: RLS on, no policies.
create table if not exists public.motion_search_cache (
  key text primary key,
  kind text not null,
  query text not null,
  provider text not null,
  results jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists motion_search_cache_created_idx on public.motion_search_cache (created_at);
alter table public.motion_search_cache enable row level security;  -- service role only, no policies
