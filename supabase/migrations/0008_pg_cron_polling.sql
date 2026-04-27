-- pg_cron + pg_net polling safety net
-- ------------------------------------------------------------------------
-- Webhooks are the fast path for settling pending generations, but they
-- can drop (provider retry exhaustion, transient deploys, cold-start
-- timeouts). This migration enables Postgres to poke our worker route
-- once a minute as a backstop.
--
-- pg_cron runs ON the Supabase database — it survives Vercel deploys and
-- works whether the user's browser is open or not.
-- pg_net lets pg_cron call HTTP endpoints from inside a SQL transaction.
-- ------------------------------------------------------------------------

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- ------------------------------------------------------------------------
-- Config table — holds the secret + URL the cron job posts to. Storing
-- these in a table (instead of GUCs) keeps them visible in the dashboard
-- and avoids needing superuser to rotate them.
--
-- Row 1 is the only row. Edit it via SQL:
--   update worker_config set
--     poll_url    = 'https://peninglab.com/api/worker/poll-pending',
--     cron_secret = '<paste from Vercel env CRON_SECRET>';
-- ------------------------------------------------------------------------

create table if not exists worker_config (
  id            int primary key default 1,
  poll_url      text not null,
  cron_secret   text not null,
  updated_at    timestamptz not null default now(),
  constraint single_row check (id = 1)
);

-- Seed an empty row so the cron has something to read. The user must fill
-- it in before the cron does anything useful (pg_net call will 401).
insert into worker_config (id, poll_url, cron_secret)
values (1, 'https://peninglab.com/api/worker/poll-pending', '')
on conflict (id) do nothing;

-- ------------------------------------------------------------------------
-- The cron job itself — runs every minute, fires a single HTTP GET at
-- the worker route with the bearer token. pg_net is async (queues the
-- request, returns immediately), so the cron tick never blocks Postgres
-- on a slow Vercel response.
-- ------------------------------------------------------------------------

-- Drop any prior schedule with the same name so this migration is idempotent
do $$
declare jid bigint;
begin
  for jid in select jobid from cron.job where jobname = 'poll-pending-every-minute'
  loop
    perform cron.unschedule(jid);
  end loop;
end$$;

select cron.schedule(
  'poll-pending-every-minute',
  '* * * * *',
  $$
  select net.http_get(
    url     := (select poll_url from worker_config where id = 1),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select cron_secret from worker_config where id = 1),
      'Content-Type',  'application/json'
    ),
    timeout_milliseconds := 55000
  );
  $$
);

-- ------------------------------------------------------------------------
-- After running this migration, set the secret:
--
--   1. Make sure CRON_SECRET is set in Vercel env (any random string,
--      e.g. `openssl rand -hex 32`).
--   2. Run in Supabase SQL editor:
--        update worker_config set cron_secret = '<paste same value>';
--   3. Verify with:
--        select * from cron.job;
--        select * from cron.job_run_details order by start_time desc limit 5;
-- ------------------------------------------------------------------------
