import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCrawlbaseConfig } from "@/lib/settings";
import { deduct } from "@/lib/deduct";

// Flat fee charged per successful scrape (returns >SCRAPE_MIN_IMAGES
// images). Tunable here without a migration. Cost basis: Crawlbase
// JS render (~RM 0.013) so 10 sen leaves ~85% margin.
const SCRAPE_FEE_MYR = 0.10;
const SCRAPE_MIN_IMAGES = 6;

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/scrape/product-images
//   body: { query: string }
//   resp: { ok: true, images: string[] }  // up to 5 direct image URLs
//
// Pulls top product image candidates from Google Images for the given
// query, used by the Auto Content + UGC "Scrape" button to auto-fill
// attachment slots. The picker UI shows the raw 5 and the user multi-
// picks; we don't try to rank server-side (yet).
export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const rawQuery = String(body?.query || "").trim();
  if (!rawQuery) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  if (rawQuery.length > 500) {
    return NextResponse.json({ error: "query too long" }, { status: 400 });
  }
  // Strip everything after a hyphen / en-dash / em-dash / pipe separator
  // surrounded by spaces. Affiliate scrapes stamp the product info as
  // "<name> - <long marketing description>", and Google Images returns
  // garbage when the description is included. Trims to the name only.
  // E.g. "LUQFA Lotion 100ml  - Mencerahkan dengan DNA Salmon"
  //   → "LUQFA Lotion 100ml"
  const query = rawQuery
    .replace(/\s+[-–—|:]\s+.*$/, "")
    .trim()
    .slice(0, 120);
  if (!query) {
    return NextResponse.json({ error: "empty after cleanup" }, { status: 400 });
  }

  const cfg = await getCrawlbaseConfig();
  // Prefer the JS-rendering token — Google Images is heavily JS-driven
  // and the static HTML payload often only contains base64 thumbs.
  const token = cfg.tokenJs || cfg.token;
  if (!cfg.base || !token) {
    return NextResponse.json(
      { error: "Crawlbase token not configured" },
      { status: 503 }
    );
  }

  const target =
    `https://www.google.com/search?q=${encodeURIComponent(query)}` +
    `&tbm=isch&hl=en&safe=active`;
  const params = new URLSearchParams({
    token,
    url: target,
    ajax_wait: "true",
    page_wait: "3500",
  });
  const endpoint = `${cfg.base}/?${params.toString()}`;

  let html = "";
  try {
    const res = await fetch(endpoint, {
      method: "GET",
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Crawlbase HTTP ${res.status}`, detail: txt.slice(0, 200) },
        { status: 502 }
      );
    }
    html = await res.text();
  } catch (e: any) {
    return NextResponse.json(
      { error: `Crawlbase fetch failed: ${e?.message || "network"}` },
      { status: 502 }
    );
  }

  // Return up to 30 raw candidates in Google's own ranking order. We
  // deliberately do NOT run an AI re-ranking pass — the user prefers
  // to pick manually because their definition of "good" includes both
  // clean hero shots AND social-proof lifestyle shots, which any
  // automated ranker would wrongly downvote.
  const images = extractGoogleImageUrls(html, 30);

  // Charge ONLY when the scrape returned a meaningful pool (>6 images).
  // No refund logic — if the user got fewer than 7 we treat the call
  // as too low-yield to bill, and absorb the Crawlbase cost ourselves.
  // No pre-flight balance check either: users can scrape on credit
  // (decrement_credits allows negative balance) and top up later.
  let charged = 0;
  let balance_after: number | null = null;
  if (images.length > SCRAPE_MIN_IMAGES) {
    try {
      const r = await deduct(user.id, "scrape", SCRAPE_FEE_MYR);
      charged = SCRAPE_FEE_MYR;
      balance_after = r.after;
    } catch (e) {
      // Surfacing this to the user has no useful action — they got the
      // value already. Log for audit and move on.
      console.error("[scrape] deduct failed", e);
    }
  }

  return NextResponse.json({
    ok: true,
    images,
    query,
    charged,
    balance_after,
  });
}

// Extract image URLs from Google Images lite/no-JS HTML. Crawlbase
// (and most non-browser UAs) get served Google's lightweight SERP,
// where the actual search-result thumbnails are <img src="..."> tags
// pointing at encrypted-tbn0.gstatic.com/images?q=tbn:<hash>. Those
// hashes serve real product photos at ~300px — small but workable as
// Veo r2v references. We pull up to 30 so the picker shows the same
// amount of variety the user would see on google.com themselves.
//
// Strategy:
//   1. Pull every <img src="..."> attribute value from the HTML.
//   2. Decode HTML entities (&amp; → &) so URLs are usable as-is.
//   3. Keep tbn:* gstatic thumbnails (they ARE the image search hits)
//      plus any non-Google CDN that lasted through the lite page.
//   4. Reject favicons, sprites, 1x1 trackers.
function extractGoogleImageUrls(html: string, limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1];
    const url = decodeHtmlEntities(raw);
    if (!url.startsWith("http")) continue;
    if (seen.has(url)) continue;
    if (!isAcceptableImageUrl(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= limit) break;
  }

  // Fallback — if the img-tag pass came up dry (Crawlbase may rarely
  // serve a JSON-only payload), sweep raw URL tokens too.
  if (out.length === 0) {
    const re2 = /https?:\/\/encrypted-tbn[0-9]\.gstatic\.com\/images\?q=tbn:[^\s"'<>&]+/gi;
    const mm = html.match(re2) || [];
    for (const raw of mm) {
      const url = decodeHtmlEntities(raw);
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function isAcceptableImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    // encrypted-tbn0.gstatic.com/images?q=tbn:... — these ARE the
    // actual image search results in Google's lite SERP. Keep them.
    if (/^encrypted-tbn\d\.gstatic\.com$/.test(host)) {
      return /^\/images$/.test(path) && u.searchParams.get("q")?.startsWith("tbn:") === true;
    }
    // Other Google-owned hosts almost never serve product images we want.
    if (host.endsWith("google.com")) return false;
    if (host.endsWith("googleadservices.com")) return false;
    if (host.endsWith("googlesyndication.com")) return false;
    if (host.endsWith("googleusercontent.com")) return false;
    if (host.endsWith("ggpht.com")) return false;
    if (host.endsWith("ytimg.com")) return false;
    if (host.endsWith("gstatic.com")) return false; // non-tbn gstatic = sprites/icons
    // Tracker/transparent-pixel patterns.
    if (/(?:^|\/)(?:favicon|sprite|spacer|pixel|1x1|transparent|logo[-_]?\d*)\.(?:ico|png|gif|svg|webp)$/i.test(path)) return false;
    return true;
  } catch {
    return false;
  }
}
