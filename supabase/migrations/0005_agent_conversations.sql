-- ============================================================================
-- 0005 — Per-tab AI agent conversations
--
-- Each (user, project, tab) gets its own chat thread with the specialist
-- agent for that tab. Switching projects or tabs swaps the conversation
-- without losing context — agents are scoped + persistent.
--
-- Tabs: 'image' | 'ugc' | 'cinema'  (Auto Content has NO agent — it stays as
-- the rigid framework baseline so we can A/B compare against the agents.)
-- ============================================================================

create table if not exists public.agent_conversations (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete cascade,
  tab             text not null,        -- 'image' | 'ugc' | 'cinema'

  -- Conversation state
  messages        jsonb default '[]'::jsonb not null, -- [{role, content, tool_calls?, ...}]
  -- Lightweight scratchpad the agent uses across turns:
  --   { current_product_ref?: string, last_scene?: string, last_voice?: string,
  --     last_persona?: string, last_framework?: string, ... }
  state           jsonb default '{}'::jsonb not null,

  -- Token + cost accounting (we eat the cost; user sees only generation costs)
  total_tokens_in   int default 0 not null,
  total_tokens_out  int default 0 not null,
  total_messages    int default 0 not null,

  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null,

  -- One conversation per (user, project, tab). Agents are scoped — no
  -- mixing UGC chat with Cinema chat in the same project.
  unique (user_id, project_id, tab)
);

create index if not exists agent_conv_user_idx
  on public.agent_conversations(user_id, updated_at desc);

drop trigger if exists agent_conv_touch on public.agent_conversations;
create trigger agent_conv_touch
  before update on public.agent_conversations
  for each row execute function public.touch_updated_at();

alter table public.agent_conversations enable row level security;

drop policy if exists "agent_conv_select_own" on public.agent_conversations;
create policy "agent_conv_select_own" on public.agent_conversations
  for select using (auth.uid() = user_id);

drop policy if exists "agent_conv_modify_own" on public.agent_conversations;
create policy "agent_conv_modify_own" on public.agent_conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- agent_actions — audit log of every tool call the agent fires
--
-- Each entry records: which conversation, which tool, what params, what
-- happened, what it cost. Used for:
--   1. Disputes ("agent burned my credits") — we have receipts
--   2. Agent memory ("user's last 5 wins were Confessional persona") — fed
--      back into the system prompt as `learned_patterns`
--   3. Admin troubleshooting
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.agent_actions (
  id              uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.agent_conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  tab             text not null,
  tool_name       text not null,        -- e.g. 'generate_ugc_variants'
  params          jsonb default '{}'::jsonb not null,
  outcome         text not null,        -- 'fired' | 'failed' | 'cancelled' | 'requires_confirmation'
  history_ids     uuid[],               -- generations spawned by this call (when applicable)
  cost            numeric(12,2) default 0 not null,
  error_message   text,
  created_at      timestamptz default now() not null
);

create index if not exists agent_actions_conv_idx
  on public.agent_actions(conversation_id, created_at desc);

create index if not exists agent_actions_user_idx
  on public.agent_actions(user_id, created_at desc);

alter table public.agent_actions enable row level security;

drop policy if exists "agent_actions_select_own" on public.agent_actions;
create policy "agent_actions_select_own" on public.agent_actions
  for select using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- App settings — agent-specific defaults, all admin-tunable from /admin
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.app_settings (key, value, description, category) values
  ('model_agent_text',
   '{"model":"deepseek/deepseek-v4-pro"}',
   'Per-tab agent text brain. DeepSeek V4 Pro is cheap + fast for tool-call planning.',
   'model'),
  ('model_agent_vision',
   '{"model":"google/gemini-2.5-flash"}',
   'Per-tab agent vision brain (when user drops an image in chat).',
   'model'),
  ('agent_max_turns',
   '{"value":30}',
   'Hard cap on conversation length per (user, project, tab). Prevents runaway loops.',
   'agent'),
  ('agent_max_tools_per_turn',
   '{"value":5}',
   'Max tool calls allowed in a single agent turn before it must reply to the user.',
   'agent'),
  ('agent_daily_message_cap',
   '{"value":500}',
   'Per-user daily chat message cap across all per-tab agents. Spam guard.',
   'agent')
on conflict (key) do nothing;
