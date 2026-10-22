// Laju v2 headlines — REQUIRED in every video with a person on camera (the owner's call, 2026-10-22): Motion
// Default and Custom with an uploaded video, and every CLIPPER clip. The video runs on the full-frame speaker, then:
//   "over"  — a three-line headline animates over the speaker: an italic serif lead-in, one huge condensed line,
//             a short line in a colour box (the creator / HeyGen look);
//   "split" — a B-roll panel takes one half (top or bottom), the speaker moves into the other half and the headline
//             rides the seam;
//   "pip"   — the B-roll fills the frame while the speaker shrinks and docks into a small box bottom-right.
// The director (or the CLIPPER polish call) writes the words and the B-roll searches; cleanHeadlines() guarantees
// the set for the video's length (over + split; + pip from 20 s; + a second split from 45 s) even when it wrote
// none; the renderer (motion-hf/overrides/headline.tsx) picks a layout / entrance variant per video.
import { searchClips, searchPhotos } from "@/lib/motion-media";
import { searchImages } from "@/lib/motion-search";

export type Cue = string | number;
/** bumped when the headline logic changes: a cached polish from before is made again */
export const HEADLINE_VERSION = 2;
// web images from these carry watermarks / licence terms: never on a headline
const WATERMARKED = /shutterstock|istockphoto|gettyimages|alamy|dreamstime|123rf|depositphotos|ftcdn|adobestock|stock\.adobe|bigstock|canstock|vecteezy|freepik|pond5|storyblocks|agefotostock|pixta|envato|dissolve\.com|wallpaper|pinimg|pinterest/i;
export type HeadKind = "over" | "split" | "pip";
export type HeadlinePlan = {
  kind: HeadKind;
  at: Cue;
  to?: Cue;
  /** the italic lead-in (2–5 words, sentence case) */
  lead: string;
  /** the huge line (1–3 words, ≤ 16 characters) */
  big: string;
  /** the small boxed line (2–5 words) */
  box?: string;
  /** split / pip: what the B-roll shows — a plain-English stock search ("woman drinking coffee at sunrise") */
  query?: string;
  media?: "video" | "photo";
  /** split / pip: picture / clip URLs found for the query (Modal downloads the first that works) */
  candidates?: string[];
};

/** What the director / polish call is asked for (the same words in every flow). */
export const HEADLINE_SPEC = `"headlines": [HEADLINE] — REQUIRED in every video, in this order through the video: one "over", one "split", then (from 20 s) one "pip", then (from 45 s) a second "split"; one at a time, each on a different strong line, spread over the whole video after the hook and before the CTA, in the speaker-on-screen gaps (never inside a scene):
  {"kind": "over", "at": CUE, "to"?: CUE, "lead": 2–5 words (sentence case, the set-up), "big": 1–3 words (≤16 characters, the punch), "box": 2–5 words (the payoff)} — the speaker stays full-frame and a three-line headline animates over them: an elegant italic lead-in, one huge word, a short line in a colour box (e.g. lead "Rahsia kulit", big "GLOWING", box "dalam 7 hari"); ~3 s,
  {"kind": "split", "at": CUE, "to"?: CUE, "lead", "big", "box" (as above), "query": a plain-English stock-video search for what the B-roll half shows — a visual of what is being said ("woman applying serum mirror", "city traffic jam aerial"), "media": "video" | "photo"} — a B-roll panel slides into one half of the frame, the speaker moves into the other half and the headline rides the seam; ~3.5 s,
  {"kind": "pip", "at": CUE, "to"?: CUE, "lead", "big", "box", "query", "media"} — the B-roll fills the whole frame with the headline over it while the speaker shrinks into a small box bottom-right (they keep talking); ~3.5 s, for a moment that SHOWS something (a place, a result, a product in use);
  the words are the video's own message in the speaker's language (only facts and numbers the speaker says); every headline different; never the hook's words.`;

const W_CUE = /^w(\d{1,4})(\$)?([+-]\d{0,2}(?:\.\d+)?)?$/i;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").replace(/[<>{}]/g, "").trim().slice(0, max);

