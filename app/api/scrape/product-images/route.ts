import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCrawlbaseConfig } from "@/lib/settings";
import { orChatVision } from "@/lib/openrouter";

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

  // Over-fetch up to 25 candidates so the ranking pass has room to
  // sift out the ones with marketing banners / text overlays / busy
  // backgrounds. We return the cleanest 5 — bigger pool = more chance
  // of finding multiple white-bg retailer shots.
  const candidates = extractGoogleImageUrls(html, 25);

  let images = candidates.slice(0, 5);
  let ranked = false;
  if (candidates.length > 5) {
    try {
      const ordered = await rankByNakedProductQuality(candidates, query);
      if (ordered.length > 0) {
        images = ordered.slice(0, 5);
        ranked = true;
      }
    } catch {
      // Ranking is best-effort. If Gemini fails, fall back to the raw
      // top-5 from Google. User can still pick visually in the modal.
    }
  }
  return NextResponse.json({ ok: true, images, query, ranked });
}

// Rank candidate URLs by "naked product" quality using Gemini vision.
// We want the CLEAN isolated bottle shot (white/neutral bg, single
// product, no text/banner overlay) because Veo r2v tries to replicate
// whatever it sees, so marketing graphics leak into the generated
// video. Returns URLs sorted by score descending.
async function rankByNakedProductQuality(
  urls: string[],
  productName: string
): Promise<string[]> {
  if (urls.length === 0) return [];
  const numbered = urls.slice(0, 25);
  const indexedList = numbered.map((_, i) => `Image ${i}`).join(", ");

  const r = await orChatVision({
    modelKey: "model_vision",
    systemPrompt:
      "You score product images for use as Veo r2v reference frames. " +
      "Return ONLY a JSON object — no prose, no markdown fences.",
    textPrompt:
      `Product: "${productName}"\n\n` +
      `Below are ${numbered.length} candidate images (${indexedList}) — same order they appear after this text.\n\n` +
      `Score each on the "naked product" criteria, where higher = better Veo input:\n` +
      `- 100: clean white/neutral background, single product centered, NO marketing text/banner/overlay, label readable, real photo\n` +
      `- 70: mostly clean but small badge or watermark\n` +
      `- 40: prominent banner / text overlay covers part of frame\n` +
      `- 10: heavy marketing graphic, infographic, illustration, 3D render, or multiple products\n` +
      `- 0: not the product at all (wrong SKU, knockoff, irrelevant image)\n\n` +
      `Return JSON: {"ranked":[{"i":<index>,"s":<0-100>}, ...]} ` +
      `sorted by s DESC. Include every image exactly once.`,
    images: numbered,
    temperature: 0.2,
    maxTokens: 800,
  });
  if (!r.ok || !r.content) return [];

  // Strip ```json fences and stray prose if any leak through.
  const cleaned = r.content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  if (start < 0) return [];
  const parsed = JSON.parse(cleaned.slice(start));
  const rows: Array<{ i: number; s: number }> = Array.isArray(parsed?.ranked)
    ? parsed.ranked
    : [];

  const ordered = rows
    .filter(
      (row) =>
        typeof row?.i === "number" &&
        row.i >= 0 &&
        row.i < numbered.length &&
        typeof row?.s === "number"
    )
    .sort((a, b) => (b.s || 0) - (a.s || 0))
    .map((row) => numbered[row.i]);

  // Dedup (Gemini sometimes lists the same index twice) and backfill
  // any URLs the model dropped so we never lose candidates entirely.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of ordered) {
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  for (const u of numbered) {
    if (!seen.has(u)) out.push(u);
  }
  return out;
}

// Extract image URLs from Google Images lite/no-JS HTML. Crawlbase
// (and most non-browser UAs) get served Google's lightweight SERP,
// where the actual search-result thumbnails are <img src="..."> tags
// pointing at encrypted-tbn0.gstatic.com/images?q=tbn:<hash>. Those
// hashes serve real product photos at ~300px — small but workable as
// Veo r2v references.
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
