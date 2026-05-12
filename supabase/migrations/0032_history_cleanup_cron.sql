-- 0032_history_cleanup_cron.sql
-- ───────────────────────────────────────────────────────────────────────
-- Daily cleanup of history rows older than 30 days.
--
-- Matches the B2 lifecycle rule on peninglab-content (30-day TTL). Files
-- get auto-deleted by B2 after 30 days; this cron removes the
-- corresponding history rows so the table doesn't bloat forever with
-- pointers to dead URLs.
--
-- Also fixes saved_prompts.history_id FK so the user's prompt library
-- survives when its source history row expires. Before this change,
-- ON DELETE CASCADE would wipe the saved prompt the moment its history
-- row was deleted — but saved_prompts holds prompt_text independently
-- and is meant to be a reusable library, not a dependent of history.
-- ───────────────────────────────────────────────────────────────────────

-- ── pg_cron extension (idempotent — Supabase Pro has this by default) ──
create extension if not exists pg_cron with schema extensions;

-- ── Preserve saved_prompts when history row is deleted ─────────────────
-- Drops the old CASCADE constraint, adds back as SET NULL so the prompt
-- text persists in saved_prompts.prompt_text even after the history row
-- expires. Idempotent — uses constraint name from 0004_saved_prompts.sql.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'saved_prompts_history_id_fkey'
      and conrelid = 'public.saved_prompts'::regclass
  ) then
    alter table public.saved_prompts
      drop constraint saved_prompts_history_id_fkey;
  end if;
end$$;

alter table public.saved_prompts
  add constraint saved_prompts_history_id_fkey
  foreign key (history_id)
  references public.history(id)
  on delete set null;

-- ── Index on history.created_at for efficient cleanup scan ─────────────
-- The existing composite index (user_id, tab, created_at desc) helps
-- per-user queries but the cleanup is across all users — a standalone
-- created_at index makes the DELETE fast even at millions of rows.
create index if not exists history_created_at_idx
  on public.history (created_at);

-- ── Schedule daily cleanup ─────────────────────────────────────────────
-- 03:00 UTC = 11:00 MYT (low-traffic window for Malaysia users).
-- cron.schedule is idempotent on (jobname) — re-running this migration
-- replaces the existing schedule rather than duplicating.
select cron.schedule(
  'cleanup-history-30d',
  '0 3 * * *',
  $cleanup$
    delete from public.history
    where created_at < now() - interval '30 days';
  $cleanup$
);

-- ── How to inspect / pause the cron job ────────────────────────────────
-- View schedule:
--   select * from cron.job where jobname = 'cleanup-history-30d';
-- View recent runs:
--   select * from cron.job_run_details
--     where jobid = (select jobid from cron.job where jobname = 'cleanup-history-30d')
--     order by start_time desc limit 10;
-- Unschedule (if ever needed):
--   select cron.unschedule('cleanup-history-30d');
-- Run manually (for testing):
--   delete from public.history where created_at < now() - interval '30 days';
