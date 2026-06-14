-- Persist the Livehost dashboard's client-side state (Knowledge / Products,
-- Greeting library, saved Templates, studio settings) to the DB so it
-- survives cache clears and follows the user across devices/browsers.
-- localStorage stays only as a fast write-through cache; this column is the
-- source of truth. One JSON blob per user, keyed by the localStorage key.
alter table public.live_client_config
  add column if not exists dashboard_state jsonb not null default '{}'::jsonb;
