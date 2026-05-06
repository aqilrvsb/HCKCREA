-- 0030_b2_mirrored_at.sql
-- Auto-mirror to peninglab-content B2 bucket — track which history rows are
-- already mirrored so cleanup cron knows what to delete.
-- See docs/superpowers/specs/2026-05-05-auto-mirror-b2-design.md

ALTER TABLE history ADD COLUMN IF NOT EXISTS b2_mirrored_at TIMESTAMPTZ;

-- Partial index for the cleanup query (only rows that ARE mirrored matter).
-- Excludes the long tail of legacy/un-mirrored rows.
CREATE INDEX IF NOT EXISTS history_b2_unsaved_idx
  ON history (created_at)
  WHERE b2_mirrored_at IS NOT NULL;

-- RPC the cleanup cron calls. Returns rows where:
--   * b2_mirrored_at is set (we put the file on peninglab-content)
--   * row is older than 14 days
--   * no storage row exists for it (user did not Save → file is unsaved)
CREATE OR REPLACE FUNCTION public.history_unsaved_past_ttl()
RETURNS TABLE (
  id UUID,
  user_id UUID,
  type TEXT,
  output_url TEXT,
  b2_mirrored_at TIMESTAMPTZ
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT h.id, h.user_id, h.type, h.output_url, h.b2_mirrored_at
  FROM public.history h
  WHERE h.b2_mirrored_at IS NOT NULL
    AND h.created_at < NOW() - INTERVAL '14 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.storage s WHERE s.history_id = h.id
    );
$$;

REVOKE ALL ON FUNCTION public.history_unsaved_past_ttl() FROM public, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.history_unsaved_past_ttl() TO service_role;
