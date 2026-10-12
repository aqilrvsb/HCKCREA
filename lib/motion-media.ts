// Motion tab — moving media for Edit Video:
//   • stock video clips for B-roll cutaways (Pexels → Pixabay cascade)
//   • animated stickers / reaction GIFs (GIPHY — opt-in)
// Keys live in app_settings.motion_search (admin Motion Search card):
//   video_providers:   [{ provider: "pexels" | "pixabay", key }]   ordered cascade
//   sticker_providers: [{ provider: "giphy", key }]
// Licences (checked 2026-10-12): Pexels — free for ads, no attribution
// required; Pixabay Content License — commercial use OK, no standalone
// resale. GIPHY's API terms don't cover server-side caching / commercial
// video, so stickers stay off unless the admin adds a key (their call).
// Results are cached 30 days in motion_search_cache (kind clips / stickers).
// Nothing here throws: no key / no hit → [] and the caller falls back.

import { createHash } from "node:crypto";
import { getSetting } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export type ClipHit = { url: string; thumb: string; width: number; height: number; duration: number; provider: string };
export type StickerHit = { url: string; thumb?: string; provider: string };
type Prov = { provider: string; key: string };

const TIMEOUT = 8_000;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function providers(field: "video_providers" | "sticker_providers", allowed: string[]): Promise<Prov[]> {
  try {
    const v = (await getSetting<any>("motion_search"))?.[field];
    return (Array.isArray(v) ? v : [])
      .map((p: any) => ({ provider: String(p?.provider || "").toLowerCase(), key: String(p?.key || "").trim() }))
      .filter((p: Prov) => allowed.includes(p.provider) && p.key);
  } catch {
    return [];
  }
}

export async function motionMediaConfigured(): Promise<{ clips: boolean; stickers: boolean }> {
  const [v, s] = await Promise.all([providers("video_providers", ["pexels", "pixabay"]), providers("sticker_providers", ["giphy"])]);
  return { clips: v.length > 0, stickers: s.length > 0 };
}

async function cached<T>(kind: string, q: string, run: () => Promise<{ provider: string; hits: T[] } | null>): Promise<T[]> {
  const query = q.replace(/\s+/g, " ").trim().slice(0, 120).toLowerCase();
  if (!query) return [];
  const key = createHash("sha256").update(`${kind}|${query}`).digest("hex");
  const admin = createAdminClient();
  try {
    const { data } = await admin.from("motion_search_cache").select("results")
      .eq("key", key).gte("created_at", new Date(Date.now() - TTL_MS).toISOString()).maybeSingle();
    if (Array.isArray(data?.results) && data.results.length) return data.results as T[];
  } catch { /* live search */ }
  const res = await run().catch(() => null);
  if (res && res.hits.length) {
    await admin.from("motion_search_cache")
      .upsert({ key, kind, query, provider: res.provider, results: res.hits, created_at: new Date().toISOString() }, { onConflict: "key" })
      .then(() => undefined, () => undefined);
  }
  return res?.hits ?? [];
}

// ── stock clips ──────────────────────────────────────────────────────────────
// Prefer portrait MP4 renditions close to 1080x1920 (never 4K — slow to fetch).
function bestPexelsFile(files: any[]): any | null {
  const mp4 = (files || []).filter((f) => f?.file_type === "video/mp4" && f?.link && Number(f?.height) > 0);
  if (!mp4.length) return null;
  const score = (f: any) => Math.abs(Math.max(Number(f.width), Number(f.height)) - 1920) + (Number(f.height) < Number(f.width) ? 600 : 0);
  return mp4.filter((f) => Math.max(Number(f.width), Number(f.height)) <= 2600).sort((a, b) => score(a) - score(b))[0] ?? mp4[0];
}

async function pexels(q: string, key: string): Promise<ClipHit[]> {
  const u = `https://api.pexels.com/v1/videos/search?${new URLSearchParams({ query: q, orientation: "portrait", size: "medium", per_page: "10" })}`;
  const r = await fetch(u, { headers: { Authorization: key }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`pexels HTTP ${r.status}`);
  const j: any = await r.json();
  return (Array.isArray(j?.videos) ? j.videos : [])
    .map((v: any) => {
      const f = bestPexelsFile(v?.video_files);
      return f ? { url: String(f.link), thumb: String(v?.image || ""), width: Number(f.width), height: Number(f.height), duration: Number(v?.duration) || 0, provider: "pexels" } : null;
    })
    .filter((h: ClipHit | null): h is ClipHit => !!h && h.duration >= 2 && /^https:\/\//.test(h.url));
}

async function pixabay(q: string, key: string): Promise<ClipHit[]> {
  const u = `https://pixabay.com/api/videos/?${new URLSearchParams({ key, q: q.slice(0, 100), per_page: "12", safesearch: "true" })}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`pixabay HTTP ${r.status}`);
  const j: any = await r.json();
  return (Array.isArray(j?.hits) ? j.hits : [])
    .map((h: any) => {
      const v = h?.videos?.medium?.url ? h.videos.medium : h?.videos?.large?.url ? h.videos.large : h?.videos?.small;
      if (!v?.url) return null;
      return { url: String(v.url), thumb: String(v.thumbnail || ""), width: Number(v.width) || 0, height: Number(v.height) || 0, duration: Number(h?.duration) || 0, provider: "pixabay" };
    })
    .filter((h: ClipHit | null): h is ClipHit => !!h && h.duration >= 2)
    .sort((a: ClipHit, b: ClipHit) => Number(b.height > b.width) - Number(a.height > a.width)); // portrait first
}

/** Stock video clips for a B-roll moment (empty when no provider is set). */
export async function searchClips(query: string): Promise<ClipHit[]> {
  const provs = await providers("video_providers", ["pexels", "pixabay"]);
  if (!provs.length) return [];
  return cached<ClipHit>("clips", query, async () => {
    for (const p of provs) {
      try {
        const hits = p.provider === "pexels" ? await pexels(query, p.key) : await pixabay(query, p.key);
        if (hits.length) return { provider: p.provider, hits: hits.slice(0, 8) };
      } catch (e) {
        console.warn("[motion-media] clips", p.provider, (e as Error)?.message);
      }
    }
    return null;
  });
}

// ── animated stickers ────────────────────────────────────────────────────────
async function giphy(q: string, key: string): Promise<StickerHit[]> {
  const u = `https://api.giphy.com/v1/stickers/search?${new URLSearchParams({ api_key: key, q: q.slice(0, 50), limit: "8", rating: "g", lang: "en" })}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`giphy HTTP ${r.status}`);
  const j: any = await r.json();
  return (Array.isArray(j?.data) ? j.data : [])
    .map((d: any) => {
      const o = d?.images?.original;
      const url = o?.webp || o?.url; // webp keeps the alpha channel
      return url ? { url: String(url), thumb: String(d?.images?.fixed_width_still?.url || d?.images?.fixed_width?.url || ""), provider: "giphy" } : null;
    })
    .filter((h: StickerHit | null): h is StickerHit => !!h && /^https:\/\//.test(h.url));
}

/** Animated stickers for a reaction ("mind blown", "thumbs up"); [] when off. */
export async function searchStickers(query: string): Promise<StickerHit[]> {
  const provs = await providers("sticker_providers", ["giphy"]);
  if (!provs.length) return [];
  return cached<StickerHit>("stickers", query, async () => {
    for (const p of provs) {
      try {
        const hits = await giphy(query, p.key);
        if (hits.length) return { provider: p.provider, hits };
      } catch (e) {
        console.warn("[motion-media] stickers", p.provider, (e as Error)?.message);
      }
    }
    return null;
  });
}
