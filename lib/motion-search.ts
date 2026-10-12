// Motion tab — web search module. The Motion director uses it to pull
// Google Images (B-roll) and Google web snippets (fact cards) for words
// spoken in a client's video.
//
// Provider cascade (admin-tuned, like the rest of PeningLab):
//   app_settings.motion_search = {
//     providers: [ { provider: "serper" | "brave" | "tavily", key: "..." }, ... ]
//   }
// Ordered — first = main, rest = fallbacks. Empty key ⇒ skipped.
//
// Layout (so tests can run without a DB):
//   • runCascade()        — PURE: walks providers with an injectable fetch.
//   • searchImages/Web()  — thin wrappers: cache read → settings → cascade
//                           → cache write. Cache/settings failures never
//                           break a search; nothing here ever throws.
//
// Cache: public.motion_search_cache (migration 0053), service-role only.

import { createHash } from "node:crypto";
import { getSetting } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

// ────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────

export type ImageHit = {
  url: string;
  thumb?: string;
  width?: number;
  height?: number;
  title?: string;
  source?: string;
  domain?: string;
};
export type WebHit = { title: string; url: string; snippet: string; domain: string };
export type SearchOpts = { num?: number; gl?: string; hl?: string };

export type SearchProviderName = "serper" | "brave" | "tavily";
export type SearchProviderCfg = { provider: SearchProviderName; key: string };
export type SearchKind = "images" | "web";
export type CascadeResult<T> = { provider: string | null; hits: T[]; errors: string[] };
export type SearchResult<T> = CascadeResult<T> & { cached: boolean };
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const SEARCH_PROVIDERS: readonly SearchProviderName[] = ["serper", "brave", "tavily"];

const SETTINGS_KEY = "motion_search";
const CACHE_TABLE = "motion_search_cache";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PROVIDER_TIMEOUT_MS = 8_000;
// Room for Google operators (site: / -site:) after the words themselves.
const MAX_QUERY_CHARS = 300;
const MIN_IMAGE_SIDE = 400;
const MAX_NUM = 20;

// ────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ────────────────────────────────────────────────────────────────────

/** Trim + collapse whitespace + cap at 120 chars. Case preserved (sent to providers). */
export function cleanQuery(query: string): string {
  return String(query ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_CHARS)
    .trim();
}

/** Cache-key form of the query: cleaned + lowercased. */
export function normalizeQuery(query: string): string {
  return cleanQuery(query).toLowerCase();
}

type ResolvedOpts = { num: number; gl: string; hl: string };

export function resolveOpts(kind: SearchKind, opts?: SearchOpts): ResolvedOpts {
  const def = kind === "images" ? 8 : 6;
  const n = Math.floor(Number(opts?.num));
  const num = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_NUM) : def;
  const gl = String(opts?.gl || "my").trim().toLowerCase() || "my";
  const hl = String(opts?.hl || "ms").trim().toLowerCase() || "ms";
  return { num, gl, hl };
}

/** sha256 of `${kind}|${normQuery}|${gl}|${hl}|${num}` (hex). */
export function cacheKey(kind: SearchKind, query: string, opts?: SearchOpts): string {
  const o = resolveOpts(kind, opts);
  return createHash("sha256")
    .update(`${kind}|${normalizeQuery(query)}|${o.gl}|${o.hl}|${o.num}`)
    .digest("hex");
}

/**
 * Parse the app_settings.motion_search value into an ordered provider
 * list. Unknown providers and empty keys are dropped.
 */
export function parseMotionSearchSettings(raw: unknown): SearchProviderCfg[] {
  const list = (raw as any)?.providers;
  if (!Array.isArray(list)) return [];
  const out: SearchProviderCfg[] = [];
  for (const p of list) {
    const provider = String(p?.provider || "").toLowerCase() as SearchProviderName;
    const key = typeof p?.key === "string" ? p.key.trim() : "";
    if (!SEARCH_PROVIDERS.includes(provider) || !key) continue;
    out.push({ provider, key });
  }
  return out;
}

function hostOf(u: string | undefined | null): string {
  if (!u) return "";
  try {
    return stripWww(new URL(u).hostname);
  } catch {
    return "";
  }
}

