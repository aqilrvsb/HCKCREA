-- Admin "appoints" a client to a GPU = grants this entitlement. Without it the
-- client cannot turn a GPU on (1 GPU = 1 client, admin-gated). The entitlement
-- persists across the client's own on/off (create/delete) cycles.
ALTER TABLE public.live_client_config
  ADD COLUMN IF NOT EXISTS gpu_allowed BOOLEAN NOT NULL DEFAULT false;
