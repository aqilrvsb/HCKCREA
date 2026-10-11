// Motion v2 "director" for Edit Video — turns a client's transcript into a
// full edit plan, then grounds it in the real world:
//   1. LLM director (model_motion cascade) → hook, overlays, zooms, keyword
//      captions, re-hook, CTA, B-roll moments (search queries), fact moments.
//   2. Serper/Google image search per B-roll moment + one vision call that
//      picks the best-matching image per moment (cascade: vision → first hit).
//   3. Serper/Google web search per fact moment + one LLM call that writes
//      ≤12-word fact cards strictly from the snippets (source domain shown,
//      no medical / price / efficacy claims, null when unsupported).
//   4. qaPatch(): vision review of rendered stills → small JSON patch.
// Every step is fail-soft: a failure drops that enrichment, never the job.

import { orChat, orChatVision } from "@/lib/openrouter";
import { searchImages, searchWeb, type ImageHit, type WebHit } from "@/lib/motion-search";
import { MOTION_MY_TIKTOK_GUIDE } from "@/lib/motion-prompts";
import { extractJson, cleanItemPublic, type EditInput, type MotionItem } from "@/lib/motion";

type Cue = string | number;
export type DirectorWord = { i: number; w: string; t: number; e?: number };

export type BRollPlan = { at: Cue; to?: Cue; layout: "full" | "pip"; label?: string; query: string; candidates: string[] };
export type FactPlan = { at: Cue; to?: Cue; text: string; source: string };
export type EditPlanV2 = {
  hook: { text: string; sub?: string } | null;
  accent: string;
  mood: "chill" | "upbeat" | "hype";
  captions: { on: boolean; style: "pop" | "karaoke" | "box"; pos: "low" | "mid"; maxWords: number };
  overlays: MotionItem[];
  zooms: { at: Cue; to?: Cue; scale?: number }[];
  broll: BRollPlan[];
  facts: FactPlan[];
  keywords: { i: number; color: "benefit" | "price" | "pain" | "brand" | "accent"; emoji?: string }[];
  rehook?: { at: Cue; text: string };
  cta?: { at: Cue; text: string; sub?: string };
};

const HEX = /^#[0-9a-f]{6}$/i;
const EDIT_CUE = /^w\d{1,4}(?:\$)?(?:[+-]\d{0,2}(?:\.\d+)?)?$/i;
const KEY_COLORS = new Set(["benefit", "price", "pain", "brand", "accent"]);
const MOODS = new Set(["chill", "upbeat", "hype"]);
const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
// Google Noto emoji that have an animated (Lottie) version — the director
// should prefer these so stickers and caption emoji move.
const ANIMATED_EMOJI = "🔥 😱 🤯 😍 🥰 😂 🤣 😭 😋 🤩 😎 🤔 👀 👍 👏 🙏 💪 🎉 💯 ✅ ❤️ ✨ ⭐ 🚀 ⚡ 💥 🥳 🎁 ⏰ 🛒 😮 🤑 👇 👉 💡";

