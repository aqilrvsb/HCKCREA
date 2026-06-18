-- Livehost "1 GPU per client" ON/OFF + per-hour billing (mechanism A: charge on OFF).
-- Each client has a dedicated always-on (minNum:1) serverless endpoint they turn
-- ON/OFF from Billing. While ON, the endpoint is billed; on OFF we charge
-- elapsed-time × livehost_gpu_rate_hour and delete the endpoint.
ALTER TABLE public.live_client_config
  ADD COLUMN IF NOT EXISTS gpu_on BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gpu_on_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gpu_endpoint_id TEXT;

-- Find clients whose GPU is currently ON (for the safety cron + admin view).
CREATE INDEX IF NOT EXISTS live_client_config_gpu_on_idx
  ON public.live_client_config (gpu_on) WHERE gpu_on = true;