/** A cue the renderer can resolve, inside the video (else undefined). */
function cueOk(c: unknown, nWords: number, duration: number): Cue | undefined {
  if (typeof c === "number") return c >= 0 && c < duration ? Math.round(c * 100) / 100 : undefined;
  const m = W_CUE.exec(String(c ?? "").trim());
  return m && Number(m[1]) < nWords ? String(c).trim() : undefined;
}

/** The word index nearest a time (the start of a word). */
function wordAt(words: { t: number }[], sec: number) {
  let best = 0;
  for (let i = 0; i < words.length; i++) if (Math.abs(words[i].t - sec) < Math.abs(words[best].t - sec)) best = i;
  return best;
}

const STOP = new Set(["yang", "dan", "ini", "itu", "dia", "kita", "saya", "aku", "kau", "korang", "awak", "dengan", "untuk", "dalam", "pada", "tapi", "kalau", "sebab", "macam", "dah", "nak", "tak", "ada", "lah", "kan", "pun", "jadi", "the", "and", "that", "this", "with", "for", "you", "kat", "dekat", "sangat", "boleh", "memang", "betul", "okay", "okey"]);
/** Words for a headline when the AI wrote none, from what the speaker says right there: the strongest word is the
 *  punch, the words before it the lead-in, the words after it the payoff (else the hook / title). */
function spokenText(words: { w: string; t: number }[], t: number, source: string, n: number) {
  const near = words.filter((w) => w.t >= t - 1.5 && w.t <= t + 4).map((w) => w.w.replace(/[^\p{L}\p{N}%-]/gu, "")).filter(Boolean);
  if (near.length < 4) return fallbackText(source, n);
  let bi = -1;
  near.forEach((w, i) => { if (!STOP.has(w.toLowerCase()) && w.length >= 4 && (bi < 0 || w.length > near[bi].length)) bi = i; });
  if (bi < 0) return fallbackText(source, n);
  const lead = near.slice(Math.max(0, bi - 3), bi).join(" ") || (n === 0 ? "Ini dia" : "Sebab itu");
  const box = near.slice(bi + 1, bi + 5).join(" ") || "tonton sampai habis";
  return { lead: (lead[0].toUpperCase() + lead.slice(1)).slice(0, 34), big: near[bi].toUpperCase().slice(0, 16), box: box.slice(0, 34) };
}

/** Words for a headline when nothing was said near it: the hook / title cut into lead-in, punch and payoff. */
function fallbackText(source: string, n: number): { lead: string; big: string; box: string } {
  const ws = source.replace(/[^\p{L}\p{N}\s%-]/gu, " ").split(/\s+/).filter(Boolean);
  if (!ws.length) return n === 0 ? { lead: "Tonton", big: "SAMPAI", box: "habis" } : { lead: "Ini dia", big: "RAHSIA", box: "yang ramai tak tahu" };
  // the punch: the longest word or two (≤ 16 chars); the lead-in: what comes before; the payoff: what comes after
  let bi = 0;
  ws.forEach((w, i) => { if (w.length > ws[bi].length) bi = i; });
  const big = (ws[bi + 1] && (ws[bi] + " " + ws[bi + 1]).length <= 14 ? `${ws[bi]} ${ws[bi + 1]}` : ws[bi]).slice(0, 16);
  const lead = ws.slice(Math.max(0, bi - 4), bi).join(" ") || (n === 0 ? "Ini dia" : "Sebab itu");
  const box = ws.slice(bi + big.split(" ").length, bi + big.split(" ").length + 4).join(" ") || (n === 0 ? "tonton sampai habis" : "jangan skip");
  return { lead: lead[0].toUpperCase() + lead.slice(1), big: big.toUpperCase(), box };
}

/** The AI's headlines, checked; the missing ones made up so every video has one "over" and one (two from 60 s)
 *  "split" — placed after the hook, the over around the first third, the splits around the middle / last third. */