export const DIRECTOR_SYSTEM = (style: "gempak" | "clean") => `You are PeningLab's TikTok video DIRECTOR. A Malaysian seller/creator uploaded their own talking video. You get its timed transcript and plan a professional short-form edit on top of it: hook, word-synced motion graphics, web B-roll cutaways, fact cards, punch-in zooms, keyword-coloured captions, a re-hook and the beg-kuning CTA. Captions are rendered automatically — you only choose which words get a colour/emoji.

${MOTION_MY_TIKTOK_GUIDE}

STYLE = ${style.toUpperCase()} — ${style === "gempak"
  ? "dense and punchy: something new on screen every 2–4 s (overlay, B-roll, zoom or bigword); 1 zoom every 3–5 s; 3–6 bigword punches on the strongest words; emoji often; at least one callout or arrow."
  : "calm and premium: a change every 4–6 s; 1 zoom every 6–8 s; at most 2 bigwords; few emoji."}

Return ONLY one JSON object:
{
  "hook": {"text": string (≤5 words), "sub"?: string (≤5 words)} | null,
  "accent": "#RRGGBB",
  "mood": "chill" | "upbeat" | "hype",
  "overlays": [ITEM],
  "zooms": [{"at": CUE, "to": CUE, "scale": 1.08–1.25}],
  "broll": [{"at": CUE, "to": CUE, "layout": "full" | "pip", "query": string, "label"?: string (≤4 words)}],
  "facts": [{"at": CUE, "to": CUE, "query": string, "topic": string}],
  "keywords": [{"i": word index, "color": "benefit" | "price" | "pain" | "brand", "emoji"?: one emoji}],
  "rehook"?: {"at": CUE, "text": string (≤4 words)},
  "cta"?: {"at": CUE, "text": string (≤4 words, e.g. "Tekan beg kuning"), "sub"?: string (≤5 words)}
}
ITEM = {"t": TYPE, "text": string, "sub"?: string, "at": CUE, "to"?: CUE, "zone": "top" | "middle" | "bottom", "tone"?: "yellow"|"white"|"red"|"green"|"accent"|"dark", "mark"?: "check"|"cross"}
TYPE (on-screen text is SHORT, never a transcript):
  headline ≤4 words (top) · tag ≤3 words · stamp 1–2 words · chip ≤4 words (bottom) · tape ≤4 words (top) · scribble ≤6 words
  note ≤6 words (sub = struck-through word, mark check/cross) · check ≤4 words (bottom; mark "cross" for the old way)
  price = a price SPOKEN in the video (sub = old price if spoken) · counter = a number SPOKEN (sub = label)
  emoji = ONE emoji (prefer these animated ones: ${ANIMATED_EMOJI})
  bigword = the 1–2 strongest words, huge, ~1 s (zone middle) · callout = speech bubble ≤6 words (a reaction / aside)
  arrow = hand-drawn arrow pointing down at the speaker/product + ≤3-word label · stars = rating row, ONLY if a rating/review count is spoken (text = e.g. "4.9 · 2k terjual")
CUE: "w12" = when transcript word #12 starts, "w12$" = when it ends, "w12+0.3" offsets; plain seconds also OK.

RULES
- Hook covers 0–2.5 s: the video's promise in ≤5 punchy words. null if the video is under 5 s.
- Every overlay sits on the word it illustrates. Max 2 overlays on screen at once. Zones: top = headline/tag/tape/callout/arrow/fact area; bottom = chips/checks/cta (just above captions); middle = bigword/emoji/stamp/price only, briefly (don't cover the face for long).
- B-ROLL: pick moments where the speaker names something visual — the product, an ingredient, a place, a body part, an object, a brand, a problem. "query" = what to search on Google Images (English or Malay, specific, add the product/brand name when relevant, e.g. "Gluvera diabetic patch box"). 1 B-roll every 6–10 s, each 1.5–3 s; "full" for the product / big reveals, "pip" (card over the upper half) otherwise. Never during the first 1.5 s or the CTA.
- FACTS: 0–2 per video, only for checkable, non-medical background facts the speaker mentions (what an ingredient is, how something works in general, a brand/origin fact). "query" = a Google search that would confirm it. NEVER health/medical/cure/efficacy, price or "best/No.1" claims.
- KEYWORDS: 1 per caption page at most; colour product/brand names (brand), benefits (benefit), prices/numbers (price), problems (pain); add an emoji on ≤ 1 in 3.
- RE-HOOK: one, around 40–60 % of the runtime, only if the video is > 25 s ("Tapi tunggu…", "Ni paling penting…").
- CTA: only if the video sells something; place it on the last sentence (final 3–5 s). Use "Tekan beg kuning" unless the speaker says another CTA.
- Never invent prices, ratings, sales numbers, stock levels, claims or facts. Follow the CLIENT PROMPT (it overrides style choices, never the honesty rules).`;

