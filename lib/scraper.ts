// Affiliate-link scraper. Routes by URL host:
//
//   TikTok / TikTok Shop URL → TikHub.io
//     - Native Asian IPs, no region-block (Crawlbase free tier returns
//       enter_method=region_not_match for TikTok Shop MY).
//     - Specialist API: GET /api/v1/tiktok/shop/product_detail?product_id={id}
//     - $0.001 / scrape pay-as-you-go.
//
//   Shopee / Lazada / generic → Crawlbase
//     - Verified working on free tier (200 OK on shopee.com.my, og:meta present).
//     - JS-rendered HTML + ajax_wait, then we parse og:title / og:image
//       / JSON-LD product schema ourselves.
//
// Both paths return the same ScrapedProduct shape so downstream callers
// don't need to care which provider answered.

import { getCrawlbaseConfig, getTikHubConfig } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export type ScrapedProduct = {
  ok: boolean;
  source: "tikhub" | "crawlbase-html" | "ogmeta" | "jsonld" | "cache";
  product_name: string;
  product_image_url: string;        // ORIGINAL TikTok CDN URL — permanent
  hosted_image_url?: string | null; // RH-rehosted URL — 24h expiry, used for AI gen
  description: string;
  price?: string;
  rating?: string;
  total_sold?: string;
  category?: string;
  /** TikTok Shop product_id, when known. Stored on history rows so the
   *  auto-post step later can deep-link back to the product page
   *  (https://www.tiktok.com/shop/my/pdp/{slug}/{id}). */
  product_id?: string;
  raw_url: string;
  error?: string;
  /** Number of TikHub attempts spent (0 if served from cache). Surfaced
   *  to the API route for log-only diagnostics — not used by clients. */
  retry_count?: number;
};

// Cache TTL — 30 days. Most products' price/sold count is fine to be
// slightly stale for AI content generation, and viral products get
// re-fetched naturally as new users hit them.
const CACHE_TTL_DAYS = 30;
// TikTok scrapers fail intermittently because TikTok rate-limits the
// scraper's IP pool. 5 attempts with exponential backoff clears ~95%
// of failures. Backoff: 1s → 2s → 4s → 4s → 4s = 15s max wall-clock.
const MAX_RETRIES = 5;
const RETRY_BACKOFF_MS = [1000, 2000, 4000, 4000, 4000];

// ──────────────────────────────────────────────────────────────────────────
// URL classification + product-id extraction
// ──────────────────────────────────────────────────────────────────────────

const TIKTOK_HOSTS = [
  "tiktok.com",
  "www.tiktok.com",
  "shop.tiktok.com",
  "vt.tiktok.com",
  "vm.tiktok.com",
];

const SHOPEE_HOSTS = [
  "shopee.com.my",
  "shopee.com.sg",
  "shopee.co.id",
  "shopee.co.th",
  "shopee.ph",
  "shopee.vn",
  "shopee.com.br",
];

