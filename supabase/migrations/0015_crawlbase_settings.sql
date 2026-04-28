-- 0015 — Crawlbase scraper credentials
--
-- Crawlbase's Crawling API needs two tokens:
--   - normal token  — for static HTML (rare here)
--   - JavaScript token — for SPA-rendered pages (TikTok Shop, Shopee, Lazada)
-- They also expose named scrapers (e.g. ?scraper=tiktok-shop) that return
-- structured JSON instead of raw HTML.
--
-- Both keys live in app_settings so admin can rotate without redeploying.

insert into public.app_settings (key, value, description, category)
values
  ('crawlbase_base',
   jsonb_build_object('url', 'https://api.crawlbase.com'),
   'Crawlbase Crawling API base URL.',
   'provider'),
  ('crawlbase_token',
   jsonb_build_object('key', ''),
   'Crawlbase NORMAL token. Used for static HTML targets and named scrapers.',
   'provider'),
  ('crawlbase_token_js',
   jsonb_build_object('key', ''),
   'Crawlbase JavaScript token. Used for SPA-rendered pages (Shopee / Lazada / etc.).',
   'provider')
on conflict (key) do nothing;
