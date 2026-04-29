-- Audit log for admin impersonation events.
--
-- Every time an admin clicks a client's email in /admin/clients to log
-- in as that user, a row is inserted here. Pure traceability — no FKs
-- to user tables so deleted users don't break the log; admin_user_id
-- and target_user_id are stored as raw uuids.

CREATE TABLE IF NOT EXISTS admin_impersonation_log (
  id BIGSERIAL PRIMARY KEY,
  admin_user_id UUID NOT NULL,
  target_user_id UUID NOT NULL,
  target_email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_impersonation_log_admin_idx
  ON admin_impersonation_log (admin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_impersonation_log_target_idx
  ON admin_impersonation_log (target_user_id, created_at DESC);