export async function directEdit(opts: {
  words: DirectorWord[];
  duration: number;
  input: EditInput & { style?: "gempak" | "clean"; broll?: boolean; facts?: boolean };
  hasFace?: boolean;
}): Promise<EditPlanV2> {
  const { words, duration, input } = opts;
  const style = input.style === "clean" ? "clean" : "gempak";
  const transcript = words.slice(0, 1400).map((w) => `${w.i}@${w.t.toFixed(2)} ${w.w}`).join("\n");
  const userPrompt =
    `VIDEO: ${duration.toFixed(1)} s, ${words.length} words, language ${input.language}. Face on screen: ${opts.hasFace === false ? "no" : "yes"}.\n` +
    (input.product ? `PRODUCT / CONTEXT: ${clean(input.product, 300)}\n` : "") +
    (input.instructions ? `CLIENT PROMPT (follow it): ${clean(input.instructions, 900)}\n` : "") +
    (input.accent ? `PREFERRED ACCENT: ${input.accent}\n` : "") +
    (input.broll === false ? "B-ROLL: disabled — return \"broll\": [].\n" : "") +
    (input.facts === false ? "FACTS: disabled — return \"facts\": [].\n" : "") +
    `\nTRANSCRIPT (index@seconds word):\n${transcript || "(no speech detected)"}\n\nDirect the edit now. JSON only.`;

  let raw: any = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 2 && !raw; attempt++) {
    const r = await orChat({
      modelKey: "model_motion",
      systemPrompt: DIRECTOR_SYSTEM(style),
      userPrompt: attempt === 0 ? userPrompt : `${userPrompt}\n\nYour previous answer was not valid JSON (${lastErr}). Return ONLY the JSON object.`,
      temperature: 0.7,
      maxTokens: 7000,
      timeoutMs: 120_000,
      stream: true,
    });
    if (!r.ok || !r.content) { lastErr = r.error || "empty"; continue; }
    try { raw = extractJson(r.content); } catch (e: any) { lastErr = e?.message || "invalid"; }
  }
  if (!raw) throw new Error(`Director failed: ${lastErr}`);

  const plan = validateDirectorPlan(raw, words.length, duration, input, style);

  // Ground it: images + facts in parallel (each fail-soft).
  const [broll, facts] = await Promise.all([
    input.broll === false ? Promise.resolve([] as BRollPlan[]) : enrichBroll(plan.broll).catch(() => [] as BRollPlan[]),
    input.facts === false ? Promise.resolve([] as FactPlan[]) : writeFacts(rawFacts(raw, words.length, duration), words).catch(() => [] as FactPlan[]),
  ]);
  return { ...plan, broll, facts };
}

// ── validation ────────────────────────────────────────────────────────────────
function cueIn(c: unknown, nWords: number, duration: number): Cue | undefined {
  if (typeof c === "number" && Number.isFinite(c)) return c >= 0 && c < duration - 0.3 ? Math.round(c * 100) / 100 : undefined;
  if (typeof c !== "string") return undefined;
  const s = c.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) { const n = parseFloat(s); return n < duration - 0.3 ? n : undefined; }
  if (!EDIT_CUE.test(s)) return undefined;
  const m = /^w(\d+)/.exec(s);
  return m && Number(m[1]) < nWords ? s : undefined;
}

