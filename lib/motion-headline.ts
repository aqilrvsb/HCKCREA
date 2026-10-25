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
import { orChat, orChatVision } from "@/lib/openrouter";
import { uploadBufferToContent } from "@/lib/b2";
import { createHash } from "crypto";

/** Where a picked picture / clip is kept on our storage (one file per source link). */
const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
const KEPT = /^https:\/\/peninglab-content\.s3\.[a-z0-9-]+\.backblazeb2\.com\/motion-broll\/([0-9a-f]{40})\./;

/** A picked picture (or stock clip) copied to our storage: stock / web links expire (Pixabay's pictures in 24 h),
 *  rate-limit or block hotlinking, while a preview is kept for days — the panel loads the same in the preview and in
 *  the render. Fail-soft: the original link. */
async function keepMedia(url: string, video = false): Promise<string> {
  if (/^https:\/\/peninglab-content\.s3\./.test(url)) return url;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" },
      signal: AbortSignal.timeout(video ? 30_000 : 12_000),
    });
    const ct = (r.headers.get("content-type") || "").split(";")[0].trim();
    const ext = video ? (ct === "video/mp4" ? "mp4" : ct === "video/webm" ? "webm" : "") : ct === "image/png" ? "png" : ct === "image/webp" ? "webp" : ct === "image/jpeg" ? "jpg" : "";
    if (!r.ok || !ext) return url;
    const body = Buffer.from(await r.arrayBuffer());
    if (body.length < 4000 || body.length > (video ? 45_000_000 : 15_000_000)) return url;
    return (await uploadBufferToContent({ body, key: `motion-broll/${sha1(url)}.${ext}`, contentType: ct })).publicUrl;
  } catch {
    return url;
  }
}
const keepPhoto = (url: string) => keepMedia(url, false);

export type Cue = string | number;
/** bumped when the headline logic changes: a cached polish from before is made again */
export const HEADLINE_VERSION = 16;
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
  /** the owner's sourcing rule: "product" (the product's own story: the product, its ingredients, how it is used)
   *  → Google Images; "story" (a new scene that adds to the story) → Pixabay stock */
  about?: "product" | "story";
};

/** A picture search for a logo / icon / brand mark: the web answers with ANOTHER company's (a lime swoosh on white
 *  filled a styled clip for "Vidara Healthy Beauty logo") — B-roll and headline panels never search for one. */
export const LOGO_QUERY = /\b(logos?|icons?|brand ?marks?|wordmarks?|emblems?|lambang|ikon)\b/i;

