-- 0006: Video segments for 16s mode + Extend feature
--
-- Adds parent/segment columns to history so a 16s clip is represented as:
--   • parent row (type=video, status='pending', merged_url filled when done)
--   • seg-1 row (segment_index=1, parent_history_id=parent.id)
--   • seg-2 row (segment_index=2, parent_history_id=parent.id)
--
-- The settle pipeline auto-fires seg-2 when seg-1 settles, then auto-merges
-- when seg-2 settles. parent.merged_url is the final 16s WebM URL.
--
-- product_ocr cache lives on saved_prompts (one row per prompt) — keyed by the
-- product reference URL. Cached so we run OCR once per product image, not per
-- generation.

-- ────────────────────────────────────────────────────────────────────────
-- history table: segment chaining + merged output
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE history
  ADD COLUMN IF NOT EXISTS parent_history_id UUID REFERENCES history(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS segment_index SMALLINT,
  ADD COLUMN IF NOT EXISTS merged_url TEXT,
  ADD COLUMN IF NOT EXISTS frame_anchor TEXT
    CHECK (frame_anchor IN ('first', 'middle', 'last'));

CREATE INDEX IF NOT EXISTS history_parent_idx ON history(parent_history_id);
CREATE INDEX IF NOT EXISTS history_segment_idx ON history(parent_history_id, segment_index);

COMMENT ON COLUMN history.parent_history_id IS
  'For 16s clips and Extend chains: points to the parent history row. NULL for standalone clips.';
COMMENT ON COLUMN history.segment_index IS
  'Position in the segment chain (1-based). 1 = first/original, 2 = continuation. NULL for standalone clips.';
COMMENT ON COLUMN history.merged_url IS
  'Final stitched output URL once all segments settle and merge succeeds. Set on the parent row only.';
COMMENT ON COLUMN history.frame_anchor IS
  'For Extend continuations: which frame from seg-1 was used to anchor seg-2 (first/middle/last).';

-- ────────────────────────────────────────────────────────────────────────
-- product_ocr cache — one row per (user, product_image_url)
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_ocr_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_image_url TEXT NOT NULL,
  ocr_data JSONB NOT NULL,
  -- ocr_data shape: { main_text, subtitle, logo_description, package_color,
  --                   text_font_style, text_layout }
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, product_image_url)
);

CREATE INDEX IF NOT EXISTS product_ocr_user_idx ON product_ocr_cache(user_id);
CREATE INDEX IF NOT EXISTS product_ocr_url_idx ON product_ocr_cache(product_image_url);

ALTER TABLE product_ocr_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own product_ocr"
  ON product_ocr_cache FOR SELECT
  USING (auth.uid() = user_id);

-- Insertions happen server-side via admin client (service role bypasses RLS),
-- but allow user inserts for direct future use:
CREATE POLICY "users insert own product_ocr"
  ON product_ocr_cache FOR INSERT
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE product_ocr_cache IS
  'Cached OCR results for product reference images. Used by 16s + Extend pipeline to inject PRODUCT TEXT LOCK into seg-2 prompts so labels stay sharp across the cut.';

-- ────────────────────────────────────────────────────────────────────────
-- Admin settings: model_product_ocr (cheap vision model for label OCR)
-- ────────────────────────────────────────────────────────────────────────

INSERT INTO app_settings (key, value)
VALUES (
  'model_product_ocr',
  '{"model": "google/gemini-2.5-flash"}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────
-- video_16s pricing (default 2x video_8s)
-- ────────────────────────────────────────────────────────────────────────

INSERT INTO app_settings (key, value)
VALUES (
  'price_video_16s',
  '{"rm": 2.40}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────
-- fal merge endpoint path setting
-- ────────────────────────────────────────────────────────────────────────

INSERT INTO app_settings (key, value)
VALUES (
  'fal_merge_path',
  '{"path": "/fal-ai/ffmpeg-api/merge-videos"}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