export function cleanHeadlines(raw: unknown, words: { w: string; t: number }[], duration: number, fallback: string): HeadlinePlan[] {
  const n = words.length;
  const got: HeadlinePlan[] = [];
  for (const h of Array.isArray(raw) ? raw.slice(0, 6) : []) {
    const kind: HeadKind | null = h?.kind === "split" || h?.kind === "pip" || h?.kind === "over" ? h.kind : null;
    const big = clean(h?.big, 18).toUpperCase();
    if (!kind || !big) continue;
    const at = cueOk(h?.at, n, duration);
    if (at === undefined) continue;
    const to = cueOk(h?.to, n, duration);
    const query = clean(h?.query, 80);
    got.push({
      kind, at, ...(to !== undefined ? { to } : {}), big,
      lead: clean(h?.lead, 34), ...(clean(h?.box, 34) ? { box: clean(h?.box, 34) } : {}),
      ...(kind !== "over" ? { query, media: h?.media === "photo" ? "photo" as const : "video" as const } : {}),
    });
  }
  if (duration < 4 || !n) return got.slice(0, 1);
  // the set this length of video gets, and where a missing one goes (fraction of the runtime)
  const want: [HeadKind, number][] = duration < 7 ? [["over", 0.35]]
    : duration < 20 ? [["over", 0.24], ["split", 0.62]]
    : duration < 45 ? [["over", 0.18], ["split", 0.45], ["pip", 0.72]]
    : [["over", 0.14], ["split", 0.36], ["pip", 0.58], ["split", 0.8]];
  const out: HeadlinePlan[] = [];
  for (const [kind, frac] of want) {
    const have = got.filter((h) => h.kind === kind && !out.includes(h));
    if (have.length) { out.push(have[0]); continue; }
    const t = Math.max(3, Math.min(duration - 4.5, duration * frac));
    const txt = spokenText(words, t, fallback, out.length);
    out.push({ kind, at: `w${wordAt(words, t)}`, ...txt, ...(kind !== "over" ? { query: "", media: "video" as const } : {}) });
  }
  return out;
}

/** The B-roll of the split / pip layouts: stock clips for the query (Pexels → Pixabay), else photos. Fail-soft:
 *  a layout with no pictures is drawn on the look's own surface. */
export async function enrichHeadlines(heads: HeadlinePlan[], context: string): Promise<HeadlinePlan[]> {
  return Promise.all(heads.map(async (h) => {
    if (h.kind === "over") return h;
    const q = (h.query || `${context} ${h.big}`).replace(/\s+/g, " ").trim().slice(0, 80);
    if (!q) return h;
    // stock video first (moves, free licence), then free stock photos, then web images that aren't watermarked stock;
    // a split panel is 1080 × 900 (landscape-ish first), a pip fills the 9:16 frame (portrait first)
    const land = (c: { width: number; height: number }) => Number(c.width >= c.height);
    const order = <T extends { width: number; height: number }>(xs: T[]) => xs.sort((a, b) => (h.kind === "split" ? land(b) - land(a) : land(a) - land(b)));
    const ok = (u: string) => /^https:\/\//.test(u) && !WATERMARKED.test(u);
    try {
      const clips = order(await searchClips(q)).map((c) => c.url).filter(ok);
      if (clips.length) return { ...h, query: q, media: "video" as const, candidates: clips.slice(0, 4) };
      const photos = order(await searchPhotos(q)).map((c) => c.url).filter(ok);
      if (photos.length) return { ...h, query: q, media: "photo" as const, candidates: photos.slice(0, 5) };
      const imgs = (await searchImages(q)).hits.filter((x) => ok(x.url) && !WATERMARKED.test(String((x as { source?: string }).source ?? ""))).map((x) => x.url);
      return imgs.length ? { ...h, query: q, media: "photo" as const, candidates: imgs.slice(0, 5) } : { ...h, query: q, candidates: [] };
    } catch {
      return h;
    }
  }));
}

/** Headlines made on one word list, moved onto another (the CLIPPER render re-transcribes the clip). */
export function remapHeadlines(heads: HeadlinePlan[], map: (i: number) => number): HeadlinePlan[] {
  const mv = (c: Cue | undefined): Cue | undefined => {
    if (c === undefined || typeof c === "number") return c;
    const m = W_CUE.exec(c);
    if (!m) return undefined;
    const r = map(Number(m[1]));
    return r >= 0 ? `w${r}${m[2] ?? ""}${m[3] ?? ""}` : undefined;
  };
  return heads.map((h) => {
    const at = mv(h.at);
    return at === undefined ? null : { ...h, at, ...(h.to !== undefined ? { to: mv(h.to) } : {}) };
  }).filter((h): h is HeadlinePlan => !!h && h.at !== undefined);
}