/** What the director / polish call is asked for (the same words in every flow). */
export const HEADLINE_SPEC = `"headlines": [HEADLINE] — REQUIRED in every video, in this order through the video: one "over", one "split", then (from 20 s) one "pip", then (from 45 s) a second "split"; one at a time, each on a different strong line, spread over the whole video after the hook and before the CTA, in the speaker-on-screen gaps (never inside a scene):
  {"kind": "over", "at": CUE, "to"?: CUE, "lead": 2–5 words (sentence case, the set-up), "big": 1–3 words (≤16 characters, the punch), "box": 2–5 words (the payoff)} — the speaker stays full-frame and a three-line headline animates over them: an elegant italic lead-in, one huge word, a short line in a colour box (e.g. lead "Rahsia kulit", big "GLOWING", box "dalam 7 hari"); ~3 s,
  {"kind": "split", "at": CUE, "to"?: CUE, "lead", "big", "box" (as above), "query": 2–4 plain English stock-footage keywords naming the ONE main thing the B-roll shows — a visual of what is being said ("cooking oil", "woman applying serum", "traffic jam", "blood sugar test"; no colours, no adjectives, no brand), "media": "video" | "photo", "about": "product" | "story"} — a B-roll panel slides into one half of the frame, the speaker moves into the other half and the headline rides the seam; ~3.5 s,
  {"kind": "pip", "at": CUE, "to"?: CUE, "lead", "big", "box", "query", "media", "about"} — the B-roll fills the whole frame with the headline over it while the speaker shrinks into a small box bottom-right (they keep talking); ~3.5 s, for a moment that SHOWS something (a place, a result, a product in use);
  the words are the video's own message in the speaker's language — only facts and numbers the speaker says in THESE words (a number from anywhere else, even from the video's summary, is a claim the speaker doesn't make here: it is removed); every headline different, and every split / pip its own B-roll query (never the same query twice); never the hook's words.
  The query follows the MEANING of the Malay words, not the literal words ("masalah manis" / "kencing manis" = high blood sugar → "blood sugar" / "sugar cubes", never sweets, lipstick or something pretty; "madu" / "bermadu" when they talk about a husband, a wife or marriage = a co-wife, polygamy → "two wives arguing", "husband with second wife", never honey).
  Spell every headline word correctly: the WORDS come from speech recognition and hold misheard tokens — never copy a token that isn't a real word ("empat kuruh" → write what the speaker meant, or use other words).
  CONTEXT FIRST: before writing any headline, understand the whole video — who is speaking, what they sell / teach / tell and why (the purpose). Every headline and every B-roll query serves THAT purpose and shows THAT subject; never build one from a single word taken alone. A word that doesn't fit the topic was probably misheard by the transcriber (in a cake seller's video "kulit" = skin is really "kulat" = mould): use the meaning that fits the topic ("Kek berkulat", query "mouldy cake"), or pick another line. The query always names the video's own subject ("mouldy cake", "chocolate cake slice", "diabetic patch on arm") — a picture of another subject ("skin acne" in a cake video) is wrong.
  SOURCES (the owner's rule): "about": "product" when the panel tells the PRODUCT'S OWN STORY — the product itself, its ingredients, how it is used / applied, anything specific to it (a Google Images photo of exactly that); "about": "story" when it adds a NEW SCENE to the story — a feeling, a person, a place, a lifestyle moment (Pixabay stock, photo or video).`;

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

const STOP = new Set(["yang", "dan", "ini", "itu", "dia", "kita", "saya", "aku", "kau", "korang", "awak", "dengan", "untuk", "dalam", "pada", "tapi", "kalau", "sebab", "macam", "dah", "nak", "tak", "ada", "lah", "kan", "pun", "jadi", "the", "and", "that", "this", "with", "for", "you", "kat", "dekat", "sangat", "boleh", "memang", "betul", "okay", "okey",
  // function words that are never the punch ("Allah dia ni / SEBAGAI / rawatan")
  "sebagai", "adalah", "ialah", "kerana", "juga", "lagi", "sahaja", "saja", "semua", "setiap", "selepas", "sebelum", "apabila",
  "bila", "tentang", "daripada", "kepada", "bagaimana", "kenapa", "mana", "punya", "seperti", "macam", "nanti", "sekarang", "tengok"]);
/** Words for a headline when the AI wrote none, from what the speaker says right there: the strongest word is the
 *  punch, the words before it the lead-in, the words after it the payoff (else the hook / title). */
// spoken fillers that make no headline lead-in ("Sini Okay / KEGUNAAN")
const FILLER = new Set(["okay", "okey", "ok", "so", "haa", "ha", "hah", "eh", "erm", "um", "ya", "yes", "haah", "lah", "tau", "kan",
  // greetings / praise said to a live audience: no headline punch
  "assalamualaikum", "waalaikumsalam", "walaikumsalam", "alhamdulillah", "masyaallah", "mashaallah", "tabarakallah", "insyaallah",
  "inshaallah", "subhanallah", "insya", "allah", "terima", "kasih", "thank", "thanks", "welcome", "hello", "hai", "madam", "sis", "kak", "akak"]);
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
// a number's unit is part of the claim: "4 KILO" needs "kilo" said, not just "empat"
const UNIT_OF: [RegExp, string][] = [
  [/^(kilo|kg|kilogram|kilos)$/, "kg"], [/^(gram|g)$/, "g"], [/^(hari|day|days)$/, "day"], [/^(minggu|week|weeks)$/, "week"],
  [/^(bulan|month|months)$/, "month"], [/^(tahun|year|years)$/, "year"], [/^(jam|hour|hours)$/, "hour"], [/^(minit|minute|minutes)$/, "min"],
  [/^(peratus|percent|%)$/, "pct"], [/^(cm|inci|inch|inches)$/, "len"],
];
const unitOf = (w: string) => UNIT_OF.find(([re]) => re.test(w.toLowerCase()))?.[1];
function unitsSaid(words: { w: string }[], extra: string): Set<string> {
  const out = new Set<string>();
  for (const t of [...words.map((w) => String(w.w)), ...extra.split(/\s+/)]) {
    if (/\d\s*%|%/.test(t)) out.add("pct");
    const u = unitOf(t.replace(/[^\p{L}%]/gu, "")) ?? unitOf((t.match(/\d+([a-z]+)$/i) ?? [])[1] ?? "");
    if (u) out.add(u);
  }
  return out;
}
/** A headline's numbers are all said, and so is the unit each one comes with (a leading step number "1." is numbering,
 *  not a claim). */
