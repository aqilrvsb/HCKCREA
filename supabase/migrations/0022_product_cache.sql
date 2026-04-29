-- 0022 — TikTok product cache + per-user fetch history
--
-- Two tables:
--
-- 1. tiktok_product_cache — GLOBAL, public scraped product data. Keyed by
--    product_id so the same viral product fetched by 100 users only pays
--    one TikHub scrape. Cache TTL is 30 days (enforced in app code, not
--    DB) — most products' price/sold count is fine to be slightly stale
--    for content generation. RH-hosted image URL is cached too so we
--    skip the re-upload step on cache hits.
--
-- 2. user_product_history — per-user, last-N-products dropdown source.
--    Composite key (user_id, product_id) so re-fetching the same product
--    just bumps last_used_at. The Auto Content tab queries this to show
--    a "Your recent products" autocomplete.
--
-- No RLS — both tables are accessed exclusively via the service-role
-- admin client from server routes; RLS would be redundant overhead.

CREATE TABLE IF NOT EXISTS tiktok_product_cache (
  product_id          TEXT PRIMARY KEY,
  raw_url             TEXT,
  product_name        TEXT NOT NULL,
  product_image_url   TEXT,         -- original TikTok CDN URL
  hosted_image_url    TEXT,         -- RunningHub-rehosted URL (skip re-upload on hit)
  description         TEXT,
  price               TEXT,
  rating              TEXT,
  total_sold          TEXT,
  category            TEXT,
  source              TEXT,         -- "tikhub" / "scrapecreators" / etc
  scraped_at          TIMESTAMPTZ DEFAULT NOW(),
  last_used_at        TIMESTAMPTZ DEFAULT NOW(),
  use_count           INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS tiktok_product_cache_last_used_idx
  ON tiktok_product_cache (last_used_at DESC);

CREATE TABLE IF NOT EXISTS user_product_history (
  user_id      UUID NOT NULL,
  product_id   TEXT NOT NULL,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS user_product_history_user_idx
  ON user_product_history (user_id, last_used_at DESC);
