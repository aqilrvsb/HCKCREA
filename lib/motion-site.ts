// Motion "Edit Video" — the seller's own product website (optional field).
//
// When the seller gives their sales-page link, that page is the ground truth:
//   • B-roll photos come ONLY from it (never another brand's product shot)
//   • product names / ingredients / how-to-use come from its text (director +
//     caption spelling fixes), fact cards are written from its paragraphs
//   • STRICT: no Google search at all — a page that can't be read (JS-only
//     site) simply gives no photos, and the edit runs without B-roll.
// Marketplace / social links (admin's excluded sites) are refused unless the
// admin allows that platform (motion_search.link_platforms, default TikTok —
// a TikTok Shop page gives its own product photos, a video its caption).
//
// Fetched server-side from a user-supplied URL, so every hop is SSRF-checked:
// http(s) only, default ports, no IP literals / internal names, DNS must not
// resolve to a private address, redirects re-checked, size + time capped.
// Results are cached 24 h in motion_search_cache (kind "site").
// Nothing here throws to the caller — a failed read is `ok: false`.

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createAdminClient } from "@/lib/supabase/admin";
import { isExcludedHost, linkAllowed, type ImageHit, type SitePrefs, type WebHit } from "@/lib/motion-search";

export type SiteInfo = {
  ok: boolean;
  url: string;
  host: string;
  /** Brand / shop name (og:site_name, else the title's first part). */
  name: string;
  title: string;
  description: string;
  /** Visible page text (all pages read), for the director + fact cards. */
  text: string;
  images: ImageHit[];
  pages: number;
  via: "scrape" | "none";
  error?: string;
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const PAGE_TIMEOUT_MS = 9_000;
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const EXTRA_PAGES = 3;
const MAX_IMAGES = 60;
const MAX_TEXT = 6000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SITE_CACHE_VERSION = 3;

// ── URL checks (pure) ─────────────────────────────────────────────────────────

const stripWww = (h: string) => h.toLowerCase().replace(/^www\./, "");

/** "gluverahq.com/x" → "https://gluverahq.com/x"; null when not a public web URL. */
export function normalizeSiteUrl(raw: unknown): string | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || isIP(host.replace(/^\[|\]$/g, ""))) return null;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host)) return null;
  u.hash = "";
  return u.toString().slice(0, 500);
}

/** Private / loopback / link-local / CGNAT / multicast / reserved address? */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9")
    || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

async function publicHost(host: string): Promise<boolean> {
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

/** GET an HTML page with every redirect hop re-checked; null on any failure. */
async function fetchHtml(url: string): Promise<{ url: string; html: string } | null> {
  let cur = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safe = normalizeSiteUrl(cur);
    if (!safe || !(await publicHost(new URL(safe).hostname))) return null;
    let res: Response;
    try {
      res = await fetch(safe, {
        redirect: "manual",
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "Accept-Language": "ms-MY,ms;q=0.9,en;q=0.8" },
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      cur = new URL(loc, safe).toString();
      continue;
    }
    if (!res.ok || !/html/i.test(res.headers.get("content-type") || "")) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_HTML_BYTES) { await reader.cancel(); break; }
        chunks.push(value);
      }
    } catch {
      if (!chunks.length) return null;
    }
    return { url: safe, html: Buffer.concat(chunks).toString("utf8") };
  }
  return null;
}

// ── HTML → page info (pure, exported for tests) ──────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "–", mdash: "—", hellip: "…" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "").trim() : "";
};
const meta = (html: string, key: string) => {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const t = m[0];
    if ((attr(t, "property") || attr(t, "name")).toLowerCase() === key) return attr(t, "content");
  }
  return "";
};

/** Largest candidate of a srcset ("a.jpg 300w, b.jpg 1024w" → b.jpg). */
function largestFromSrcset(srcset: string): string {
  let best = "";
  let bestW = -1;
  for (const part of srcset.split(",")) {
    const [u, d] = part.trim().split(/\s+/);
    if (!u) continue;
    const w = parseFloat(d || "1") * (/x$/i.test(d || "") ? 1000 : 1);
    if (w > bestW) { bestW = w; best = u; }
  }
  return best;
}