function numbersSaid(text: string, ok: Set<string>, units: Set<string>): boolean {
  const t = text.replace(/^\s*\d{1,2}[.)]\s+/, "");
  if (!(t.match(NUM) ?? []).every((m) => ok.has(normNum(m)))) return false;
  for (const m of t.matchAll(/\d+(?:[.,]\d+)*\s*(%|[\p{L}]+)/gu)) {
    const u = unitOf(m[1]);
    if (u && !units.has(u)) return false;
  }
  return true;
}

/** The AI's headlines, checked; the missing ones made up so every video has one "over" and one (two from 60 s)
 *  "split" — placed after the hook, the over around the first third, the splits around the middle / last third.
 *  A headline showing a number the speaker doesn't say (nor the client wrote: `extra`) is dropped and made again
 *  from the speaker's own words there. */
export type HeadBeat = { t: number; say: string; query?: string; about?: "product" | "story" };

/** A selling beat's short line ("Rawatan sokongan sahaja") as a headline: its strongest word the punch. */
function beatText(say: string): { lead: string; big: string; box: string } | null {
  const ws = say.replace(/[^\p{L}\p{N}\s%-]/gu, " ").split(/\s+/).filter(Boolean);
  let bi = -1;
  ws.forEach((w, i) => { const l = w.toLowerCase(); if (!STOP.has(l) && !FILLER.has(l) && w.length >= 3 && (bi < 0 || w.length > ws[bi].length)) bi = i; });
  if (bi < 0) return null;
  const lead = ws.slice(0, bi).join(" ");
  return { lead: lead ? (lead[0].toUpperCase() + lead.slice(1)).slice(0, 34) : "", big: ws[bi].toUpperCase().slice(0, 16), box: ws.slice(bi + 1).join(" ").slice(0, 34) };
}

