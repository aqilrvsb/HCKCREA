-- 0013 — tighten poll cadence: 60s → 30s + 10m stale → 5m stale
--
-- Webhooks usually settle rows in ~30-90s, but the cron is the backstop
-- when webhooks drop. Halving the cron interval halves the worst-case
-- latency for webhook-missed rows; lowering STALE_MIN from 10m → 5m
-- means UI doesn't show "Generating…" for as long when both paths drop.
--
-- pg_cron 1.5+ accepts a plain interval string like '30 seconds' for
-- sub-minute schedules — we use that here.
--
-- Idempotent: drop both the old per-minute job and any prior 30s job
-- before scheduling fresh.

do $$
declare jid bigint;
begin
  for jid in
    select jobid from cron.job
    where jobname in ('poll-pending-every-minute', 'poll-pending-every-30s')
  loop
    perform cron.unschedule(jid);
  end loop;
end$$;

select cron.schedule(
  'poll-pending-every-30s',
  '30 seconds',
  $$
  select net.http_get(
    url     := (select poll_url from worker_config where id = 1),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select cron_secret from worker_config where id = 1),
      'Content-Type',  'application/json'
    ),
    timeout_milliseconds := 25000
  );
  $$
);
