-- 0040_chat_usage.sql
-- Per-call log for orChat cascade walks. Currently only the
-- model_custom_idea calls write here — admin sees how often each
-- fallback layer is getting hit and which user triggered it.
--
-- Three feature buckets are stamped at the call site:
--   ugc_custom_idea  : UGC tab "Custom Idea" expansion
--   auto_with_idea   : Auto Content batch with idea_style filled
--   auto_only        : Auto Content batch with no idea_style
--
-- cascade_trace is a JSONB array of {provider, model, ok, error?, ms}.
-- The final entry is the one that succeeded (when succeeded=true) or
-- the last attempt (when succeeded=false).

create table if not exists public.chat_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  feature text not null,
  model_key text not null,
  cascade_trace jsonb not null default '[]'::jsonb,
  final_provider text,
  final_model text,
  succeeded boolean not null,
  total_attempts int not null default 0,
  total_latency_ms int,
  prompt_snippet text,
  created_at timestamptz default now()
);

create index if not exists chat_usage_created_at_idx
  on public.chat_usage (created_at desc);
create index if not exists chat_usage_user_created_idx
  on public.chat_usage (user_id, created_at desc);
create index if not exists chat_usage_feature_created_idx
  on public.chat_usage (feature, created_at desc);

-- Service-role-only (createAdminClient inserts + reads from API routes).
alter table public.chat_usage enable row level security;