export function cleanHeadlines(raw: unknown, words: { w: string; t: number }[], duration: number, fallback: string, extra = "",
  /** the closing director's selling beats: a slot the AI left empty takes the nearest one's line + picture search */
  beats: HeadBeat[] = []): HeadlinePlan[] {
  const n = words.length;
  const said = spokenNumbers(words, extra);
  const units = unitsSaid(words, extra);
  const got: HeadlinePlan[] = [];
  for (const h of Array.isArray(raw) ? raw.slice(0, 6) : []) {
    const kind: HeadKind | null = h?.kind === "split" || h?.kind === "pip" || h?.kind === "over" ? h.kind : null;
    const big = clean(h?.big, 18).toUpperCase();
    if (!kind || !big) continue;
    const at = cueOk(h?.at, n, duration);
    if (at === undefined) continue;
    const to = cueOk(h?.to, n, duration);
    // a logo search is no picture (another company's sign comes back): the panel falls back to the headline's own words
    const query = LOGO_QUERY.test(clean(h?.query, 80)) ? "" : clean(h?.query, 80);
    // a lead-in / box line with a number (or unit) the speaker doesn't say goes, the rest stays; when the punch itself
    // carries it, the whole headline was built on that claim: its words become the speaker's own there (its B-roll stays)
    let lead = clean(h?.lead, 34), box = clean(h?.box, 34), punch = big;
    if (!numbersSaid(punch, said, units)) {
      const m = typeof at === "string" ? W_CUE.exec(at) : null;
      const sp = spokenText(words, typeof at === "number" ? at : m ? words[Number(m[1])]?.t ?? 0 : 0, fallback, got.length);
      if (!numbersSaid([sp.lead, sp.big, sp.box].join(" "), said, units)) continue;
      ({ lead, big: punch, box } = sp);
    }
    if (!numbersSaid(lead, said, units)) lead = "";
    if (!numbersSaid(box, said, units)) box = "";
    got.push({
      kind, at, ...(to !== undefined ? { to } : {}), big: punch,
      lead, ...(box ? { box } : {}),
      ...(kind !== "over" ? {
        query, media: h?.media === "photo" || h?.about === "product" ? "photo" as const : "video" as const,
        ...(h?.about === "product" || h?.about === "story" ? { about: h.about as "product" | "story" } : {}),
      } : {}),
    });
  }
  if (duration < 4 || !n) return got.slice(0, 1);
  // the set this length of video gets, and where a missing one goes (fraction of the runtime)
  const want: [HeadKind, number][] = duration < 7 ? [["over", 0.35]]
    : duration < 20 ? [["over", 0.24], ["split", 0.62]]
    : duration < 45 ? [["over", 0.18], ["split", 0.45], ["pip", 0.72]]
    : [["over", 0.14], ["split", 0.36], ["pip", 0.58], ["split", 0.8]];
  const out: HeadlinePlan[] = [];
  const usedBeats = new Set<HeadBeat>();
  const taken = (t: number) => [...got, ...out].some((h) => {
    const m = typeof h.at === "string" ? W_CUE.exec(h.at) : null;
    const ht = typeof h.at === "number" ? h.at : m ? words[Number(m[1])]?.t ?? -99 : -99;
    return Math.abs(ht - t) < 4;
  });
  for (const [kind, frac] of want) {
    const have = got.filter((h) => h.kind === kind && !out.includes(h));
    if (have.length) { out.push(have[0]); continue; }
    const t = Math.max(3, Math.min(duration - 4.5, duration * frac));
    // the nearest selling beat (its own line, its own picture search) — the speaker's words there otherwise
    const beat = beats
      .filter((b) => !usedBeats.has(b) && b.t >= 3 && b.t <= duration - 4.5 && !taken(b.t) && beatText(b.say))
      .sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
    if (beat && Math.abs(beat.t - t) <= Math.max(6, duration * 0.2)) {
      usedBeats.add(beat);
      out.push({
        kind, at: `w${wordAt(words, beat.t)}`, ...beatText(beat.say)!,
        ...(kind !== "over" ? { query: beat.query ?? "", media: beat.about === "product" ? "photo" as const : "video" as const, ...(beat.about ? { about: beat.about } : {}) } : {}),
      });
      continue;
    }
    const txt = spokenText(words, t, fallback, out.length);
    out.push({ kind, at: `w${wordAt(words, t)}`, ...txt, ...(kind !== "over" ? { query: "", media: "video" as const } : {}) });
  }
  return out;
}

/** The B-roll of the split / pip layouts: stock clips for the query (Pexels → Pixabay), else photos, else clean web
 *  pictures — each set judged by a vision pick (the one that really shows the query; none when nothing does).
 *  Fail-soft: a layout with no pictures is drawn on the look's own surface. */
export async function enrichHeadlines(heads: HeadlinePlan[], context: string,
  /** the speaker's words: each panel's picture is checked against what is said right there */
  words: { w: string; t: number }[] = []): Promise<HeadlinePlan[]> {
  const saidAt = (h: HeadlinePlan) => {
    if (!words.length) return "";
    const m = typeof h.at === "string" ? W_CUE.exec(h.at) : null;
    const t = typeof h.at === "number" ? h.at : m ? words[Number(m[1])]?.t ?? 0 : 0;
    return words.filter((w) => w.t >= t - 1.5 && w.t <= t + 3.5).slice(0, 16).map((w) => w.w).join(" ");
  };
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
    try {
      // the picture is checked against the whole headline on screen (what the moment says), not one word
      const found = await findBroll(h.kind, q, [h.lead, h.big, h.box].filter(Boolean).join(" "), topic, {
        said: saidAt(h), page: nth[hi], ...(h.about === "product" ? { source: "google" as const } : h.about === "story" ? { source: "stock" as const } : {}) });
      return found ? { ...h, query: q, ...found } : { ...h, query: q, candidates: [] };
    } catch {
      return h;
    }
  }));
}

