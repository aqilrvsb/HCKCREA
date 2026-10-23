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
import { excludeOperators, getSitePrefs, searchImages } from "@/lib/motion-search";
import { extractJson } from "@/lib/motion";
import { orChatVision } from "@/lib/openrouter";
import { uploadBufferToContent } from "@/lib/b2";

/** A picked picture copied to our storage: stock / web picture links expire (Pixabay's in 24 h), rate-limit or block
 *  hotlinking, while a preview is kept for days — the panel loads the same in the preview and in the render.
 *  Fail-soft: the original link. */
async function keepPhoto(url: string): Promise<string> {
  if (/^https:\/\/peninglab-content\.s3\./.test(url)) return url;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" },
      signal: AbortSignal.timeout(12_000),
    });
    const ct = (r.headers.get("content-type") || "").split(";")[0].trim();
    if (!r.ok || !/^image\/(jpeg|png|webp)$/.test(ct)) return url;
    const body = Buffer.from(await r.arrayBuffer());
    if (body.length < 4000 || body.length > 15_000_000) return url;
    const { createHash } = await import("crypto");
    const key = `motion-broll/${createHash("sha1").update(url).digest("hex")}.${ct === "image/png" ? "png" : ct === "image/webp" ? "webp" : "jpg"}`;
    return (await uploadBufferToContent({ body, key, contentType: ct })).publicUrl;
  } catch {
    return url;
  }
}

