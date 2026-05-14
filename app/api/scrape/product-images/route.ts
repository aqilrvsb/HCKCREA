import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCrawlbaseConfig } from "@/lib/settings";

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

  const images = extractGoogleImageUrls(html, 5);
  return NextResponse.json({ ok: true, images, query });
}

// Extract real (non-thumbnail) image URLs from Google Images HTML. Google
// embeds the originals inside a JSON island; we scan for raw URLs and
// reject everything that's clearly a Google-owned thumb / icon / favicon.
function extractGoogleImageUrls(html: string, limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  // Pattern 1 — quoted https URLs ending in an image extension. Covers
  // the cases where Google's JS payload serializes the original as a
  // JSON string. Allows querystrings (CDNs love them).
  const re = /"(https?:\/\/[^"\s]+?\.(?:jpe?g|png|webp|gif)(?:\?[^"\s]*)?)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1];
    // Decode unicode escapes Google emits in JSON ("=" etc).
    const url = raw.replace(/\\u003d/gi, "=").replace(/\\u0026/gi, "&");
    if (seen.has(url)) continue;
    if (!isLikelyProductImage(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

function isLikelyProductImage(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    // Google's own image CDNs serve thumbnails / icons / placeholders,
    // not original product photos. Drop them.
    if (host.endsWith("gstatic.com")) return false;
    if (host.endsWith("googleusercontent.com")) return false;
    if (host.endsWith("google.com")) return false;
    if (host.endsWith("googleadservices.com")) return false;
    if (host.endsWith("googlesyndication.com")) return false;
    if (host.endsWith("ggpht.com")) return false;
    if (host.endsWith("ytimg.com")) return false;
    // Common favicon / sprite paths.
    if (/(?:^|\/)favicon\.(?:ico|png)/i.test(u.pathname)) return false;
    if (/sprite|logo[-_]?\d*\.(?:png|svg)/i.test(u.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}