/** The B-roll search of one split / pip panel: stock video first (moves, free licence), then free stock photos, then
 *  web pictures that aren't watermarked stock — each set judged by the vision pick (the one that really shows the
 *  query for this video, nothing branded), or null (the panel uses the look's surface). A split panel is 1080 × 900
 *  (landscape-ish first), a pip fills the 9:16 frame (portrait first). `page`: a second panel with the same search
 *  reads further down the results; `skip`: pictures already shown are left out (asking again gives the next one);
 *  `keep`: a stock clip is copied to our storage too (a client's pick must render the same days later). */
async function findBroll(kind: HeadKind, q: string, big: string, topic: string,
  o: { page?: number; skip?: Set<string>; keep?: boolean; asked?: boolean; photosOnly?: boolean; source?: "google" | "stock"; said?: string } = {}): Promise<{ media: "video" | "photo"; candidates: string[] } | null> {
  const land = (c: { width: number; height: number }) => Number(c.width >= c.height);
  const order = <T extends { width: number; height: number }>(xs: T[]) => xs.sort((a, b) => (kind === "split" ? land(b) - land(a) : land(a) - land(b)));
  const seen = (u: string) => !!o.skip?.size && (o.skip.has(u) || o.skip.has(sha1(u)));
  const ok = (u: string) => /^https:\/\//.test(u) && !WATERMARKED.test(u) && !seen(u);
  const page = <T,>(xs: T[], size: number) => {
    const n = o.page ?? 0;
    const p = xs.slice(n * size, n * size + size);
    return p.length ? p : xs.slice(0, size);
  };
  // stock libraries rank loosely: the vision pick keeps only a clip / photo that really shows the query
  const firstFit = async (xs: { url: string; thumb?: string }[]) => {
    const top = page(xs.filter((x) => ok(x.url)), 5);
    if (!top.length) return null;
    const k = await pickClean(q, big, top.map((x) => ({ url: x.url, thumb: x.thumb || undefined })), topic, o.asked, "", o.said);
    return k >= 0 ? [top[k].url, ...top.filter((_, i) => i !== k).map((x) => x.url)].slice(0, 3) : null;
  };
  // the owner's sourcing rule: the product's own story → Google Images only; a new story scene → Pixabay stock only
  if (o.source !== "google") {
    const clips = o.photosOnly ? null : await firstFit(order(await searchClips(q)));
    if (clips) return { media: "video", candidates: o.keep ? [await keepMedia(clips[0], true), ...clips.slice(1)] : clips };
    const photos = await firstFit(order(await searchPhotos(q)));
    if (photos) return { media: "photo", candidates: [await keepPhoto(photos[0]), ...photos.slice(1)] };
    if (o.source === "stock") return null;
  }
  const noSites = excludeOperators((await getSitePrefs()).exclude);
  const hits = page((await searchImages(`${q} ${noSites}`.trim())).hits
    .filter((x) => ok(x.url) && !SOCIAL.test(x.url) && !WATERMARKED.test(String((x as { source?: string }).source ?? "")) && !SOCIAL.test(String((x as { source?: string }).source ?? ""))), 4);
  const pick = hits.length ? await pickClean(q, big, hits, topic, o.asked, "", o.said) : -1;
  return pick >= 0 ? { media: "photo", candidates: [await keepPhoto(hits[pick].url), ...hits.filter((_, i) => i !== pick).map((x) => x.url)].slice(0, 3) } : null;
}

/** What the client typed for a panel ("sabun mandi", "orang minum air"), as the 2–4 plain English stock keywords the
 *  libraries read. Fail-soft: their own words. */
