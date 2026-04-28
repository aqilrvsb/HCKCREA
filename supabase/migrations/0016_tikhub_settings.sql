-- 0016 — TikHub.io scraper credentials
--
-- TikHub is a TikTok / Douyin / TikTok Shop specialist API. It hits
-- TikTok's own infrastructure with native Asian IPs, so it bypasses the
-- region-block that kills generic scrapers (Crawlbase free tier returns
-- pc_status 503 with enter_method=region_not_match for TikTok Shop MY).
--
-- Pricing: pay-as-you-go from $0.001/request. Free 50 requests on signup.
-- We route TikTok URLs through TikHub and fall back to Crawlbase for
-- Shopee / Lazada / generic affiliate links.

insert into public.app_settings (key, value, description, category)
values
  ('tikhub_base',
   jsonb_build_object('url', 'https://api.tikhub.io'),
   'TikHub API base URL.',
   'provider'),
  ('tikhub_token',
   jsonb_build_object('key', ''),
   'TikHub API key (Bearer token). Get one at https://tikhub.io.',
   'provider')
on conflict (key) do nothing;
