// Crawlbase scraper wrapper — pulls product details from affiliate URLs.
//
// Two paths:
//   1. TikTok Shop / TikTok product URL → use Crawlbase's named scraper
//      (`scraper=tiktok-product`). Returns structured JSON directly.
//   2. Anything else (Shopee, Lazada, generic) → use Crawlbase JS token
//      with ajax_wait so the SPA hydrates. Parse the rendered HTML for
//      og:image, og:title, JSON-LD product schema.
//
// Auth: Crawlbase needs the JavaScript token for SPA-rendered targets;
// the named scrapers also accept the normal token. We prefer the JS
// token for everything when both are configured — the named scrapers
// still work and we get JS-rendered fallback "for free" when the URL
// isn't a TikTok Shop link.
//
// Docs: https://crawlbase.com/docs/crawling-api/

import { getCrawlbaseConfig } from "@/lib/settings";

export type ScrapedProduct = {
  ok: boolean;
  source: "tiktok-product" | "ogmeta" | "jsonld";
  product_name: string;
  product_image_url: string;
  description: string;
  price?: string;
  rating?: string;
  total_sold?: string;
  category?: string;
  raw_url: string; // original URL (post-redirect resolution if applicable)
  error?: string;
};

const TIKTOK_HOSTS = [
  "tiktok.com",
  "www.tiktok.com",
  "shop.tiktok.com",
  "vt.tiktok.com",
  "vm.tiktok.com",
];

function isTikTokUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return TIKTOK_HOSTS.some((t) => h === t || h.endsWith("." + t));
  } catch {
    return false;
  }
}

// Extract first match of a regex group from haystack. Used for og: meta
// + JSON-LD parsing without a full HTML parser dependency.
function extract(re: RegExp, html: string): string | null {
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

// Best-effort parser for the Crawlbase tiktok-product JSON response. Their
// docs don't publish the exact schema, so we try common shapes.
function parseTikTokProductBody(body: any, originalUrl: string): ScrapedProduct {
  // Crawlbase often nests the parsed result under `body` or returns it
  // at the top level.
  const root = body?.body || body || {};
  const product =
    root.product ||
    root.productInfo ||
    root.data ||
    root;

  const productName =
    product.title ||
    product.name ||
    product.productName ||
    product.product_name ||
    "";

  const images: string[] =
    product.images ||
    product.image_urls ||
    product.gallery ||
    [];
  const productImageUrl =
    (Array.isArray(images) && images[0]) ||
    product.image ||
    product.image_url ||
    product.thumbnail ||
    "";

  const price =
    product.price?.toString?.() ||
    product.salePrice?.toString?.() ||
    product.discountPrice?.toString?.() ||
    "";

  const rating =
    product.rating?.toString?.() ||
    product.reviewScore?.toString?.() ||
    "";

  const totalSold =
    product.sold?.toString?.() ||
    product.salesCount?.toString?.() ||
    product.totalSold?.toString?.() ||
    "";

  const category =
    product.category ||
    product.categoryName ||
    "";

  const descriptionParts: string[] = [];
  if (product.description) descriptionParts.push(String(product.description));
  if (Array.isArray(product.features)) descriptionParts.push(...product.features.map(String));
  if (Array.isArray(product.specifications)) {
    descriptionParts.push(
      ...product.specifications
        .map((s: any) => `${s.name || s.key || ""}: ${s.value || ""}`)
        .filter((s: string) => s.length > 2)
    );
  }
  const description = descriptionParts.join("\n").trim();

  return {
    ok: !!productName,
    source: "tiktok-product",
    product_name: String(productName),
    product_image_url: String(productImageUrl),
    description,
    price: price || undefined,
    rating: rating || undefined,
    total_sold: totalSold || undefined,
    category: category || undefined,
    raw_url: originalUrl,
  };
}

// Pull product fields out of a generic SPA's rendered HTML. og: meta
// covers name + image + description on every well-marked page; JSON-LD
// adds price / rating when present.
function parseGenericHtml(html: string, originalUrl: string): ScrapedProduct {
  // og:title / og:image / og:description — most marketplaces emit these.
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

  // JSON-LD Product schema — pulls price + rating if present.
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
          price =
            String(c?.offers?.price ?? c?.offers?.[0]?.price ?? price);
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

// Public entry point. Hits Crawlbase, returns a normalized ScrapedProduct.
export async function scrapeAffiliateUrl(rawUrl: string): Promise<ScrapedProduct> {
  const cfg = await getCrawlbaseConfig();
  if (!cfg.base) {
    return errResult(rawUrl, "Crawlbase not configured");
  }
  const token = cfg.tokenJs || cfg.token;
  if (!token) {
    return errResult(rawUrl, "Crawlbase token missing — set crawlbase_token_js in admin settings");
  }

  const isTikTok = isTikTokUrl(rawUrl);
  const params = new URLSearchParams({
    token,
    url: rawUrl,
  });
  // For TikTok we use the dedicated scraper that returns parsed JSON.
  // For everything else we just want the JS-rendered HTML and we'll
  // extract og:meta / JSON-LD ourselves.
  if (isTikTok) {
    params.set("scraper", "tiktok-product");
  } else {
    // Wait for the SPA's first AJAX batch + give it a couple of extra
    // seconds; tuned for Shopee/Lazada PDPs.
    params.set("ajax_wait", "true");
    params.set("page_wait", "5000");
    params.set("country", "MY");
  }

  const endpoint = `${cfg.base}/?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "GET",
      // Crawlbase recommends a generous timeout; pages can take 10-15s.
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

  if (isTikTok) {
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return errResult(rawUrl, "Crawlbase returned non-JSON for tiktok-product scraper");
    }
    return parseTikTokProductBody(json, rawUrl);
  }

  // Generic path — text is HTML.
  return parseGenericHtml(text, rawUrl);
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