async function toStockQuery(text: string, topic: string): Promise<string> {
  const t = text.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!t) return "";
  const r = await orChat({
    modelKey: "model_motion_guard",
    systemPrompt: `Turn what a Malaysian seller wants shown in a video panel into 2–4 plain English stock-footage keywords naming the ONE main thing to show ("sabun mandi" → "bar soap", "orang minum air kopi" → "person drinking coffee", "tampal di perut" → "patch on belly"). No brand, no colours, no adjectives. Answer ONLY JSON: {"query": "..."}`,
    userPrompt: `${topic ? `THE VIDEO: ${topic.slice(0, 300)}\n` : ""}SHOW: ${t}\nJSON only.`,
    temperature: 0,
    maxTokens: 60,
    timeoutMs: 20_000,
  }).catch(() => null);
  try {
    const q = String(extractJson(String(r?.content ?? ""))?.query ?? "").replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
    return (q || t).slice(0, 80);
  } catch {
    return t.slice(0, 80);
  }
}

/** One clean picture of a thing the speaker names (an ingredient: "mulberry leaves", "astragalus root"), portrait
 *  first, for a full-frame shot: stock photos → web pictures, the vision pick (the speaker named it, so it IS the
 *  subject; nothing watermarked or branded), kept on our storage. Null when nothing clean shows it. */
export async function pickPhoto(query: string, label: string, topic: string): Promise<string | null> {
  // a named thing needs the real one: Google Images ("astragalus root" finds the herb; a stock library may only hold
  // a lookalike), judged with an identity check
  const ok = (u: string) => /^https:\/\//.test(u) && !WATERMARKED.test(u) && !SOCIAL.test(u);
  const noSites = excludeOperators((await getSitePrefs().catch(() => ({ exclude: [] as string[] }))).exclude);
  // an ingredient is the product's own story: Google Images only (the owner's rule)
  const web = await searchImages(`${query} ${noSites}`.trim()).then((r) => r.hits).catch(() => []);
  const pool = [
    ...web.filter((x) => ok(x.url) && !WATERMARKED.test(String((x as { source?: string }).source ?? "")) && !SOCIAL.test(String((x as { source?: string }).source ?? ""))).slice(0, 6),
  ].map((x) => ({ url: x.url, thumb: (x as { thumb?: string }).thumb || undefined }));
  if (!pool.length) return null;
  const k = await pickClean(query, label, pool, topic, true, label);
  if (k < 0) return null;
  const kept = await keepPhoto(pool[k].url);
  return /^https:\/\/peninglab-content\.s3\./.test(kept) ? kept : null;
}

/** "🔄 Cari gambar lain (AI)" — another B-roll for one split / pip panel, without an upload: the client's own words
 *  for what to show (else the panel's current search, else its headline), every picture already shown left out, the
 *  same vision pick as the automatic one; the pick is kept on our storage so the render loads it. */
export async function pickHeadlineBroll(o: { kind: "split" | "pip"; want?: string; query?: string; text?: string; topic: string; exclude?: string[] }):
  Promise<{ url: string; video: boolean; query: string } | { none: true; query: string }> {
  const topic = o.topic.replace(/\s+/g, " ").trim().slice(0, 400);
  const query = o.want?.trim() ? await toStockQuery(o.want, topic)
    : o.query?.trim() ? o.query.trim().slice(0, 80)
    : await toStockQuery(o.text || topic, topic);
  if (!query) return { none: true, query: "" };
  const skip = new Set<string>();
  for (const u of (o.exclude ?? []).slice(0, 60)) {
    skip.add(u);
    const m = KEPT.exec(u);
    if (m) skip.add(m[1]); // our copy of a stock / web picture: its source is the one to leave out
  }
  const found = await findBroll(o.kind, query, (o.text || "").split(" ")[0] || query, topic, { skip, keep: true, asked: !!o.want?.trim() });
  if (!found?.candidates[0]) return { none: true, query };
  // the render takes a pick only from our storage: copy again once if the first copy failed, else say so
  let url = found.candidates[0];
  if (!/^https:\/\/peninglab-content\.s3\./.test(url)) url = await keepMedia(url, found.media === "video");
  if (!/^https:\/\/peninglab-content\.s3\./.test(url)) throw new Error("Gambar tak dapat disimpan — cuba tekan lagi.");
  return { url, video: found.media === "video", query };
}