const JUNK_IMAGE = /(logo|icon|favicon|sprite|placeholder|loading|spinner|lazy|blank|pixel|1x1|spacer|avatar|gravatar|emoji|flag|arrow|payment|visa|mastercard|fpx|paypal|whatsapp|wasap|telegram|facebook|instagram|tiktok|shopee|lazada|qr|badge-|star-?rating|trustpilot)/i;

/** "…/gluvera-hero-product-300x300.webp" → "gluvera hero product". */
function fileWords(u: string): string {
  try {
    const f = decodeURIComponent(new URL(u).pathname.split("/").pop() || "");
    return f.replace(/\.[a-z0-9]+$/i, "").replace(/-\d+x\d+$/, "").replace(/[-_.]+/g, " ").replace(/\b(scaled|copy|final|edited|img|image|dsc|whatsapp image)\b/gi, " ")
      .replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

/** WordPress keeps the original next to "-300x300" thumbnails. */
function fullSize(u: string): string {
  return u.replace(/-\d{2,4}x\d{2,4}(\.(jpe?g|png|webp))(\?|$)/i, "$1$3");
}

export function extractPage(html: string, pageUrl: string): {
  title: string; description: string; siteName: string; text: string; images: ImageHit[]; links: string[];
} {
  const host = stripWww(new URL(pageUrl).hostname);
  const abs = (u: string) => {
    if (!u || /^(data|blob|javascript|mailto|tel):/i.test(u)) return "";
    try { return new URL(u, pageUrl).toString(); } catch { return ""; }
  };
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim()).slice(0, 200);
  const description = (meta(html, "og:description") || meta(html, "description")).slice(0, 400);
  const siteName = meta(html, "og:site_name").slice(0, 80);

  // Images: og/twitter image, <img> (src / lazy attrs / srcset), <source srcset>, CSS backgrounds, JSON-LD
  // — read from the markup with ordinary scripts removed (JSON-LD product data stays).
  const markup = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<script\b(?![^>]*ld\+json)[^>]*>[\s\S]*?<\/script>/gi, " ");
  const found: { url: string; alt: string; small: boolean }[] = [];
  const add = (u: string, alt = "", small = false) => { const a = abs(u); if (a) found.push({ url: a, alt, small }); };
  add(meta(html, "og:image"));
  add(meta(html, "twitter:image"));
  for (const m of markup.matchAll(/<img\b[^>]*>/gi)) {
    const t = m[0];
    const w = Number(attr(t, "width")) || 0;
    const h = Number(attr(t, "height")) || 0;
    const small = (w > 0 && w < 200) || (h > 0 && h < 200);
    const alt = attr(t, "alt") || attr(t, "title");
    const srcset = attr(t, "srcset") || attr(t, "data-srcset") || attr(t, "data-lazy-srcset");
    const src = (srcset && largestFromSrcset(srcset)) || attr(t, "data-src") || attr(t, "data-lazy-src") || attr(t, "data-original") || attr(t, "src");
    add(src, alt, small);
  }
  for (const m of markup.matchAll(/<source\b[^>]*>/gi)) add(largestFromSrcset(attr(m[0], "srcset") || attr(m[0], "data-srcset")));
  for (const m of markup.matchAll(/background(?:-image)?\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) add(decode(m[1]));
  for (const m of markup.matchAll(/"image"\s*:\s*"([^"]+)"/gi)) add(m[1].replace(/\\\//g, "/"));

  const seen = new Set<string>();
  const images: ImageHit[] = [];
  for (const f of found) {
    if (f.small) continue;
    const u = fullSize(f.url);
    let parsed: URL;
    try { parsed = new URL(u); } catch { continue; }
    if (!/^https?:$/.test(parsed.protocol)) continue;
    if (!/\.(jpe?g|png|webp)$/i.test(parsed.pathname) && !/(format|fm)=(jpe?g|png|webp)/i.test(parsed.search)) continue;
    if (JUNK_IMAGE.test(parsed.pathname) || JUNK_IMAGE.test(f.alt)) continue;
    const key = parsed.origin + parsed.pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    images.push({ url: u, title: (f.alt || fileWords(u)).slice(0, 120), domain: host, source: pageUrl });
  }

  // Internal links (for a few more pages of the same shop).
  const links: string[] = [];
  for (const m of markup.matchAll(/<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const a = abs(decode(m[2] ?? m[3] ?? ""));
    if (!a) continue;
    try {
      const u = new URL(a);
      u.hash = "";
      if (stripWww(u.hostname) !== host) continue;
      if (/\.(jpe?g|png|webp|gif|svg|pdf|zip|mp4)$/i.test(u.pathname)) continue;
      if (/(wp-admin|wp-login|login|account|cart|feed|cdn-cgi|privacy|terms|policy|refund|contact|xmlrpc)/i.test(u.pathname)) continue;
      links.push(u.toString());
    } catch { /* skip */ }
  }

  // Visible text, block by block.
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/div|\/section|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const lines = decode(body).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length >= 3);
  const text = [...new Set(lines)].join("\n").slice(0, MAX_TEXT);

  return { title, description, siteName, text, images, links: [...new Set(links)] };
}

/** More shop pages first: product / checkout / order pages, then shallow paths. */
function rankLinks(links: string[], start: string): string[] {
  const score = (u: string) => {
    const p = new URL(u).pathname.toLowerCase();
    return (/(product|produk|shop|kedai|checkout|order|beli|step|kotak|pakej|package|offer|promo)/.test(p) ? 10 : 0) - p.split("/").filter(Boolean).length;
  };
  return links.filter((u) => u !== start && u.replace(/\/$/, "") !== start.replace(/\/$/, "")).sort((a, b) => score(b) - score(a));
}

// ── read the site ────────────────────────────────────────────────────────────

async function cacheGet(key: string): Promise<SiteInfo | null> {
  try {
    const { data } = await createAdminClient().from("motion_search_cache").select("results")
      .eq("key", key).gte("created_at", new Date(Date.now() - CACHE_TTL_MS).toISOString()).maybeSingle();
    const v = Array.isArray(data?.results) ? data.results[0] : null;
    return v && typeof v === "object" ? (v as SiteInfo) : null;
  } catch {
    return null;
  }
}
async function cacheSet(key: string, url: string, info: SiteInfo): Promise<void> {
  try {
    await createAdminClient().from("motion_search_cache")
      .upsert({ key, kind: "site", query: url.slice(0, 300), provider: info.via, results: [info], created_at: new Date().toISOString() }, { onConflict: "key" });
  } catch { /* cache is best-effort */ }
}

/** A TikTok video page: its caption + account name (from the page's rehydration JSON). */
export function tiktokVideoInfo(html: string): { desc: string; author: string } | null {
  if (!html.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__")) return null;
  const str = (re: RegExp) => {
    for (const m of html.matchAll(re)) {
      try { const v = String(JSON.parse(`"${m[1]}"`)).trim(); if (v) return v; } catch { /* next */ }
    }
    return "";
  };
  const desc = str(/"desc":"((?:[^"\\]|\\.){1,2000})"/g);
  const author = str(/"nickname":"((?:[^"\\]|\\.){1,120})"/g);
  return desc || author ? { desc, author } : null;
}

