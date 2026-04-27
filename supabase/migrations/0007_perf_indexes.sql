-- 0007: Hot-path indexes for poll-pending, dashboard stats, agent conversation lookup,
-- saved_prompts dedupe. Identified by perf audit on 2026-04-27.

-- Poll-pending worker: filters status='pending' AND task_id IS NOT NULL with created_at range.
-- Existing indexes don't cover the (status, created_at) combo cleanly.
CREATE INDEX IF NOT EXISTS history_pending_poll_idx
  ON public.history (status, created_at ASC)
  WHERE status = 'pending' AND task_id IS NOT NULL;

-- Dashboard stats: filters (user_id, status='done', created_at range). Existing
-- (user_id, tab, created_at) covers user+date but tab is irrelevant for this query.
CREATE INDEX IF NOT EXISTS history_user_status_date_idx
  ON public.history (user_id, status, created_at DESC)
  WHERE status = 'done';

-- Agent conversation lookup: query order is (user_id, tab, project_id). The implicit
-- UNIQUE index is (user_id, project_id, tab) which Postgres uses but suboptimally.
CREATE INDEX IF NOT EXISTS agent_conv_lookup_idx
  ON public.agent_conversations (user_id, tab, project_id);

-- saved_prompts dedupe: settle.ts + saved-prompts POST do SELECT WHERE history_id = $1.
-- history_id has FK but no standalone index.
CREATE INDEX IF NOT EXISTS saved_prompts_history_id_idx
  ON public.saved_prompts (history_id)
  WHERE history_id IS NOT NULL;

-- Stale pending cleanup
CREATE INDEX IF NOT EXISTS history_stale_pending_idx
  ON public.history (created_at ASC)
  WHERE status = 'pending';