/** Web pictures for a headline panel get the same eye as the B-roll: the cleanest literal match — no watermark, no
 *  screenshot / meme / text-heavy poster, no other brand's ad — or none (-1: the panel uses the look's surface). */
async function pickClean(query: string, big: string, hits: { url: string; thumb?: string }[], topic = "", asked = false, exact = "", said = ""): Promise<number> {
  const r = await orChatVision({
    modelKey: "model_motion",
    systemPrompt: "You pick a background picture (a photo, or a still of a stock video) for a TikTok split-screen headline panel. Choose the image that most literally shows the query's main thing as a clean, real shot (a scene, an object, a place, people doing it) — an image of something else (a flower for 'cooking oil') does NOT fit. REJECT any image with a visible watermark or stock-site stamp, a screenshot of an app / social post / website, a meme, a poster or graphic full of text, a collage, a price tag or another brand's ad. REJECT any image whose subject is a branded product — a box, pack, bottle, jar or label with a readable brand name or logo (it would advertise someone else's product in the seller's video); plain unbranded things (a glass of drink, a coffee cup, a patch on skin, a person) are fine. Answer ONLY JSON: {\"pick\": n} (0-based) or {\"pick\": -1} when none is clean.",
    // the seller typed what to show: that IS the subject (a diet-drink seller asking for "sabun mandi" gets soap) —
    // the clean-picture rules still hold
    textPrompt: `${exact
      ? `IDENTITY CHECK — the picture must truly show "${exact}" (${query}) itself, recognisably. A different thing that merely looks alike is WRONG: ginger, turmeric or ginseng are not astragalus root; a generic green leaf is not a mulberry leaf. Pick the clearest true one; -1 when none of them truly is it.\n`
      : ""}${asked
      ? `THE SELLER ASKED FOR THIS PICTURE (their own words) — it fits their video by definition; pick the cleanest image that literally shows the query.\n${topic ? `(The video, for context only: ${topic.slice(0, 300)})\n` : ""}`
      : topic ? `THE VIDEO IS ABOUT: ${topic}\nThe picture must fit THAT video's subject — reject any image of another subject even when it matches the query's words (a cake seller's video never gets a skin / face picture).\n` : ""}${said ? `THE SPEAKER SAYS RIGHT THERE: "${said}"
` : ""}Query: "${query}" (on screen: "${big}") — the picture must show what that line and those words mean, in the video's sense — literally, never a metaphor or a mood picture. Read Malay words in their MEANING, not literally: 'masalah manis' / 'kencing manis' = high blood sugar (diabetes) — never sweets, lipstick or something pretty; 'buat dono' = acting like they don't know; 'madu' / 'bermadu' when they talk about a husband, a wife or marriage = a co-wife (polygamy), never honey. a related-but-different thing is WRONG (candy or chocolate for sugar in a drink). -1 when no image clearly shows it: a picture only loosely related is worse than none (the panel then keeps the headline's words). Images #0..#${hits.length - 1} attached in order.`,
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

// the plan fields that are shown on screen (never a search query, a URL or an id)
const SHOWN_TEXT = new Set(["text", "lead", "big", "box", "heading", "title", "sub", "caption", "label", "kicker", "say", "note"]);

/** The caption fixer's corrections (a misheard token → what was said) applied to every text the plan shows — the
 *  director writes from the raw transcript while the fixer runs beside it, so a misheard token ("MEMANGFUL") could
 *  reach a headline, a sticker or a scene line though the captions read "memang full". */
export function fixPlanText<T>(plan: T, words: string[], fixes: [number, string][]): T {
  const core = (s: string) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const pairs = new Map<string, string>();
  for (const [i, w] of fixes) {
    const from = core(String(words[i] ?? "")), to = core(String(w));
    if (from.length >= 3 && to && from.toLowerCase() !== to.toLowerCase() && !/\s/.test(from)) pairs.set(from.toLowerCase(), to);
  }
  if (!pairs.size) return plan;
  const fix = (s: string) => s.replace(/[\p{L}\p{N}]+/gu, (m) => {
    const to = pairs.get(m.toLowerCase());
    if (!to) return m;
    return m === m.toUpperCase() && m !== m.toLowerCase() ? to.toUpperCase() : m[0] === m[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to;
  });
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = typeof x === "string" ? (SHOWN_TEXT.has(k) ? fix(x) : x) : walk(x);
    }
    return out;
  };
  return walk(plan) as T;
}

/** Every on-screen text of a plan (SHOWN_TEXT fields), in walk order. */
function shownTexts(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) shownTexts(x, out); return out; }
  if (!v || typeof v !== "object") return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === "string") { if (SHOWN_TEXT.has(k)) out.push(x); } else shownTexts(x, out);
  }
  return out;
}