/**
 * Read the seller's product site: the page itself + up to EXTRA_PAGES shop
 * pages on the same host — nothing else (no search engine). A link on an
 * excluded platform is read only when the admin allows that platform (default
 * TikTok): just that one page and its own photos, no crawl (it would bring
 * other sellers).
 */
export async function readProductSite(raw: string, prefs: Pick<SitePrefs, "exclude" | "linkAllow"> = { exclude: [], linkAllow: [] }): Promise<SiteInfo> {
  const url = normalizeSiteUrl(raw);
  const empty = (error: string, u = url ?? String(raw).slice(0, 200)): SiteInfo => ({
    ok: false, url: u, host: "", name: "", title: "", description: "", text: "", images: [], pages: 0, via: "none", error,
  });
  if (!url) return empty("invalid url");
  const host = stripWww(new URL(url).hostname);
  if (!linkAllowed(host, prefs)) return empty("excluded site");
  const platform = isExcludedHost(host, prefs.exclude);

  // Bump SITE_CACHE_VERSION when the extraction changes — older reads are then ignored.
  const key = createHash("sha256").update(`site|${SITE_CACHE_VERSION}|${url}`).digest("hex");
  const hit = await cacheGet(key);
  if (hit?.ok) return hit;

  const first = await fetchHtml(url);
  const pages = first ? [extractPage(first.html, first.url)] : [];
  const video = first && platform ? tiktokVideoInfo(first.html) : null;
  if (first && !platform) {
    const more = rankLinks(pages[0].links, first.url).slice(0, EXTRA_PAGES);
    const got = await Promise.all(more.map((u) => fetchHtml(u).catch(() => null)));
    for (const g of got) if (g) pages.push(extractPage(g.html, g.url));
  }
  const seen = new Set<string>();
  // A platform page lists other sellers' items below its own gallery, and
  // buyers' review photos — keep the listing's own gallery only.
  const images = pages.flatMap((p) => p.images).filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)))
    .filter((h) => !platform || !/\breview\b/i.test(h.title ?? ""))
    .slice(0, platform ? 12 : MAX_IMAGES);
  const p0 = pages[0];
  const title = (video?.desc || p0?.title || "").slice(0, 200);
  // On a platform og:site_name is the platform ("TikTok Shop Malaysia") — the product is in the title.
  const titleHead = (p0?.title ?? "").split(/\s[|–—-]\s/)[0];
  const name = (video?.author || (platform ? titleHead : p0?.siteName || titleHead) || host).trim().slice(0, 80);
  const text = [video?.desc ?? "", ...new Set(pages.flatMap((p) => p.text.split("\n")))].filter(Boolean).join("\n").slice(0, MAX_TEXT);
  const via: SiteInfo["via"] = images.length ? "scrape" : "none";

  const info: SiteInfo = {
    ok: images.length > 0 || text.length > (video ? 3 : 200),
    url, host, name, title, description: p0?.description ?? "", text, images, pages: pages.length, via,
    ...(pages.length ? {} : { error: "page not readable" }),
  };
  if (info.ok) await cacheSet(key, url, info);
  return info;
}