export function validateDirectorPlan(raw: any, nWords: number, duration: number, input: EditInput, style: "gempak" | "clean"): EditPlanV2 & { broll: BRollPlan[] } {
  const maxOverlays = Math.max(3, Math.ceil(duration / (style === "gempak" ? 2.2 : 3.5)));
  const overlays = (Array.isArray(raw?.overlays) ? raw.overlays : [])
    .map((it: any) => cleanItemPublic(it, EDIT_CUE))
    .filter((it: MotionItem | null): it is MotionItem => !!it && cueIn(it.at, nWords, duration) !== undefined)
    .map((it: MotionItem) => (it.to !== undefined && cueIn(it.to, nWords, duration) === undefined ? { ...it, to: undefined } : it))
    .slice(0, maxOverlays);
  const zooms = (Array.isArray(raw?.zooms) ? raw.zooms : [])
    .map((z: any) => {
      const at = cueIn(z?.at, nWords, duration);
      if (at === undefined) return null;
      const to = cueIn(z?.to, nWords, duration);
      return { at, ...(to !== undefined ? { to } : {}), scale: Math.min(1.25, Math.max(1.05, Number(z?.scale) || 1.14)) };
    })
    .filter(Boolean)
    .slice(0, Math.max(2, Math.ceil(duration / (style === "gempak" ? 3 : 6)))) as EditPlanV2["zooms"];
  const broll: BRollPlan[] = (Array.isArray(raw?.broll) ? raw.broll : [])
    .map((b: any) => {
      const at = cueIn(b?.at, nWords, duration);
      const query = clean(b?.query, 100);
      if (at === undefined || !query) return null;
      const to = cueIn(b?.to, nWords, duration);
      return { at, ...(to !== undefined ? { to } : {}), layout: b?.layout === "full" ? "full" : "pip", label: clean(b?.label, 30) || undefined, query, candidates: [] };
    })
    .filter(Boolean)
    .slice(0, Math.max(1, Math.ceil(duration / 5))) as BRollPlan[];
  const keywords = (Array.isArray(raw?.keywords) ? raw.keywords : [])
    .map((k: any) => {
      const i = Number(k?.i);
      if (!Number.isInteger(i) || i < 0 || i >= nWords || !KEY_COLORS.has(k?.color)) return null;
      const emoji = typeof k?.emoji === "string" ? Array.from(k.emoji.trim()).slice(0, 2).join("") : "";
      return { i, color: k.color, ...(emoji && /\p{Extended_Pictographic}/u.test(emoji) ? { emoji } : {}) };
    })
    .filter(Boolean)
    .slice(0, 80) as EditPlanV2["keywords"];
  const hookText = clean(raw?.hook?.text, 40);
  const accent = HEX.test(input.accent || "") ? input.accent! : HEX.test(raw?.accent) ? raw.accent : "#FFD93B";
  const rehookAt = cueIn(raw?.rehook?.at, nWords, duration);
  const ctaAt = cueIn(raw?.cta?.at, nWords, duration);
  return {
    hook: hookText && duration >= 5 ? { text: hookText, ...(raw?.hook?.sub ? { sub: clean(raw.hook.sub, 40) } : {}) } : null,
    accent,
    mood: MOODS.has(raw?.mood) ? raw.mood : style === "gempak" ? "upbeat" : "chill",
    captions: { on: input.captions, style: input.captionStyle, pos: input.captionPos, maxWords: input.captionStyle === "karaoke" ? 4 : 3 },
    overlays,
    zooms,
    broll,
    facts: [],
    keywords,
    ...(rehookAt !== undefined && clean(raw?.rehook?.text, 30) && duration > 20 ? { rehook: { at: rehookAt, text: clean(raw.rehook.text, 30) } } : {}),
    ...(ctaAt !== undefined && clean(raw?.cta?.text, 30) ? { cta: { at: ctaAt, text: clean(raw.cta.text, 30), ...(raw?.cta?.sub ? { sub: clean(raw.cta.sub, 34) } : {}) } } : {}),
  };
}

function rawFacts(raw: any, nWords: number, duration: number) {
  return (Array.isArray(raw?.facts) ? raw.facts : [])
    .map((f: any) => {
      const at = cueIn(f?.at, nWords, duration);
      const query = clean(f?.query, 120);
      if (at === undefined || !query) return null;
      const to = cueIn(f?.to, nWords, duration);
      return { at, ...(to !== undefined ? { to } : {}), query, topic: clean(f?.topic, 80) };
    })
    .filter(Boolean)
    .slice(0, 3) as { at: Cue; to?: Cue; query: string; topic: string }[];
}