const SPELL_SYS = `You proofread the ON-SCREEN TEXTS of a Malaysian TikTok edit (headlines, stickers, scene lines, the hook). They were written from a speech-recognition transcript, so a word can be misheard, wrongly merged or split, or misspelled ("MEMANGFUL" → "MEMANG FULL", "begguna" → "beg guna", "percipat" → "pelipat").
The language is Malay, English or Malaysian code-switching. Fix ONLY words that are not real words of their language or are clearly misspelled. Never change a real word, a brand / product name, a number, or real slang (je, kan, tu, la, lah, ke, kot). Never rewrite, shorten or translate a text.
Return ONLY JSON: {"fixes": [{"from": "<the word exactly as written>", "to": "<the correct spelling>"}]} — {"fixes": []} when everything is spelled right.`;

/** One fast check of the spelling of everything the plan shows (a misheard / merged token from the transcript must not
 *  become a big headline word): word-for-word fixes, caps style kept. Fail-soft — the plan as it was. */
export async function fixShownSpelling<T>(plan: T, context: string, deadline: number): Promise<T> {
  const texts = [...new Set(shownTexts(plan).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => /\p{L}{3,}/u.test(s)))].slice(0, 80);
  const left = deadline - Date.now();
  if (!texts.length || left < 5000) return plan;
  const r = await orChat({
    modelKey: "model_motion_guard",
    systemPrompt: SPELL_SYS,
    userPrompt: `${context ? `VIDEO / SELLER CONTEXT (brand names are right as written there): ${context.slice(0, 300)}\n\n` : ""}TEXTS:\n${texts.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nJSON only.`,
    temperature: 0,
    maxTokens: 1200,
    timeoutMs: Math.min(20_000, left - 2000),
    stream: true,
    validate: (c) => { try { return Array.isArray(extractJson(c)?.fixes); } catch { return false; } },
  }).catch(() => null);
  if (!r?.ok || !r.content) return plan;
  let list: { from?: unknown; to?: unknown }[] = [];
  try { list = extractJson(r.content)?.fixes ?? []; } catch { return plan; }
  const core = (s: string) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const pairs = new Map<string, string>();
  for (const f of list.slice(0, 40)) {
    const from = core(String(f?.from ?? "")), to = core(String(f?.to ?? "")).replace(/\s+/g, " ");
    // one written word → its spelling (a merged word may become two); never a rewrite of a phrase
    if (from.length >= 3 && to && !/\s/.test(from) && to.split(" ").length <= 3 && from.toLowerCase() !== to.toLowerCase()) pairs.set(from.toLowerCase(), to);
  }
  if (!pairs.size) return plan;
  const fix = (s: string) => s.replace(/[\p{L}\p{N}]+/gu, (m) => {
    const to = pairs.get(m.toLowerCase());
    if (!to) return m;
    return m === m.toUpperCase() && m !== m.toLowerCase() ? to.toUpperCase() : m[0] === m[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to.toLowerCase();
  });
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = typeof x === "string" ? (SHOWN_TEXT.has(k) ? fix(x) : x) : walk(x);
    return out;
  };
  return walk(plan) as T;
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