// ── helpers for the director ─────────────────────────────────────────────────

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3));

/** The site's photos best matching a B-roll query (filename / alt words), least-used first. */
export function rankSiteImages(pool: ImageHit[], query: string, used: Map<string, number>, n = 5): ImageHit[] {
  const q = words(query);
  const score = (h: ImageHit) => [...words(`${h.title ?? ""} ${h.url}`)].filter((w) => q.has(w)).length - (used.get(h.url) ?? 0) * 2;
  return pool.map((h, i) => ({ h, s: score(h), i })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, n).map((x) => x.h);
}

/** Site paragraphs as "search snippets" for a fact card (best word overlap first). */
export function siteSnippets(site: SiteInfo, query: string, n = 5): WebHit[] {
  const q = words(query);
  return site.text.split("\n")
    .filter((l) => l.length >= 30)
    .map((l, i) => ({ l, s: [...words(l)].filter((w) => q.has(w)).length, i }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, n)
    .map(({ l }) => ({ title: site.title || site.name, url: site.url, snippet: l.slice(0, 300), domain: site.host }));
}

/** Compact site brief for the director prompt. */
export function siteBrief(site: SiteInfo, maxChars = 2500): string {
  const photos = site.images.map((h) => h.title).filter((t): t is string => !!t && t.length >= 3).slice(0, 30);
  return [
    `${site.name}${site.title && site.title !== site.name ? ` — ${site.title}` : ""} (${site.host})`,
    site.description,
    site.text.slice(0, maxChars),
    photos.length ? `PHOTOS ON THE SITE (file names): ${photos.join(" · ")}` : "",
  ].filter(Boolean).join("\n");
}