export type Cue = string | number;
/** bumped when the headline logic changes: a cached polish from before is made again */
export const HEADLINE_VERSION = 9;
// web images from these carry watermarks / licence terms: never on a headline
const WATERMARKED = /shutterstock|istockphoto|gettyimages|alamy|dreamstime|123rf|depositphotos|ftcdn|adobestock|stock\.adobe|bigstock|canstock|vecteezy|freepik|pond5|storyblocks|agefotostock|pixta|envato|dissolve\.com|wallpaper|pinimg|pinterest/i;
// social / marketplace pictures are screenshots, collages or someone else's post
const SOCIAL = /instagram|lemon8|tiktok|fbcdn|facebook|fbsbx|threads\.net|twimg|twitter|x\.com\/|shopee|susercontent|lazada|slatic|ytimg|youtube|ggpht|carousell|mudah\.my|reddit|redd\.it/i;
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
  {"kind": "split", "at": CUE, "to"?: CUE, "lead", "big", "box" (as above), "query": 2–4 plain English stock-footage keywords naming the ONE main thing the B-roll shows — a visual of what is being said ("cooking oil", "woman applying serum", "traffic jam", "blood sugar test"; no colours, no adjectives, no brand), "media": "video" | "photo"} — a B-roll panel slides into one half of the frame, the speaker moves into the other half and the headline rides the seam; ~3.5 s,
  {"kind": "pip", "at": CUE, "to"?: CUE, "lead", "big", "box", "query", "media"} — the B-roll fills the whole frame with the headline over it while the speaker shrinks into a small box bottom-right (they keep talking); ~3.5 s, for a moment that SHOWS something (a place, a result, a product in use);
  the words are the video's own message in the speaker's language — only facts and numbers the speaker says in THESE words (a number from anywhere else, even from the video's summary, is a claim the speaker doesn't make here: it is removed); every headline different, and every split / pip its own B-roll query (never the same query twice); never the hook's words.
  Spell every headline word correctly: the WORDS come from speech recognition and hold misheard tokens — never copy a token that isn't a real word ("empat kuruh" → write what the speaker meant, or use other words).
  CONTEXT FIRST: before writing any headline, understand the whole video — who is speaking, what they sell / teach / tell and why (the purpose). Every headline and every B-roll query serves THAT purpose and shows THAT subject; never build one from a single word taken alone. A word that doesn't fit the topic was probably misheard by the transcriber (in a cake seller's video "kulit" = skin is really "kulat" = mould): use the meaning that fits the topic ("Kek berkulat", query "mouldy cake"), or pick another line. The query always names the video's own subject ("mouldy cake", "chocolate cake slice", "diabetic patch on arm") — a picture of another subject ("skin acne" in a cake video) is wrong.`;

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
// spoken fillers that make no headline lead-in ("Sini Okay / KEGUNAAN")
const FILLER = new Set(["okay", "okey", "ok", "so", "haa", "ha", "hah", "eh", "erm", "um", "ya", "yes", "haah", "lah", "tau", "kan"]);
function spokenText(words: { w: string; t: number }[], t: number, source: string, n: number) {
  const near = words.filter((w) => w.t >= t - 1.5 && w.t <= t + 4)
    .map((w) => ({ w: w.w.replace(/[^\p{L}\p{N}%-]/gu, ""), end: /[.?!]["')\]]*$/.test(w.w) })).filter((x) => x.w);
  if (near.length < 4) return fallbackText(source, n);
  let bi = -1;
  near.forEach((x, i) => { if (!STOP.has(x.w.toLowerCase()) && !FILLER.has(x.w.toLowerCase()) && x.w.length >= 4 && (bi < 0 || x.w.length > near[bi].w.length)) bi = i; });
  if (bi < 0) return fallbackText(source, n);
  // the lead-in: the punch word's own sentence before it (≤ 3 words, no fillers); the payoff: what follows it
  let a = bi;
  while (a > 0 && !near[a - 1].end && bi - a < 3) a--;
  const lead = near.slice(a, bi).map((x) => x.w).filter((w) => !FILLER.has(w.toLowerCase())).join(" ") || (n === 0 ? "Ini dia" : "Sebab itu");
  const after: string[] = [];
  for (let k = bi + 1; k < near.length && after.length < 4; k++) {
    if (near[k - 1].end && after.length >= 2) break; // the payoff stays in its sentence once it says something
    if (!FILLER.has(near[k].w.toLowerCase())) after.push(near[k].w);
  }
  const box = after.join(" ") || "tonton sampai habis";
  return { lead: (lead[0].toUpperCase() + lead.slice(1)).slice(0, 34), big: near[bi].w.toUpperCase().slice(0, 16), box: box.slice(0, 34) };
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

// ── numbers on a headline are numbers the speaker says ("11 KILO" when this clip never says it is a claim) ──
const NUM = /\d+(?:[.,]\d+)*/g;
/** "1,250" / "1.250" → "1250"; "0,35" → "0.35"; "08" → "8". */
const normNum = (raw: string) => {
  const t = raw.replace(/[.,]$/, "");
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return String(Number(t.replace(/[.,]/g, "")));
  return String(Number(t.replace(",", ".")));
};
// spoken number words (Malay, English) → the digits a headline may show for them
const UNIT: Record<string, number> = {
  satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, lapan: 8, sembilan: 9, sepuluh: 10, sebelas: 11,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALE: Record<string, number> = { seratus: 100, seribu: 1000, sejuta: 1e6 };
/** Every number said in these words — as digits, or as words ("dua puluh lima" → 25, "seratus lima puluh" → 150). */
function spokenNumbers(words: { w: string }[], extra = ""): Set<string> {
  const out = new Set<string>();
  for (const m of extra.match(NUM) ?? []) out.add(normNum(m));
  let total = 0, hund = 0, small = 0, run = false;
  const flush = () => { if (run) out.add(String(total + hund + small)); total = hund = small = 0; run = false; };
  for (const w of words) {
    const raw = String(w.w).toLowerCase();
    for (const m of raw.match(NUM) ?? []) out.add(normNum(m));
    const t = raw.replace(/[^\p{L}]/gu, "");
    if (UNIT[t] !== undefined) { small += UNIT[t]; out.add(String(UNIT[t])); run = true; }
    else if (t === "belas" && run) small += 10;
    else if (t === "puluh" && run) small *= 10;
    else if (SCALE[t] !== undefined) { if (SCALE[t] === 100) hund += 100; else { total += (hund + small || 1) * SCALE[t]; hund = small = 0; } run = true; }
    else if ((t === "ratus" || t === "hundred") && run) { hund += (small || 1) * 100; small = 0; }
    else if ((t === "ribu" || t === "thousand" || t === "juta" || t === "million") && run) {
      total += (hund + small || 1) * (t === "ribu" || t === "thousand" ? 1000 : 1e6); hund = small = 0;
    } else flush();
  }
  flush();
  return out;
}
/** A headline's numbers are all said (a leading step number "1." is numbering, not a claim). */
const numbersSaid = (text: string, ok: Set<string>) => (text.replace(/^\s*\d{1,2}[.)]\s+/, "").match(NUM) ?? []).every((m) => ok.has(normNum(m)));

/** The AI's headlines, checked; the missing ones made up so every video has one "over" and one (two from 60 s)
 *  "split" — placed after the hook, the over around the first third, the splits around the middle / last third.
 *  A headline showing a number the speaker doesn't say (nor the client wrote: `extra`) is dropped and made again
 *  from the speaker's own words there. */
export function cleanHeadlines(raw: unknown, words: { w: string; t: number }[], duration: number, fallback: string, extra = ""): HeadlinePlan[] {
  const n = words.length;
  const said = spokenNumbers(words, extra);
  const got: HeadlinePlan[] = [];
  for (const h of Array.isArray(raw) ? raw.slice(0, 6) : []) {
    const kind: HeadKind | null = h?.kind === "split" || h?.kind === "pip" || h?.kind === "over" ? h.kind : null;
    const big = clean(h?.big, 18).toUpperCase();
    if (!kind || !big) continue;
    if (!numbersSaid([clean(h?.lead, 34), big, clean(h?.box, 34)].join(" "), said)) continue;
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

/** The B-roll of the split / pip layouts: stock clips for the query (Pexels → Pixabay), else photos, else clean web
 *  pictures — each set judged by a vision pick (the one that really shows the query; none when nothing does).
 *  Fail-soft: a layout with no pictures is drawn on the look's own surface. */
export async function enrichHeadlines(heads: HeadlinePlan[], context: string): Promise<HeadlinePlan[]> {
  // a headline the AI didn't write borrows another one's search (stock libraries read English keywords, not the title)
  const shared = heads.find((x) => x.kind !== "over" && x.query)?.query || "";
  const topic = context.replace(/\s+/g, " ").trim().slice(0, 400);
  // the search each layout runs; one that repeats an earlier layout's search looks further down the results, so two
  // panels never show the same picture (each still goes through the vision pick)
  const qs = heads.map((h) => (h.kind === "over" ? "" : (h.query || shared || `${context} ${h.big}`).replace(/\s+/g, " ").trim().slice(0, 80)));
  const nth = qs.map((q, i) => (q ? qs.slice(0, i).filter((x) => x.toLowerCase() === q.toLowerCase()).length : 0));
  const page = <T,>(xs: T[], hi: number, size: number) => {
    const p = xs.slice(nth[hi] * size, nth[hi] * size + size);
    return p.length ? p : xs.slice(0, size);
  };
  return Promise.all(heads.map(async (h, hi) => {
    if (h.kind === "over") return h;
    const q = qs[hi];
    if (!q) return h;
    // stock video first (moves, free licence), then free stock photos, then web images that aren't watermarked stock;
    // a split panel is 1080 × 900 (landscape-ish first), a pip fills the 9:16 frame (portrait first)
    const land = (c: { width: number; height: number }) => Number(c.width >= c.height);
    const order = <T extends { width: number; height: number }>(xs: T[]) => xs.sort((a, b) => (h.kind === "split" ? land(b) - land(a) : land(a) - land(b)));
    const ok = (u: string) => /^https:\/\//.test(u) && !WATERMARKED.test(u);
    try {
      // stock libraries rank loosely: the vision pick keeps only a clip / photo that really shows the query
      const firstFit = async (xs: { url: string; thumb?: string }[]) => {
        const top = page(xs.filter((x) => ok(x.url)), hi, 5);
        if (!top.length) return null;
        const k = await pickClean(q, h.big, top.map((x) => ({ url: x.url, thumb: x.thumb || undefined })), topic);
        return k >= 0 ? [top[k].url, ...top.filter((_, i) => i !== k).map((x) => x.url)].slice(0, 3) : null;
      };
      const clips = await firstFit(order(await searchClips(q)));
      if (clips) return { ...h, query: q, media: "video" as const, candidates: clips };
      const photos = await firstFit(order(await searchPhotos(q)));
      if (photos) return { ...h, query: q, media: "photo" as const, candidates: [await keepPhoto(photos[0]), ...photos.slice(1)] };
      const noSites = excludeOperators((await getSitePrefs()).exclude);
      const hits = page((await searchImages(`${q} ${noSites}`.trim())).hits
        .filter((x) => ok(x.url) && !SOCIAL.test(x.url) && !WATERMARKED.test(String((x as { source?: string }).source ?? "")) && !SOCIAL.test(String((x as { source?: string }).source ?? ""))), hi, 4);
      const pick = hits.length ? await pickClean(q, h.big, hits, topic) : -1;
      return pick >= 0 ? { ...h, query: q, media: "photo" as const, candidates: [await keepPhoto(hits[pick].url), ...hits.filter((_, i) => i !== pick).map((x) => x.url)].slice(0, 3) }
        : { ...h, query: q, candidates: [] };
    } catch {
      return h;
    }
  }));
}

/** Web pictures for a headline panel get the same eye as the B-roll: the cleanest literal match — no watermark, no
 *  screenshot / meme / text-heavy poster, no other brand's ad — or none (-1: the panel uses the look's surface). */
async function pickClean(query: string, big: string, hits: { url: string; thumb?: string }[], topic = ""): Promise<number> {
  const r = await orChatVision({
    modelKey: "model_motion",
    systemPrompt: "You pick a background picture (a photo, or a still of a stock video) for a TikTok split-screen headline panel. Choose the image that most literally shows the query's main thing as a clean, real shot (a scene, an object, a place, people doing it) — an image of something else (a flower for 'cooking oil') does NOT fit. REJECT any image with a visible watermark or stock-site stamp, a screenshot of an app / social post / website, a meme, a poster or graphic full of text, a collage, a price tag or another brand's ad. REJECT any image whose subject is a branded product — a box, pack, bottle, jar or label with a readable brand name or logo (it would advertise someone else's product in the seller's video); plain unbranded things (a glass of drink, a coffee cup, a patch on skin, a person) are fine. Answer ONLY JSON: {\"pick\": n} (0-based) or {\"pick\": -1} when none is clean.",
    textPrompt: `${topic ? `THE VIDEO IS ABOUT: ${topic}\nThe picture must fit THAT video's subject — reject any image of another subject even when it matches the query's words (a cake seller's video never gets a skin / face picture).\n` : ""}Query: "${query}" (headline word: "${big}"). Images #0..#${hits.length - 1} attached in order.`,
    images: hits.map((h) => h.thumb || h.url),
    temperature: 0.1,
    maxTokens: 60,
    timeoutMs: 40_000,
    hedgeAfterMs: 20_000,
  }).catch(() => null);
  if (!r?.ok || !r.content) return -1;
  try {
    const n = Number(extractJson(r.content)?.pick);
    return Number.isInteger(n) && n >= 0 && n < hits.length ? n : -1;
  } catch {
    return -1;
  }
}

/** The client's own headline words win slot by slot, and are theirs alone: an AI slot that copied them (the director
 *  is told them, and once wrote slot #4's words into slot #2 too) gets the speaker's own words there instead. */
export function applyOwnHeadlines<T extends HeadlinePlan>(heads: T[], own: { i: number; lead?: string; big?: string; box?: string; url?: string; video?: boolean }[],
  words: { w: string; t: number }[], fallback: string): T[] {
  const norm = (s?: string) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const bigs = new Set(own.map((f) => norm(f.big)).filter(Boolean));
  const leads = new Set(own.map((f) => norm(f.lead)).filter(Boolean));
  const boxes = new Set(own.map((f) => norm(f.box)).filter(Boolean));
  return heads.map((h, i) => {
    const f = own.find((x) => x.i === i);
    if (!f) {
      if (!bigs.has(norm(h.big)) && !leads.has(norm(h.lead)) && !boxes.has(norm(h.box))) return h;
      const m = typeof h.at === "string" ? W_CUE.exec(h.at) : null;
      const t = typeof h.at === "number" ? h.at : m ? words[Math.min(words.length - 1, Number(m[1]))]?.t ?? 0 : 0;
      return { ...h, ...spokenText(words, t, fallback, i) };
    }
    const out: T & { credit?: unknown } = {
      ...h,
      ...(f.lead ? { lead: f.lead } : {}), ...(f.big ? { big: f.big.toUpperCase() } : {}), ...(f.box ? { box: f.box } : {}),
      ...(f.url && h.kind !== "over" ? { media: f.video ? "video" as const : "photo" as const, candidates: [f.url] } : {}),
    };
    if (f.url && h.kind !== "over") delete out.credit; // the client's own picture carries no stock credit
    return out;
  });
}

/** Headline words written from a raw transcript, with the caption corrections in ("empat kuruh" → "empat kurus"):
 *  each corrected word, wherever it stands whole in a lead / big / box, in the same case. */
export function fixHeadlineWords<T extends { lead: string; big: string; box?: string }>(heads: T[], words: string[], fixes: [number, string][]): T[] {
  const core = (s: string) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const pairs = new Map<string, string>();
  for (const [i, w] of fixes) {
    const from = core(String(words[i] ?? "")), to = core(String(w));
    if (from.length >= 3 && to && from.toLowerCase() !== to.toLowerCase() && !/\s/.test(from)) pairs.set(from.toLowerCase(), to);
  }
  if (!pairs.size) return heads;
  const fix = (s: string | undefined) => s && s.replace(/[\p{L}\p{N}]+/gu, (m) => {
    const to = pairs.get(m.toLowerCase());
    if (!to) return m;
    return m === m.toUpperCase() && m !== m.toLowerCase() ? to.toUpperCase() : m[0] === m[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to;
  });
  return heads.map((h) => ({ ...h, lead: fix(h.lead) ?? h.lead, big: fix(h.big) ?? h.big, ...(h.box ? { box: fix(h.box) } : {}) }));
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