function stripWww(h: string | undefined | null): string {
  return String(h || "").trim().toLowerCase().replace(/^www\./, "");
}

function isHttpUrl(u: string): boolean {
  try {
    const p = new URL(u).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

function posNum(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s : undefined;
}

/**
 * Image filter: http(s) only, no svg/gif, drop width/height < 400 when
 * known, dedupe by URL, fill `domain`, cap at `num`.
 */
export function filterImageHits(hits: ImageHit[], num: number = MAX_NUM): ImageHit[] {
  const seen = new Set<string>();
  const out: ImageHit[] = [];
  for (const h of hits) {
    const url = str(h?.url);
    if (!url || !isHttpUrl(url)) continue;
    let path = "";
    try {
      path = new URL(url).pathname.toLowerCase();
    } catch {
      continue;
    }
    if (/\.(svgz?|gif)$/.test(path)) continue;
    if (h.width !== undefined && h.width < MIN_IMAGE_SIDE) continue;
    if (h.height !== undefined && h.height < MIN_IMAGE_SIDE) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const hit: ImageHit = { url };
    const thumb = str(h.thumb);
    if (thumb && isHttpUrl(thumb)) hit.thumb = thumb;
    if (h.width !== undefined) hit.width = h.width;
    if (h.height !== undefined) hit.height = h.height;
    if (h.title) hit.title = h.title;
    if (h.source) hit.source = h.source;
    const domain = stripWww(h.domain) || hostOf(url);
    if (domain) hit.domain = domain;
    out.push(hit);
    if (out.length >= num) break;
  }
  return out;
}

/** Web filter: http(s) only, needs title or snippet, dedupe by URL, cap at `num`. */
export function filterWebHits(hits: WebHit[], num: number = MAX_NUM): WebHit[] {
  const seen = new Set<string>();
  const out: WebHit[] = [];
  for (const h of hits) {
    const url = str(h?.url);
    if (!url || !isHttpUrl(url) || seen.has(url)) continue;
    const title = str(h.title) || "";
    const snippet = str(h.snippet) || "";
    if (!title && !snippet) continue;
    seen.add(url);
    out.push({ title, url, snippet, domain: stripWww(h.domain) || hostOf(url) });
    if (out.length >= num) break;
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Provider request builders + response mappers
// ────────────────────────────────────────────────────────────────────

/** Ask providers for a round 10/20 so filtering still leaves `num` usable hits. */
function providerCount(num: number): number {
  return num <= 10 ? 10 : 20;
}

function buildRequest(
  p: SearchProviderCfg,
  kind: SearchKind,
  q: string,
  o: ResolvedOpts
): { url: string; init: RequestInit } {
  const count = providerCount(o.num);
  switch (p.provider) {
    case "serper":
      return {
        url: `https://google.serper.dev/${kind === "images" ? "images" : "search"}`,
        init: {
          method: "POST",
          headers: { "X-API-KEY": p.key, "Content-Type": "application/json" },
          body: JSON.stringify({ q, gl: o.gl, hl: o.hl, num: count }),
        },
      };
    case "brave": {
      const params = new URLSearchParams({ q, count: String(count) });
      if (kind === "images") params.set("safesearch", "strict");
      params.set("country", o.gl.toUpperCase());
      return {
        url: `https://api.search.brave.com/res/v1/${kind === "images" ? "images" : "web"}/search?${params.toString()}`,
        init: {
          method: "GET",
          headers: { "X-Subscription-Token": p.key, Accept: "application/json" },
        },
      };
    }
    case "tavily":
      return {
        url: "https://api.tavily.com/search",
        init: {
          method: "POST",
          headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            query: q,
            max_results: count,
            search_depth: "basic",
            include_images: kind === "images",
          }),
        },
      };
  }
}

function mapImages(provider: SearchProviderName, json: any): ImageHit[] {
  if (provider === "serper") {
    const arr = Array.isArray(json?.images) ? json.images : [];
    return arr.map((r: any) => ({
      url: String(r?.imageUrl || ""),
      thumb: str(r?.thumbnailUrl),
      width: posNum(r?.imageWidth),
      height: posNum(r?.imageHeight),
      title: str(r?.title),
      source: str(r?.source),
      domain: stripWww(r?.domain) || hostOf(r?.link) || undefined,
    }));
  }
  if (provider === "brave") {
    const arr = Array.isArray(json?.results) ? json.results : [];
    return arr.map((r: any) => ({
      url: String(r?.properties?.url || ""),
      thumb: str(r?.thumbnail?.src),
      width: posNum(r?.properties?.width),
      height: posNum(r?.properties?.height),
      title: str(r?.title),
      source: str(r?.source),
      domain: hostOf(r?.url) || stripWww(r?.source) || undefined,
    }));
  }
  // tavily — images[] is string[] or {url, description}[]
  const arr = Array.isArray(json?.images) ? json.images : [];
  return arr.map((r: any) =>
    typeof r === "string"
      ? { url: r }
      : { url: String(r?.url || ""), title: str(r?.description) }
  );
}

function mapWeb(provider: SearchProviderName, json: any): WebHit[] {
  const toHit = (title: unknown, url: unknown, snippet: unknown): WebHit => ({
    title: String(title || ""),
    url: String(url || ""),
    snippet: String(snippet || ""),
    domain: hostOf(String(url || "")),
  });
  if (provider === "serper") {
    const arr = Array.isArray(json?.organic) ? json.organic : [];
    return arr.map((r: any) => toHit(r?.title, r?.link, r?.snippet));
  }
  if (provider === "brave") {
    const arr = Array.isArray(json?.web?.results) ? json.web.results : [];
    return arr.map((r: any) => toHit(r?.title, r?.url, stripTags(r?.description)));
  }
  const arr = Array.isArray(json?.results) ? json.results : [];
  return arr.map((r: any) => toHit(r?.title, r?.url, r?.content));
}

// Brave wraps matched terms in <strong>…</strong> inside descriptions.
function stripTags(s: unknown): string {
  return String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function shortBody(text: string, key: string): string {
  let s = text.replace(/\s+/g, " ").trim();
  if (key) s = s.split(key).join("***"); // never echo a key back
  return s.slice(0, 120);
}

// ────────────────────────────────────────────────────────────────────
// Cascade (pure — no DB, injectable fetch)
// ────────────────────────────────────────────────────────────────────

const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

export function runCascade(
  providers: SearchProviderCfg[],
  kind: "images",
  query: string,
  opts?: SearchOpts,
  fetchImpl?: FetchLike
): Promise<CascadeResult<ImageHit>>;
export function runCascade(
  providers: SearchProviderCfg[],
  kind: "web",
  query: string,
  opts?: SearchOpts,
  fetchImpl?: FetchLike
): Promise<CascadeResult<WebHit>>;
export function runCascade(
  providers: SearchProviderCfg[],
  kind: SearchKind,
  query: string,
  opts?: SearchOpts,
  fetchImpl?: FetchLike
): Promise<CascadeResult<ImageHit | WebHit>>;
export async function runCascade(
  providers: SearchProviderCfg[],
  kind: SearchKind,
  query: string,
  opts?: SearchOpts,
  fetchImpl: FetchLike = defaultFetch
): Promise<CascadeResult<ImageHit | WebHit>> {
  const errors: string[] = [];
  const q = cleanQuery(query);
  if (!q) return { provider: null, hits: [], errors: ["empty query"] };
  const o = resolveOpts(kind, opts);

  const usable = (providers || []).filter(
    (p) => p && SEARCH_PROVIDERS.includes(p.provider) && typeof p.key === "string" && p.key.trim()
  );
  if (usable.length === 0) {
    return { provider: null, hits: [], errors: ["no search provider configured"] };
  }

  for (const p0 of usable) {
    const p: SearchProviderCfg = { provider: p0.provider, key: p0.key.trim() };
    try {
      const { url, init } = buildRequest(p, kind, q, o);
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const tail = shortBody(body, p.key);
        errors.push(`${p.provider}: HTTP ${res.status}${tail ? ` ${tail}` : ""}`);
        continue;
      }
      let json: any;
      try {
        json = await res.json();
      } catch {
        errors.push(`${p.provider}: invalid JSON`);
        continue;
      }
      const hits =
        kind === "images"
          ? filterImageHits(mapImages(p.provider, json), o.num)
          : filterWebHits(mapWeb(p.provider, json), o.num);
      if (hits.length === 0) {
        errors.push(`${p.provider}: no results`);
        continue;
      }
      return { provider: p.provider, hits, errors };
    } catch (e: any) {
      const name = String(e?.name || "");
      const reason =
        name === "TimeoutError" || name === "AbortError"
          ? `timeout (${PROVIDER_TIMEOUT_MS / 1000}s)`
          : shortBody(String(e?.message || e || "request failed"), p.key) || "request failed";
      errors.push(`${p.provider}: ${reason}`);
    }
  }
  return { provider: null, hits: [], errors };
}

// ────────────────────────────────────────────────────────────────────
// Thin wrappers — settings + cache (injectable for tests)
// ────────────────────────────────────────────────────────────────────

type CacheRow = { provider: string; results: unknown };
type CacheWrite = {
  key: string;
  kind: SearchKind;
  query: string;
  provider: string;
  results: ImageHit[] | WebHit[];
};
type Deps = {
  loadProviders: () => Promise<SearchProviderCfg[]>;
  cacheGet: (key: string) => Promise<CacheRow | null>;
  cacheSet: (row: CacheWrite) => Promise<void>;
  fetchImpl: FetchLike;
};

const defaultDeps: Deps = {
  async loadProviders() {
    return parseMotionSearchSettings(await getSetting(SETTINGS_KEY));
  },
  async cacheGet(key) {
    const admin = createAdminClient();
    const since = new Date(Date.now() - CACHE_TTL_MS).toISOString();
    const { data, error } = await admin
      .from(CACHE_TABLE)
      .select("provider, results")
      .eq("key", key)
      .gte("created_at", since)
      .maybeSingle();
    if (error || !data) return null;
    return data as CacheRow;
  },
  async cacheSet(row) {
    const admin = createAdminClient();
    // created_at set explicitly so a refreshed row restarts its 30-day TTL.
    await admin
      .from(CACHE_TABLE)
      .upsert({ ...row, created_at: new Date().toISOString() }, { onConflict: "key" });
  },
  fetchImpl: defaultFetch,
};

let deps: Deps = defaultDeps;

/** Test hook — override settings/cache/fetch; pass null to restore defaults. */
export function __setMotionSearchDeps(over: Partial<Deps> | null): void {
  deps = over ? { ...defaultDeps, ...over } : defaultDeps;
}

/** Ordered providers with a key (main first). Never throws. */
export async function getMotionSearchProviders(): Promise<SearchProviderCfg[]> {
  try {
    return await deps.loadProviders();
  } catch {
    return [];
  }
}

async function search(
  kind: SearchKind,
  query: string,
  opts?: SearchOpts
): Promise<SearchResult<ImageHit | WebHit>> {
  try {
    const q = cleanQuery(query);
    if (!q) return { provider: null, hits: [], cached: false, errors: ["empty query"] };
    const o = resolveOpts(kind, opts);
    const key = cacheKey(kind, q, o);

    try {
      const row = await deps.cacheGet(key);
      if (row && Array.isArray(row.results) && row.results.length > 0) {
        return {
          provider: String(row.provider || "") || null,
          hits: (row.results as (ImageHit | WebHit)[]).slice(0, o.num),
          cached: true,
          errors: [],
        };
      }
    } catch {
      /* cache read failure — fall through to a live search */
    }

    const providers = await getMotionSearchProviders();
    const res = await runCascade(providers, kind, q, o, deps.fetchImpl);

    if (res.provider && res.hits.length > 0) {
      try {
        await deps.cacheSet({
          key,
          kind,
          query: normalizeQuery(q),
          provider: res.provider,
          results: res.hits as ImageHit[] | WebHit[],
        });
      } catch {
        /* cache write failure never breaks search */
      }
    }
    return { ...res, cached: false };
  } catch (e: any) {
    return {
      provider: null,
      hits: [],
      cached: false,
      errors: [`search failed: ${String(e?.message || e).slice(0, 120)}`],
    };
  }
}

export async function searchImages(
  query: string,
  opts?: SearchOpts
): Promise<{ provider: string | null; hits: ImageHit[]; cached: boolean; errors: string[] }> {
  return (await search("images", query, opts)) as SearchResult<ImageHit>;
}

export async function searchWeb(
  query: string,
  opts?: SearchOpts
): Promise<{ provider: string | null; hits: WebHit[]; cached: boolean; errors: string[] }> {
  return (await search("web", query, opts)) as SearchResult<WebHit>;
}

/** True if any provider in app_settings.motion_search has a key. */
export async function motionSearchConfigured(): Promise<boolean> {
  return (await getMotionSearchProviders()).length > 0;
}

// ────────────────────────────────────────────────────────────────────
// Site preferences — product B-roll comes from the product's own sales /
// brand website first (that's where the real box, packshots and usage photos
// live), then a general Google search. Marketplaces and social networks are
// excluded everywhere: listing collages, watermarks, expiring CDN links.
// Admin-editable (Motion Search card):
//   app_settings.motion_search.exclude_sites    string[] (keywords / domains)
//   app_settings.motion_search.brand_site_first boolean (default true)
// ────────────────────────────────────────────────────────────────────

export const DEFAULT_EXCLUDE_SITES = ["shopee", "facebook", "tiktok", "lazada", "mudah.my", "youtube"];
export type SitePrefs = { exclude: string[]; brandFirst: boolean };

// The image CDNs of the excluded sites (a Shopee photo is served from susercontent.com …).
const SITE_ALIASES: Record<string, string[]> = {
  shopee: ["susercontent"],
  facebook: ["fbcdn", "fbsbx", "fb.com", "fb.watch"],
  tiktok: ["tiktokcdn", "ttwstatic", "byteimg", "ibytedtos"],
  lazada: ["slatic", "lzd-img", "lazcdn"],
  youtube: ["ytimg", "youtu.be", "ggpht"],
};
// Google -site: operators for keyword entries without a TLD.
const SITE_DOMAINS: Record<string, string[]> = {
  shopee: ["shopee.com.my", "shopee.com"],
  facebook: ["facebook.com"],
  tiktok: ["tiktok.com"],
  lazada: ["lazada.com.my", "lazada.com"],
  youtube: ["youtube.com"],
};

export function parseSitePrefs(raw: unknown): SitePrefs {
  const r = raw as any;
  const list = Array.isArray(r?.exclude_sites)
    ? r.exclude_sites.map((s: unknown) => String(s ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
        .filter((s: string) => /^[a-z0-9.-]{2,60}$/.test(s))
    : DEFAULT_EXCLUDE_SITES;
  return { exclude: [...new Set<string>(list)].slice(0, 30), brandFirst: r?.brand_site_first !== false };
}

export async function getSitePrefs(): Promise<SitePrefs> {
  try {
    return parseSitePrefs(await getSetting(SETTINGS_KEY));
  } catch {
    return parseSitePrefs(null);
  }
}

/** True when a host / domain belongs to an excluded site (or its image CDN). */
export function isExcludedHost(host: string | undefined | null, exclude: string[]): boolean {
  const h = stripWww(host);
  if (!h) return false;
  return exclude.some((kw) => {
    const needles = [kw, ...(SITE_ALIASES[kw] ?? [])];
    // "mudah.my" → that domain and its subdomains; "shopee" → any host containing it
    return needles.some((n) => (n.includes(".") ? h === n || h.endsWith(`.${n}`) : h.includes(n)));
  });
}

/** "-site:shopee.com.my -site:facebook.com …" for a Google query. */
export function excludeOperators(exclude: string[]): string {
  const doms = exclude.flatMap((kw) => SITE_DOMAINS[kw] ?? (kw.includes(".") ? [kw] : [`${kw}.com`]));
  return [...new Set(doms)].map((d) => `-site:${d}`).join(" ");
}

/** Keep only hits whose page domain and image host aren't excluded. */
export function dropExcluded(hits: ImageHit[], exclude: string[]): ImageHit[] {
  return hits.filter((h) => !isExcludedHost(h.domain, exclude) && !isExcludedHost(hostOf(h.url), exclude));
}

// Not the product's own sales page (social / marketplace / reference / parked-domain noise).
const NOT_SALES_SITE = /(^|\.)(instagram|threads|x|twitter|pinterest|reddit|quora|wikipedia|linkedin|unscramble|atom|ebay|amazon|aliexpress|alibaba|carousell|temu|zalora|webmd)\./;

/** The product-type word of a product name ("Gluvera Diabetic Patch" → "patch"). */
export function productTypeWord(product: string, brandToken: string): string {
  const words = String(product || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && w !== brandToken && !/^\d+$/.test(w));
  return words[words.length - 1] || "";
}
const PARKED_PAGE = /(for sale|is registered at|premium domain|buy this domain|unscrambl)/;

/**
 * The product's own sales / brand websites. Google web search (full product
 * name + brand alone, excluded sites removed); a result counts only when the
 * brand is in its domain / title / URL AND it is about this product (the
 * product-type words, e.g. "patch", appear) — or the domain itself carries the
 * brand. Brand-named domains rank first. [] when nothing qualifies → the
 * caller goes straight to the general search.
 */
export async function findBrandSites(brand: string, prefs: SitePrefs, product?: string, max = 3): Promise<string[]> {
  const b = cleanQuery(brand).slice(0, 60);
  const token = b.toLowerCase().split(/\s+/)[0]?.replace(/[^a-z0-9]/g, "") ?? "";
  if (token.length < 3) return [];
  // "Gluvera Diabetic Patch, RM39, beg kuning" → the product name is the part before the first comma
  const full = cleanQuery(String(product || "").split(/[,|]/)[0]).slice(0, 80);
  const ops = excludeOperators(prefs.exclude);
  const queries = [...new Set([full.toLowerCase().includes(token) ? full : "", b].filter(Boolean))];
  const kind = productTypeWord(full || b, token);
  const [results, imgs] = await Promise.all([
    Promise.all(queries.map((q) => searchWeb(`${q} ${ops}`, { num: 10 }).catch(() => null))),
    // Image results surface brand sites the web results miss.
    searchImages(`${token} ${kind} ${ops}`, { num: 10 }).catch(() => null),
  ]);
  const typeWords = `${full} ${b}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && w !== token);
  const score = new Map<string, number>();
  for (const h of imgs?.hits ?? []) {
    const d = stripWww(h.domain);
    if (d && !isExcludedHost(d, prefs.exclude) && !NOT_SALES_SITE.test(d) && d.replace(/[^a-z0-9]/g, "").includes(token)) {
      score.set(d, Math.max(score.get(d) ?? 0, 6)); // brand-named domain that really hosts product photos
    }
  }
  for (const r of results) {
    for (const h of r?.hits ?? []) {
      const d = stripWww(h.domain);
      if (!d || isExcludedHost(d, prefs.exclude) || NOT_SALES_SITE.test(d)) continue;
      const text = `${h.title} ${h.snippet} ${h.url}`.toLowerCase();
      if (PARKED_PAGE.test(text)) continue;
      const inDomain = d.replace(/[^a-z0-9]/g, "").includes(token);
      const inText = text.includes(token);
      const typed = typeWords.some((w) => text.includes(w));
      if (!((inDomain && (inText || typed)) || (inText && typed))) continue;
      const s = (inDomain ? 3 : 0) + (inText ? 2 : 0) + (typed ? 2 : 0);
      score.set(d, Math.max(score.get(d) ?? 0, s));
    }
  }
  return [...score.entries()].sort((x, y) => y[1] - x[1]).map(([d]) => d).slice(0, max);
}

/**
 * Product photo pool from the brand's own sites — one image search per site
 * (Google drops `site:a OR site:b` image queries), deduped, excluded hosts out.
 */
export async function brandImagePool(sites: string[], brand: string, product: string, exclude: string[]): Promise<ImageHit[]> {
  const token = cleanQuery(brand).toLowerCase().split(/\s+/)[0]?.replace(/[^a-z0-9]/g, "") ?? "";
  const kind = productTypeWord(String(product || "").split(/[,|]/)[0] || brand, token);
  const res = await Promise.all(sites.map((d) => searchImages(`${token} ${kind} site:${d}`.replace(/\s+/g, " "), { num: 10 }).catch(() => null)));
  const seen = new Set<string>();
  const out: ImageHit[] = [];
  for (const r of res) {
    for (const h of dropExcluded(r?.hits ?? [], exclude)) {
      if (seen.has(h.url)) continue;
      seen.add(h.url);
      out.push(h);
    }
  }
  return out;
}
