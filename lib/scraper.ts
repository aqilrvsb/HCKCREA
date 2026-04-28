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

export type ScrapedProduct = {
  ok: boolean;
  source: "tikhub" | "crawlbase-html" | "ogmeta" | "jsonld";
  product_name: string;
  product_image_url: string;
  description: string;
  price?: string;
  rating?: string;
  total_sold?: string;
  category?: string;
  raw_url: string;
  error?: string;
};

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

// Pull the long numeric product_id out of any TikTok Shop PDP URL shape:
//   .../shop/my/pdp/{slug}/1729703709970891793?…
//   .../view/product/1729493620818874839
//   .../shop/.../product/1729703709970891793
// Returns null for short links (vt.tiktok.com/ABC) — caller follows
// redirects and re-extracts from the resolved URL.
function extractTikTokProductId(url: string): string | null {
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
  const endpoint = `${cfg.base}/api/v1/tiktok/shop/web/fetch_product_detail_v3?product_id=${encodeURIComponent(productId)}`;

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

  // TikHub responses are typically { code, msg, data: {...} }. Extract
  // defensively because their schema varies between v1/v2/v3 endpoints.
  const root = json?.data || json?.result || json;
  const product = root?.product || root?.product_info || root?.productInfo || root;

  const productName =
    product.product_name ||
    product.title ||
    product.name ||
    product?.product_base?.title ||
    "";

  // Image candidates: gallery first → main → cover → og fallback.
  // TikTok APIs return image arrays in two shapes: plain string URLs OR
  // [{ url_list: [...] }] wrappers. Coerce defensively.
  const imageList: any[] =
    product.images ||
    product.image_urls ||
    product.gallery ||
    product?.product_base?.images ||
    [];
  const firstImage = Array.isArray(imageList) ? imageList[0] : null;
  const productImageUrl =
    (typeof firstImage === "string" ? firstImage : null) ||
    firstImage?.url_list?.[0] ||
    firstImage?.url ||
    product.image ||
    product.image_url ||
    product.cover_image ||
    product?.product_base?.cover_image ||
    "";

  const price =
    product.price?.toString?.() ||
    product?.price_info?.price?.toString?.() ||
    product?.product_price?.toString?.() ||
    product?.product_base?.price?.toString?.() ||
    "";

  const rating =
    product.rating?.toString?.() ||
    product?.review_info?.score?.toString?.() ||
    product?.product_base?.rating?.toString?.() ||
    "";

  const totalSold =
    product.sold?.toString?.() ||
    product?.sold_count?.toString?.() ||
    product?.sales_count?.toString?.() ||
    product?.product_base?.sold_count?.toString?.() ||
    "";

  const category =
    product.category ||
    product.category_name ||
    product?.product_base?.category_name ||
    "";

  const descParts: string[] = [];
  const desc =
    product.description ||
    product.detail_text ||
    product?.product_base?.description;
  if (desc) descParts.push(typeof desc === "string" ? desc : JSON.stringify(desc));
  if (Array.isArray(product.specifications)) {
    descParts.push(
      ...product.specifications
        .map((s: any) => `${s.name || s.key || ""}: ${s.value || ""}`)
        .filter((s: string) => s.length > 2)
    );
  }
  const description = descParts.join("\n").trim();

  // If TikHub returned an error envelope, surface it cleanly.
  if (json?.code && Number(json.code) !== 200 && !productName) {
    return errResult(
      originalUrl,
      `TikHub error: ${json?.msg || JSON.stringify(json).substring(0, 200)}`
    );
  }

  const finalImage = String(productImageUrl || "");

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
// Public entry point. Only TikTok + Shopee are supported right now —
// everything else returns a clean error so the user knows up front
// instead of getting a generic "Scrape returned no product data".
// ──────────────────────────────────────────────────────────────────────────

export async function scrapeAffiliateUrl(rawUrl: string): Promise<ScrapedProduct> {
  if (isTikTokUrl(rawUrl)) {
    return scrapeViaTikHub(rawUrl);
  }
  if (isShopeeUrl(rawUrl)) {
    return scrapeViaCrawlbase(rawUrl);
  }
  return errResult(
    rawUrl,
    "Only TikTok Shop and Shopee links are supported for now. Use Manual Product for other platforms."
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