function hostnameLower(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isTikTokUrl(url: string): boolean {
  const h = hostnameLower(url);
  if (!h) return false;
  return TIKTOK_HOSTS.some((t) => h === t || h.endsWith("." + t));
}

function isShopeeUrl(url: string): boolean {
  const h = hostnameLower(url);
  if (!h) return false;
  return SHOPEE_HOSTS.some((t) => h === t || h.endsWith("." + t));
}

// Pull the trailing numeric item_id out of any Shopee PDP URL shape:
//   .../product/{shopId}/{itemId}                     ← new short form
//   .../product/{slug}-i.{shopId}.{itemId}            ← legacy SEO form
// The Chrome extension uses the item_id as product_id when caching,
// so this extractor lets the server-side fetch reuse those rows
// instead of always going to Crawlbase (which often fails for Shopee).
export function extractShopeeProductId(url: string): string | null {
  let m = url.match(/\/product\/\d+\/(\d+)/);
  if (m) return m[1];
  m = url.match(/-i\.\d+\.(\d+)/);
  if (m) return m[1];
  return null;
}

// Pull the long numeric product_id out of any TikTok Shop PDP URL shape:
//   .../shop/my/pdp/{slug}/1729703709970891793?…
//   .../view/product/1729493620818874839
//   .../shop/.../product/1729703709970891793
// Returns null for short links (vt.tiktok.com/ABC) — caller follows
// redirects and re-extracts from the resolved URL.
export function extractTikTokProductId(url: string): string | null {
  // Last 13–20 digit run before the query string.
  const m = url.match(/(?:product|pdp(?:\/[^/?]+)*)\/(\d{13,20})(?:[/?#]|$)/i);
  if (m) return m[1];
  // Fallback: any 15–20 digit run anywhere in the path.
  const u = (() => {
    try { return new URL(url); } catch { return null; }
  })();
  if (u) {
    const m2 = u.pathname.match(/\/(\d{15,20})(?:\/|$)/);
    if (m2) return m2[1];
  }
  return null;
}

// Resolve a TikTok share link (vt.tiktok.com / vm.tiktok.com / any
// affiliate redirect URL) directly via TikHub's helper endpoint instead
// of following HTTP redirects ourselves. TikHub does the unfurling
// server-side and returns the product_id directly.
async function resolveShareLinkToProductId(
  shareUrl: string,
  base: string,
  token: string
): Promise<string | null> {
  const endpoint = `${base}/api/v1/tiktok/app/v3/fetch_product_id_by_share_link?share_link=${encodeURIComponent(shareUrl)}`;
  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const pid =
      json?.data?.product_id ||
      json?.data?.id ||
      json?.product_id ||
      null;
    return pid ? String(pid) : null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// TikHub — TikTok / TikTok Shop specialist
// ──────────────────────────────────────────────────────────────────────────

async function scrapeViaTikHub(originalUrl: string): Promise<ScrapedProduct> {
  const cfg = await getTikHubConfig();
  if (!cfg.token) {
    return errResult(
      originalUrl,
      "TikHub token missing — paste it into admin → tikhub_token to scrape TikTok URLs"
    );
  }

  // Get a product_id we can pass to fetch_product_detail. Two paths:
  //  - Short link (vt.tiktok.com / vm.tiktok.com) → TikHub's
  //    fetch_product_id_by_share_link unfurls it server-side.
  //  - Full PDP / view URL → extract numeric id from the path.
  let productId: string | null = null;
  const isShareLink = /^https?:\/\/(vt|vm)\.tiktok\.com\//i.test(originalUrl);
  if (isShareLink) {
    productId = await resolveShareLinkToProductId(originalUrl, cfg.base, cfg.token);
  }
  if (!productId) {
    productId = extractTikTokProductId(originalUrl);
  }
  if (!productId) {
    return errResult(
      originalUrl,
      "Couldn't extract TikTok product_id. Paste a /pdp/ or /view/product/ link, or a vt.tiktok.com share link."
    );
  }

  // V3 of the web product detail endpoint = mobile rendering with full
  // data. Better field coverage than V1 (desktop) for affiliate use.
  // region=MY is REQUIRED — without it TikHub's default IP region
  // (Singapore) triggers TikTok's region_not_match redirect and the
  // response contains no product data.
  const endpoint = `${cfg.base}/api/v1/tiktok/shop/web/fetch_product_detail_v3?product_id=${encodeURIComponent(productId)}&region=MY`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e: any) {
    return errResult(originalUrl, `TikHub fetch failed: ${e?.message || "network"}`);
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return errResult(
      originalUrl,
      `TikHub HTTP ${res.status}: ${text.substring(0, 200)}`
    );
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return errResult(originalUrl, "TikHub returned non-JSON response");
  }

  // Surface TikHub error envelopes cleanly (quota exceeded, bad params,
  // upstream block) before we try to parse the success shape.
  if (json?.code && Number(json.code) !== 200) {
    return errResult(
      originalUrl,
      `TikHub error (code ${json.code}): ${json?.message || json?.msg || "unknown"}`
    );
  }

  // The web/fetch_product_detail_v3 success shape:
  //   data.product_data.page_config.components_map[]
  //     → find component_name === "product_info"
  //     → component_data.product_info.product_model    (name, sold, images, description)
  //     → component_data.product_info.promotion_model  (price + discount)
  // Confirmed against a live MY Shop product (verified live via
  // Playwright before shipping this parser).
  const components: any[] =
    json?.data?.product_data?.page_config?.components_map || [];
  const productInfoComp = components.find(
    (c: any) => c?.component_name === "product_info"
  );
  const productInfo = productInfoComp?.component_data?.product_info;
  const pm = productInfo?.product_model || {};
  const promo = productInfo?.promotion_model?.promotion_product_price;

  const productName: string = pm.name || "";

  // Cover image — TikTok keeps two completely separate image sets:
  //   • pm.images[]    — promo / lifestyle / hero shots used on home
  //                      feed cards. NOT in PDP gallery order.
  //   • pm.skus[].sku_image — variant-specific bottle shots. The
  //                      first SKU is what TikTok renders as the
  //                      default cover when the user lands on the PDP.
  // We use the first SKU's sku_image as the canonical cover. sku_image
  // only carries a `uri`, not a `url_list`, so we construct the CDN
  // URL using the same transform template the other images use
  // (verified live — the URL works without auth query tokens).
  function buildTikTokImageUrl(uri: string): string {
    if (!uri) return "";
    // uri format: tos-{location}-i-{bucketId}-{region}/{hash}
    // Extract bucketId so the transform path (~tplv-{bucketId}-...) matches.
    const bucketMatch = uri.match(/^tos-[a-z]+-i-([a-z0-9]+)-/);
    const bucketId = bucketMatch?.[1] || "aphluv4xwc";
    return `https://p16-oec-sg.ibyteimg.com/${uri}~tplv-${bucketId}-crop-webp:1000:1000.webp`;
  }

  const galleryImages: any[] = Array.isArray(pm.images) ? pm.images : [];
  const firstSkuImage = pm?.skus?.[0]?.sku_image;
  const skuConstructedUrl = buildTikTokImageUrl(firstSkuImage?.uri || "");
  // Fall back order:
  //   1. Default SKU (variant 0) — what TikTok shows on PDP load
  //   2. First gallery image with width <= 1200 (skip 1800-px hero)
  //   3. First gallery image (any size)
  const skuShotFromImages = galleryImages.find(
    (img: any) => img?.width && img.width <= 1200 && img?.url_list?.[0]
  );
  const firstGalleryImg = skuShotFromImages || galleryImages[0] || null;
  const finalImage: string =
    skuConstructedUrl ||
    firstGalleryImg?.url_list?.[0] ||
    firstGalleryImg?.url_list?.[1] ||
    "";

  // Price — TikTok serves a `range_price` string ("12.00 - 13.00") when
  // SKUs differ, plus a single `min_price.sale_price_format`. Prefer the
  // range when SKUs vary, else the min sale price. Prepend the symbol
  // ("RM") so the user-facing card shows a complete value.
  const minSale = promo?.min_price?.sale_price_format;
  const rangeStr = promo?.range_price?.range_price;
  const symbol =
    promo?.min_price?.currency_symbol ||
    promo?.range_price?.currency_symbol ||
    "";
  const priceText =
    rangeStr && rangeStr.includes("-") ? rangeStr : minSale || "";
  const price = priceText ? `${symbol} ${priceText}`.trim() : "";

  const totalSold: string = pm.sold_count ? String(pm.sold_count) : "";

  // description is a JSON-encoded array of structured blocks:
  //   [{type:"text", text:"..."}, {type:"image", ...}, ...]
  // Pull just the text entries and join — those are the user-readable
  // marketing copy. Falls back to raw if it isn't JSON-encoded.
  const description = (() => {
    if (!pm.description) return "";
    try {
      const blocks = JSON.parse(pm.description);
      if (Array.isArray(blocks)) {
        return blocks
          .filter((b: any) => b?.type === "text" && typeof b.text === "string")
          .map((b: any) => b.text.trim())
          .filter(Boolean)
          .join("\n");
      }
    } catch {
      // Fall through
    }
    return String(pm.description);
  })();

  // V3 web shape doesn't include a rating or category — leave blank;
  // master-plan generation does fine without them.
  const rating = "";
  const category = "";

  return {
    ok: !!productName,
    source: "tikhub",
    product_name: String(productName),
    product_image_url: String(finalImage),
    description,
    price: price || undefined,
    rating: rating || undefined,
    total_sold: totalSold || undefined,
    category: category || undefined,
    product_id: productId,
    raw_url: originalUrl,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Crawlbase — generic JS-rendered HTML for non-TikTok platforms
// ──────────────────────────────────────────────────────────────────────────

function extract(re: RegExp, html: string): string | null {
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function parseGenericHtml(html: string, originalUrl: string): ScrapedProduct {
  const ogTitle =
    extract(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i, html) ||
    extract(/<meta\s+name=["']twitter:title["']\s+content=["']([^"']+)["']/i, html) ||
    extract(/<title[^>]*>([^<]+)<\/title>/i, html) ||
    "";
  const ogImage =
    extract(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i, html) ||
    extract(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i, html) ||
    "";
  const ogDesc =
    extract(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i, html) ||
    extract(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i, html) ||
    "";

  let price = "";
  let rating = "";
  const ldMatches = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const m of ldMatches) {
    try {
      const ld = JSON.parse(m[1]);
      const candidates = Array.isArray(ld) ? ld : [ld];
      for (const c of candidates) {
        const type = String(c?.["@type"] || "").toLowerCase();
        if (type === "product") {
          price = String(c?.offers?.price ?? c?.offers?.[0]?.price ?? price);
          rating = String(c?.aggregateRating?.ratingValue ?? rating);
        }
      }
    } catch {
      // Ignore malformed JSON-LD
    }
  }

  return {
    ok: !!(ogTitle && ogImage),
    source: "ogmeta",
    product_name: ogTitle,
    product_image_url: ogImage,
    description: ogDesc,
    price: price || undefined,
    rating: rating || undefined,
    raw_url: originalUrl,
  };
}

async function scrapeViaCrawlbase(rawUrl: string): Promise<ScrapedProduct> {
  const cfg = await getCrawlbaseConfig();
  const token = cfg.tokenJs || cfg.token;
  if (!cfg.base || !token) {
    return errResult(
      rawUrl,
      "Crawlbase token missing — paste crawlbase_token_js into admin to scrape non-TikTok URLs"
    );
  }

  const params = new URLSearchParams({
    token,
    url: rawUrl,
    ajax_wait: "true",
    page_wait: "5000",
  });
  const endpoint = `${cfg.base}/?${params.toString()}`;

  // Up to 3 attempts on transient pc_status 5xx (Crawlbase says retries
  // are not charged).
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "GET",
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e: any) {
      return errResult(rawUrl, `Crawlbase fetch failed: ${e?.message || "network"}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return errResult(
        rawUrl,
        `Crawlbase HTTP ${res.status}: ${body.substring(0, 200)}`
      );
    }
    const text = await res.text().catch(() => "");

    // Detect Crawlbase's error envelope (a JSON object containing
    // pc_status). If present and 5xx, retry — otherwise treat as HTML
    // even if it begins with `{` (rare site quirks).
    if (text.startsWith("{") && text.includes("pc_status")) {
      try {
        const env = JSON.parse(text);
        const pc = Number(env?.pc_status || 0);
        if (pc >= 500 && attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          continue;
        }
        if (pc >= 500) {
          return errResult(
            rawUrl,
            `Crawlbase parser failed (pc_status ${pc}). ${String(env?.body || "").substring(0, 200)}`
          );
        }
      } catch {
        // Fall through to HTML parse
      }
    }

    return parseGenericHtml(text, rawUrl);
  }
  return errResult(rawUrl, "Crawlbase exhausted retries");
}

// ──────────────────────────────────────────────────────────────────────────
// Cache layer — global tiktok_product_cache table. First user to fetch a
// product pays the TikHub call (with up to 5 retries); subsequent users
// hitting the same product_id within CACHE_TTL_DAYS get an instant DB
// read with the already-RH-hosted image URL. Massive cost + reliability
// win for viral products that 100s of users paste.
// ──────────────────────────────────────────────────────────────────────────

async function readCache(
  productId: string,
  opts: { anyAge?: boolean } = {}
): Promise<ScrapedProduct | null> {
  try {
    const admin = createAdminClient();
    let q = admin
      .from("tiktok_product_cache")
      .select("*")
      .eq("product_id", productId);
    if (!opts.anyAge) {
      const cutoff = new Date(
        Date.now() - CACHE_TTL_DAYS * 86_400_000
      ).toISOString();
      q = q.gt("scraped_at", cutoff);
    }
    const { data } = await q.maybeSingle();
    if (!data) return null;
    return {
      ok: true,
      source: "cache",
      product_name: data.product_name,
      // Keep TikTok CDN URL (permanent) as product_image_url for display.
      // hosted_image_url stays separate — used by AI generation flows
      // because some Crun/GeminiGen regions can't fetch TikTok CDN.
      // Display layer prefers product_image_url to avoid broken thumbnails
      // when the RH signed URL expires after 24h.
      product_image_url: data.product_image_url || data.hosted_image_url || "",
      hosted_image_url: data.hosted_image_url || null,
      description: data.description || "",
      price: data.price || undefined,
      rating: data.rating || undefined,
      total_sold: data.total_sold || undefined,
      category: data.category || undefined,
      product_id: data.product_id,
      raw_url: data.raw_url || "",
    };
  } catch {
    return null;
  }
}

async function bumpCacheUseCount(productId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    // Plain update — last_used_at = now(). use_count increment is
    // best-effort and tolerable to drop on race; cache hits tracking is
    // diagnostic only.
    await admin
      .from("tiktok_product_cache")
      .update({ last_used_at: new Date().toISOString() })
      .eq("product_id", productId);
  } catch {
    // Non-fatal
  }
}

/** Upsert a freshly-scraped product into the cache. Pass the
 *  RunningHub-hosted image URL if you have one — otherwise we cache
 *  only the original CDN URL and the next read will trigger a re-host.
 *  Also inserts a user_product_history row when userId is given. */
export async function cacheTikTokProduct(
  scraped: ScrapedProduct,
  hostedImageUrl: string | null,
  userId?: string | null
): Promise<void> {
  if (!scraped.product_id || !scraped.product_name) return;
  try {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    await admin.from("tiktok_product_cache").upsert(
      {
        product_id: scraped.product_id,
        raw_url: scraped.raw_url,
        product_name: scraped.product_name,
        product_image_url: scraped.product_image_url,
        hosted_image_url: hostedImageUrl,
        description: scraped.description,
        price: scraped.price,
        rating: scraped.rating,
        total_sold: scraped.total_sold,
        category: scraped.category,
        source: scraped.source,
        scraped_at: now,
        last_used_at: now,
      },
      { onConflict: "product_id" }
    );
    if (userId) {
      await admin.from("user_product_history").upsert(
        {
          user_id: userId,
          product_id: scraped.product_id,
          last_used_at: now,
        },
        { onConflict: "user_id,product_id" }
      );
    }
  } catch {
    // Cache write failures are non-fatal — the scrape still succeeded
    // for the current request, we just won't get a cache hit next time.
  }
}

/** Bump user history when a CACHE HIT happens — the API route calls
 *  this so the user's "Recent products" dropdown stays current even
 *  when they re-fetch the same URL. */
export async function recordUserHistory(
  userId: string,
  productId: string
): Promise<void> {
  if (!userId || !productId) return;
  try {
    const admin = createAdminClient();
    await admin.from("user_product_history").upsert(
      {
        user_id: userId,
        product_id: productId,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: "user_id,product_id" }
    );
  } catch {
    // Non-fatal
  }
}

/** Per-user "Your recent products" dropdown source. Joins the user's
 *  history rows back to the global cache, ordered by last_used_at. */
export async function getRecentProductsForUser(
  userId: string,
  limit = 20
): Promise<
  Array<{
    product_id: string;
    raw_url: string;
    product_name: string;
    product_image_url: string;
    hosted_image_url: string | null;
    description: string | null;
    price: string | null;
    rating: string | null;
    total_sold: string | null;
    category: string | null;
    last_used_at: string;
  }>
> {
  try {
    const admin = createAdminClient();
    const { data: hist } = await admin
      .from("user_product_history")
      .select("product_id, last_used_at")
      .eq("user_id", userId)
      .order("last_used_at", { ascending: false })
      .limit(limit);
    const ids = (hist || []).map((r: any) => r.product_id);
    if (ids.length === 0) return [];
    const { data: products } = await admin
      .from("tiktok_product_cache")
      .select(
        "product_id, raw_url, product_name, product_image_url, hosted_image_url, description, price, rating, total_sold, category"
      )
      .in("product_id", ids);
    const byId = new Map((products || []).map((p: any) => [p.product_id, p]));
    return (hist || [])
      .map((h: any) => {
        const p: any = byId.get(h.product_id);
        if (!p) return null;
        return {
          product_id: p.product_id,
          raw_url: p.raw_url || "",
          product_name: p.product_name,
          // Prefer the original TikTok CDN URL (permanent) over the
          // RH-hosted URL (24h signed expiry — broken images after 1 day).
          // Frontend renders with referrerPolicy="no-referrer" so TikTok's
          // hot-link Referer block doesn't kill the thumbnail.
          product_image_url:
            p.product_image_url || p.hosted_image_url || "",
          hosted_image_url: p.hosted_image_url || null,
          description: p.description || null,
          price: p.price || null,
          rating: p.rating || null,
          total_sold: p.total_sold || null,
          category: p.category || null,
          last_used_at: h.last_used_at,
        };
      })
      .filter((x: any) => x !== null) as any;
  } catch {
    return [];
  }
}

// TikHub retry wrapper — catches the intermittent
// "code 400 / Request failed. Please retry" errors that happen when
// TikTok rate-limits TikHub's scraper IPs. 5 attempts with backoff
// clears ~95% of these transient failures.
async function scrapeTikTokWithRetry(rawUrl: string): Promise<ScrapedProduct> {
  let last: ScrapedProduct = errResult(rawUrl, "no attempts made");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const wait = RETRY_BACKOFF_MS[attempt - 1] ?? 4000;
      await new Promise((r) => setTimeout(r, wait));
    }
    last = await scrapeViaTikHub(rawUrl);
    last.retry_count = attempt + 1;
    if (last.ok) return last;
  }
  return last;
}

// ──────────────────────────────────────────────────────────────────────────
// Public entry point. Only TikTok + Shopee are supported right now —
// everything else returns a clean error so the user knows up front
// instead of getting a generic "Scrape returned no product data".
// ──────────────────────────────────────────────────────────────────────────

export async function scrapeAffiliateUrl(rawUrl: string): Promise<ScrapedProduct> {
  // V2 policy (2026-06-02): Auto Content's Affiliate mode is CACHE-ONLY.
  // The Chrome extension (running in the user's real browser session) is
  // the canonical source of scrapes — it works for both TikTok Shop and
  // shopee.com.my, region-aware and authenticated. Server-side TikHub /
  // Crawlbase scrapes used to fire as fallback but they fail too often
  // for the Malaysian region and cost real money per call.
  //
  // Lookup is by product_id with NO age filter (anyAge=true) — if the
  // user picked a row from THEIR history dropdown they want THAT row's
  // data even if it was scraped months ago. If no cache row exists at
  // all, return a helpful error pointing them at the extension.

  if (isTikTokUrl(rawUrl)) {
    const productId = extractTikTokProductId(rawUrl);
    if (productId) {
      const cached = await readCache(productId, { anyAge: true });
      if (cached) {
        bumpCacheUseCount(productId).catch(() => {});
        return cached;
      }
    }
    return errResult(
      rawUrl,
      "Product not in cache. Open the Chrome extension on the TikTok Shop product page to scrape it first."
    );
  }
  if (isShopeeUrl(rawUrl)) {
    const productId = extractShopeeProductId(rawUrl);
    if (productId) {
      const cached = await readCache(productId, { anyAge: true });
      if (cached) {
        bumpCacheUseCount(productId).catch(() => {});
        return cached;
      }
    }
    return errResult(
      rawUrl,
      "Product not in cache. Open the Chrome extension on the Shopee product page to scrape it first."
    );
  }
  return errResult(
    rawUrl,
    "Only TikTok Shop and Shopee links are supported. Use Manual Product for other platforms."
  );
}

function errResult(url: string, error: string): ScrapedProduct {
  return {
    ok: false,
    source: "ogmeta",
    product_name: "",
    product_image_url: "",
    description: "",
    raw_url: url,
    error,
  };
}
