-- 0023 — Dismissed-from-extension flag
--
-- Adds a per-row 'dismissed_from_extension' boolean to history. When
-- TRUE, the row is hidden from /api/extension/recent — it stops
-- appearing in the Chrome extension's View Videos modal entirely.
-- Useful for archiving / cleaning up rows the client doesn't want to
-- post but doesn't want to delete from history either.
--
-- Toggle via /api/extension/dismiss (POST). Default FALSE so existing
-- rows are unaffected.

ALTER TABLE history
  ADD COLUMN IF NOT EXISTS dismissed_from_extension BOOLEAN DEFAULT FALSE;

-- Partial index — only the rows that are still candidates for the
-- extension (NOT dismissed). Saves index space + makes the
-- /api/extension/recent query plan use this directly.
CREATE INDEX IF NOT EXISTS history_extension_active_idx
  ON history (user_id, tab, status, posted_to_tiktok, created_at DESC)
  WHERE dismissed_from_extension = FALSE;