// ── B-roll: Google Images + vision pick ──────────────────────────────────────
async function enrichBroll(moments: BRollPlan[]): Promise<BRollPlan[]> {
  if (!moments.length) return [];
  const results = await Promise.all(moments.map((m) => searchImages(m.query, { num: 8 }).catch(() => null)));
  const withHits = moments
    .map((m, k) => ({ m, hits: (results[k]?.hits ?? []).filter(goodImage) }))
    .filter((x) => x.hits.length > 0);
  if (!withHits.length) return [];

  // One vision call: for each moment show up to 3 thumbnails, ask which fits.
  const picks = await visionPick(withHits).catch(() => null);
  return withHits
    .map(({ m, hits }, k) => {
      const choice = picks?.[k];
      if (choice === -1) return null; // vision said none match
      const order = typeof choice === "number" && choice >= 0 && choice < hits.length ? [hits[choice], ...hits.filter((_, j) => j !== choice)] : hits;
      return { ...m, candidates: order.slice(0, 5).map((h) => h.url) };
    })
    .filter(Boolean) as BRollPlan[];
}

function goodImage(h: ImageHit): boolean {
  if (!/^https:\/\//i.test(h.url)) return false;
  if (/\.(svg|gif)(\?|$)/i.test(h.url)) return false;
  if (h.width && h.height && Math.min(h.width, h.height) < 400) return false;
  if (/(lookaside\.fbsbx|instagram\.f|tiktokcdn|x\.com\/|twimg)/i.test(h.url)) return false; // usually blocked / expiring
  return true;
}

async function visionPick(items: { m: BRollPlan; hits: ImageHit[] }[]): Promise<number[] | null> {
  const images: string[] = [];
  const lines: string[] = [];
  items.forEach(({ m, hits }, k) => {
    const opts = hits.slice(0, 3);
    lines.push(`Moment ${k} — query "${m.query}"${m.label ? ` (label "${m.label}")` : ""}: images ${opts.map((_, j) => `#${images.length + j}`).join(", ")}`);
    for (const h of opts) images.push(h.thumb || h.url);
  });
  if (images.length > 24) return null;
  const r = await orChatVision({
    modelKey: "model_motion",
    systemPrompt: "You pick B-roll images for a TikTok edit. For each moment choose the image that best and most literally matches the query (real product/object, clean, no big watermark, not a meme, not text-heavy, safe for ads). Answer ONLY JSON: {\"picks\":[n0,n1,...]} where n is the 0-based position WITHIN that moment's own images (0..2), or -1 if none fits.",
    textPrompt: lines.join("\n") + "\nImages are attached in order #0, #1, …",
    images,
    temperature: 0.2,
    maxTokens: 400,
    timeoutMs: 60_000,
    stream: true,
  });
  if (!r.ok || !r.content) return null;
  const j = extractJson(r.content);
  return Array.isArray(j?.picks) ? j.picks.map((x: any) => (Number.isInteger(x) ? x : 0)) : null;
}

// ── fact cards: Google web search + strict summariser ────────────────────────
async function writeFacts(moments: { at: Cue; to?: Cue; query: string; topic: string }[], words: DirectorWord[]): Promise<FactPlan[]> {
  if (!moments.length) return [];
  const res = await Promise.all(moments.map((m) => searchWeb(m.query, { num: 5 }).catch(() => null)));
  const blocks = moments.map((m, k) => {
    const hits: WebHit[] = res[k]?.hits ?? [];
    return `FACT ${k} — topic "${m.topic || m.query}"\n` + hits.slice(0, 5).map((h, j) => `  [${j}] (${h.domain}) ${h.title}: ${h.snippet}`).join("\n");
  });
  if (!res.some((r) => (r?.hits?.length ?? 0) > 0)) return [];
  const r = await orChat({
    modelKey: "model_motion",
    systemPrompt: "You write on-screen fact cards for a Malaysian TikTok video. Use ONLY the numbered search snippets given — never outside knowledge. For each FACT return {\"text\": Malay, ≤12 words, a neutral checkable fact, \"src\": snippet number} or null when the snippets don't clearly support a useful fact. NEVER write health/medical/cure/treatment/efficacy claims, prices, rankings or superlatives — return null instead. Answer ONLY JSON: {\"facts\":[...]} in the same order.",
    userPrompt: blocks.join("\n\n"),
    temperature: 0.2,
    maxTokens: 900,
    timeoutMs: 60_000,
    stream: true,
  });
  if (!r.ok || !r.content) return [];
  const j = extractJson(r.content);
  const out: FactPlan[] = [];
  (Array.isArray(j?.facts) ? j.facts : []).forEach((f: any, k: number) => {
    const m = moments[k];
    const hits = res[k]?.hits ?? [];
    const src = hits[Number(f?.src)] ?? hits[0];
    const text = clean(f?.text, 90);
    if (!m || !f || !text || !src) return;
    if (/(ubat|rawat|sembuh|penyakit|diabetes|kencing manis|kanser|cure|treat|heal|disease|klinikal|terbukti)/i.test(text)) return;
    out.push({ at: m.at, ...(m.to !== undefined ? { to: m.to } : {}), text, source: src.domain });
  });
  void words;
  return out;
}

// ── visual QA ─────────────────────────────────────────────────────────────────
export type QaPatch = { drop_overlays: number[]; move: { idx: number; zone: "top" | "middle" | "bottom" }[]; drop_broll: number[]; pip_broll: number[]; notes?: string };

export async function qaPatch(opts: {
  stills: { frame: number; t: number; active: string[]; image: string }[];
  overlays: { idx: number; t?: string; text?: string; zone?: string }[];
  broll: { idx: number; layout?: string }[];
}): Promise<QaPatch | null> {
  const stills = opts.stills.slice(0, 6);
  if (!stills.length) return null;
  const desc = stills.map((s, k) => `Still ${k} @${s.t.toFixed(1)}s — active: ${s.active.join(" | ") || "none"}`).join("\n");
  const r = await orChatVision({
    modelKey: "model_motion",
    systemPrompt: "You are the QA editor of an automated TikTok edit (9:16). Look at the stills and find REAL problems only: an overlay covering the speaker's eyes/mouth for long, overlays overlapping each other or the captions, text cut off at the frame edge, unreadable text, a B-roll image that is wrong/irrelevant/watermarked/low-quality, a full-screen B-roll hiding an important moment. Fix with the smallest change. Answer ONLY JSON: {\"drop_overlays\":[idx], \"move\":[{\"idx\":n,\"zone\":\"top|middle|bottom\"}], \"drop_broll\":[idx], \"pip_broll\":[idx], \"notes\":\"≤20 words\"}. Use the overlay/broll idx numbers from the lists. Empty arrays when it looks good.",
    textPrompt: `${desc}\n\nOVERLAYS: ${JSON.stringify(opts.overlays).slice(0, 4000)}\nBROLL: ${JSON.stringify(opts.broll)}`,
    images: stills.map((s) => s.image),
    temperature: 0.2,
    maxTokens: 700,
    timeoutMs: 90_000,
    stream: true,
  });
  if (!r.ok || !r.content) return null;
  const j = extractJson(r.content);
  const ints = (a: any, max: number) => (Array.isArray(a) ? a.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < max) : []);
  const nO = opts.overlays.length;
  const nB = opts.broll.length;
  const dropO = ints(j?.drop_overlays, nO).slice(0, Math.ceil(nO / 3)); // never strip the edit bare
  return {
    drop_overlays: dropO,
    move: (Array.isArray(j?.move) ? j.move : [])
      .map((m: any) => ({ idx: Number(m?.idx), zone: m?.zone }))
      .filter((m: any) => Number.isInteger(m.idx) && m.idx >= 0 && m.idx < nO && ["top", "middle", "bottom"].includes(m.zone)),
    drop_broll: ints(j?.drop_broll, nB),
    pip_broll: ints(j?.pip_broll, nB),
    notes: clean(j?.notes, 160),
  };
}
