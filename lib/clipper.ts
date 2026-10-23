// CLIPPER tab: a long video (YouTube / Google Drive / upload) → its most viral clips → rendered 9:16 clips.
//
// Analyse: a Modal job (modal_motion.py flow "clip-analyze") reads the title, the transcript (YouTube captions or
// Whisper) and YouTube's "most replayed" heatmap (or the loudness curve), then calls /api/clipper/plan, where the
// master director (model_motion = Sonnet 5.5) picks the clips. The analysis is a History row on its own tab key
// ("clipper-job") — never shown in a grid — with the clips in metadata.analysis.
// Render: every chosen clip is a History row on tab "clipper", rendered by the Edit Video pipeline (flow "clip":
// segment → 9:16 reframe around the speaker → captions / hook / full AI edit → HyperFrames).
import { createAdminClient } from "@/lib/supabase/admin";
import { orChat } from "@/lib/openrouter";
import { extractJson, motionCheck, type MotionCheck } from "@/lib/motion";

export const CLIPPER_JOB_TAB = "clipper-job";

/** Optional YouTube access for the Modal readers when YouTube flags our servers: app_settings.clipper_youtube =
 *  { cookies?: Netscape cookies.txt of a YouTube account, proxy?: "http://user:pass@host:port" }. Anonymous first. */
export async function clipperYoutubeAuth(): Promise<{ cookies?: string; proxy?: string } | null> {
  const { getSetting } = await import("@/lib/settings");
  const v = await getSetting<{ cookies?: unknown; proxy?: unknown }>("clipper_youtube").catch(() => null);
  const cookies = typeof v?.cookies === "string" && v.cookies.includes("youtube.com") ? v.cookies : undefined;
  const proxy = typeof v?.proxy === "string" && /^(https?|socks5h?):\/\//.test(v.proxy) ? v.proxy : undefined;
  return cookies || proxy ? { ...(cookies ? { cookies } : {}), ...(proxy ? { proxy } : {}) } : null;
}

export const CLIPPER_TAB = "clipper";
const ANALYSE_STALE_MS = 50 * 60_000;

export type ClipSourceType = "youtube" | "gdrive" | "upload" | "tiktok";
export type ClipDuration = "15" | "30" | "60" | "auto";
export type ClipperOptions = {
  duration: ClipDuration;
  count: "auto" | number;
  focus?: string;
  range?: { start: number; end: number } | null;
  language: "auto" | "ms" | "en" | "id";
};
export type HeatPoint = { start: number; end: number; value: number };
/** A transcript line; spk = the speaker (diarization, "S1"…), tags = audio events right there ("KETAWA", "TEPUK"…). */
export type Line = { start: number; end: number; text: string; spk?: string; tags?: string[] };
/** The judges' rubric, 0–10 each. */
export type ClipScores = { hook: number; flow: number; value: number; payoff: number };
export type ClipperClip = {
  start: number;
  end: number;
  title: string;
  hook: string;
  score: number;
  reason: string;
  caption: string;
  hashtags: string[];
  quote: string;
  text: string;
  interest?: number;
  scores?: ClipScores;
  /** a 2–3 s cold open: the clip's strongest line teased before it starts (source seconds) */
  flash?: { start: number; end: number } | null;
  speakers?: string[];
  /** the director looked at 6 frames of the clip: 0–10 + what it saw (top candidates only) */
  visual?: { score: number; note: string };
};
export type ClipperAnalysis = {
  source_type: ClipSourceType;
  title?: string | null;
  channel?: string | null;
  duration: number;
  thumb?: string | null;
  video_id?: string | null;
  language?: string | null;
  media_url?: string | null;
  heatmap: HeatPoint[];
  caption_source?: string;
  transcript_url?: string | null;
  lines?: number;
  summary: string;
  clips: ClipperClip[];
  director?: string | null;
  plan_error?: string | null;
  /** diarized speaker turns [start, end, "S1"] (source seconds), when the audio engine had speakers */
  turns?: [number, number, string][];
};

const YT_ID = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const GD_ID = /(?:\/file\/d\/|[?&]id=|\/open\?id=)([A-Za-z0-9_-]{20,})/;
const UPLOAD_HOST = /^https:\/\/peninglab-content\.s3\.[a-z0-9-]+\.backblazeb2\.com\/clipper-uploads\//;

/** What a clip's overlays must serve: the video's title + summary + why this clip was picked (≤ 600 chars). */
export function clipContext(a: { title?: string | null; summary?: string; clips?: { start: number; end: number; title?: string; reason?: string }[] } | null | undefined, start: number, end: number): string {
  if (!a) return "";
  const c = (a.clips ?? []).find((x) => Math.abs(Number(x.start) - start) < 3 && Math.abs(Number(x.end) - end) < 6);
  return [a.title, a.summary, c ? `Klip ini: ${c.title ?? ""} — ${c.reason ?? ""}` : ""].filter((x) => x && String(x).trim()).join(" · ").replace(/\s+/g, " ").slice(0, 600);
}

/** A client's source, checked and made canonical (null: not a link we can read). */
export function cleanSource(type: unknown, url: unknown, name?: unknown): { type: ClipSourceType; url: string; name?: string; video_id?: string } | null {
  const u = String(url ?? "").trim();
  if (type === "youtube") {
    const m = YT_ID.exec(u);
    return m ? { type, url: `https://www.youtube.com/watch?v=${m[1]}`, video_id: m[1] } : null;
  }
  if (type === "gdrive") {
    const m = GD_ID.exec(u);
    return m && /drive\.google\.com|docs\.google\.com/.test(u) ? { type, url: `https://drive.google.com/file/d/${m[1]}/view` } : null;
  }
  if (type === "upload") {
    return UPLOAD_HOST.test(u) ? { type, url: u, name: String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || "Video" } : null;
  }
  // a TikTok LIVE replay (Seller Center → LIVE Dashboard → Replay): its HLS playlist on TikTok's CDN — signed, no login
  if (type === "tiktok") {
    let host = "";
    try {
      const x = new URL(u);
      if (x.protocol !== "https:") return null;
      host = x.hostname;
    } catch { return null; }
    const cdn = /(^|\.)(akamaized\.net|tiktokcdn\.com|tiktokcdn-us\.com|tiktokcdn-eu\.com|byteoversea\.com|tiktokv\.com|tiktokv\.us|ibytedtos\.com)$/;
    return cdn.test(host) && /\.m3u8/i.test(u)
      ? { type, url: u, name: String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || "TikTok LIVE" } : null;
  }
  return null;
}

export function cleanOptions(raw: any): ClipperOptions {
  const duration: ClipDuration = ["15", "30", "60", "auto"].includes(String(raw?.duration)) ? String(raw.duration) as ClipDuration : "30";
  const n = Number(raw?.count);
  const count = raw?.count === "auto" || !Number.isFinite(n) ? "auto" : Math.max(1, Math.min(30, Math.round(n)));
  const s = Number(raw?.range?.start);
  const e = Number(raw?.range?.end);
  const range = Number.isFinite(s) && Number.isFinite(e) && e - s >= 20 && s >= 0 ? { start: s, end: e } : null;
  const language = (["ms", "en", "id"].includes(raw?.language) ? raw.language : "auto") as ClipperOptions["language"];
  const focus = String(raw?.focus ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || undefined;
  return { duration, count, focus, range, language };
}

// ── the director ─────────────────────────────────────────────────────────────

const BOUNDS: Record<ClipDuration, { min: number; max: number; say: string }> = {
  "15": { min: 9, max: 24, say: "about 15 s (10–22 s)" },
  "30": { min: 18, max: 45, say: "about 30 s (20–40 s)" },
  "60": { min: 38, max: 80, say: "about 60 s (45–75 s)" },
  auto: { min: 12, max: 90, say: "whatever each moment needs to land complete — 15 to 90 s, varied (some ~20–30 s, some ~40–60 s, a deep story up to ~90 s)" },
};
const LANG_NAME: Record<string, string> = { ms: "Bahasa Melayu (Malaysia)", id: "Bahasa Indonesia", en: "English" };

function countTarget(o: ClipperOptions, dur: number): { min: number; max: number; say: string } {
  if (o.count !== "auto") {
    const n = o.count;
    return { min: Math.max(1, n - 1), max: n + 1, say: `${n} clips (±1)` };
  }
  const [a, b] = dur <= 300 ? [2, 5] : dur <= 900 ? [4, 8] : dur <= 1800 ? [6, 12] : dur <= 3600 ? [8, 16] : [10, 20];
  return { min: a, max: b, say: `${a}–${b} clips — as many as the video has strong standalone moments, never filler` };
}

const interestOf = (heat: HeatPoint[], s: number, e: number): number => {
  const hit = heat.filter((h) => h.end > s && h.start < e);
  if (hit.length) return hit.reduce((a, h) => a + h.value, 0) / hit.length;
  if (!heat.length) return 0;
  const mid = (s + e) / 2;
  return heat.reduce((best, h) => (Math.abs((h.start + h.end) / 2 - mid) < Math.abs((best.start + best.end) / 2 - mid) ? h : best)).value;
};

const SIGNALS = `SIGNALS IN THE TRANSCRIPT (when present):
- "S1: …", "S2: …" = who is speaking (speaker separation). A strong clip often holds a complete exchange: the question / provocation (one speaker) AND the full answer (the other). Never start in the middle of someone's answer; never end before the answer lands.
- Tags after a line describe the AUDIO right there: [KETAWA] laughter (the line before it landed — a punchline), [TEPUK] applause, [SORAK] cheering, [JERIT] raised / shouting voice (emotion, conflict, excitement), [MUZIK] music (usually intro / outro / transition — avoid). Laughter and applause are evidence the moment works — let them pull the clip's end to include the reaction (1–2 s).`;

const RUBRIC = `SCORE EACH CLIP (honest, not generous — most clips are 5–7):
- "hook" 0–10: do the first 3 seconds stop the scroll on their own?
- "flow" 0–10: does it stand alone — setup inside, no missing context, one idea?
- "value" 0–10: emotion, humour, surprise, controversy, or practical value (a tip, a number, a how-to, a lesson)?
- "payoff" 0–10: does it END on the payoff (answer, punchline, twist, lesson) — a complete sentence?
- "score" 1–100: overall viral potential for TikTok / Reels / Shorts in Malaysia.`;

const SYSTEM = (o: ClipperOptions, langName: string, durSay: string, hasHeat: boolean) => `You are PeningLab's MASTER DIRECTOR for short-form video, working as a viral clip editor: you find the moments in a long video that will perform best as standalone TikTok / Reels / Shorts clips, for a Malaysian audience.

THE VIDEO'S LANGUAGE: ${langName}. Write "title", "hook", "caption", "hashtags" and "quote" 100% in ${langName} — never translate the video into another language, not even when the focus request is written in another one (Arabic / Islamic greetings inside a Malay or Indonesian video stay as they are; the output stays in ${langName}). Write "reason" and "summary" in Bahasa Melayu (Malaysia) — the client reads them.

WHAT MAKES A WINNING CLIP (TikTok 2026):
- It opens on a hook: the first spoken line already pulls — a bold claim, a surprising number, a question, a conflict, a confession, "the mistake everyone makes", a strong opinion. Never open on "so…", a greeting, a filler or the middle of an explanation; start where the hook starts.
- It stands alone: a viewer who never saw the full video understands it — the setup is inside the clip, and it ends on the payoff (the answer, the punchline, the lesson, the twist), on a complete sentence, never mid-thought.
- One idea per clip; every clip a different topic / moment — no near-duplicates, no filler, no intro / outro / sponsor read / "like and subscribe".
- Energy, emotion, humour, controversy, practical value (a tip, a number, a how-to) and story beats rank highest.${hasHeat ? `
- AUDIENCE DATA: each transcript line carries "interest" (0–1) — how much viewers replayed / engaged there (YouTube "most replayed", or the loudness curve). Prefer moments with high interest, but only when the content there truly works as a clip.` : ""}

${SIGNALS}

CLIP LENGTH: ${durSay}. HARD LIMIT: from the start of "from" to the end of "to" is at most ${BOUNDS[o.duration].max} s and at least ${BOUNDS[o.duration].min} s — count it with the line times. A moment that needs longer: take its strongest stretch (the setup line + the payoff), not the whole story.${o.focus ? `
CLIENT FOCUS: the client wants clips about: "${o.focus}". Prefer moments that fit it — they must still work as strong standalone clips.` : ""}

${RUBRIC}

FIELDS PER CLIP:
- "from" / "to": the transcript line IDs (e.g. "L118") where the clip begins and ends — "from" is the line whose first words already pull (the hook / the setup the clip needs), "to" is the line where the payoff completes (plus the laughter / reaction right after it). Copy IDs exactly from the transcript. Clips never overlap.
- "flash": OPTIONAL line ID inside the clip (not its first lines) — the single most striking line (the punchline / shock / big number) to tease as a 2–3 s cold open BEFORE the clip starts. Only when that line is clearly stronger than the clip's own opening; otherwise omit.
- "title": ≤ 8 words, the catchy post title. NEVER first person (no "saya / aku / gue / I / my") — the client posting it is not the speaker: name the speaker or their role from the video title / channel ("Dr. X dedah…", "Host bongkar…", "CEO explains…") or use curiosity framing ("Fakta sebenar tentang…", "Kenapa ramai gagal…").
- "hook": ≤ 6 words, the on-screen hook text for the first 2.5 s — the clip's promise, punchy, in the speaker's words or meaning (not a copy of the title).
- "scores": {"hook", "flow", "value", "payoff"} and "score" — see SCORE EACH CLIP.
- "reason": ≤ 20 words, why it will perform.
- "quote": one verbatim line from the clip.
- "caption": a 1–2 sentence social caption that makes people watch.
- "hashtags": 3–6 relevant hashtags (lowercase, with #).

Return ONLY JSON: {"summary": "1–2 sentences: what this part of the video is about", "clips": [{"from": "L…", "to": "L…", "flash"?: "L…", "title": string, "hook": string, "scores": {"hook": n, "flow": n, "value": n, "payoff": n}, "score": number, "reason": string, "quote": string, "caption": string, "hashtags": [string]}]} — sorted by score, best first.`;

/** The lines the prompt shows (≤ ~4000 per part: a longer part is merged pairwise) — their IDs (L1, L2, …) are what
 *  the model answers with, so a boundary is always a real line (no invented seconds). */
function promptLines(lines: Line[]): Line[] {
  let ls = lines;
  while (ls.length > 4000) {
    const m: Line[] = [];
    for (let i = 0; i < ls.length; i += 2) {
      const a = ls[i], b = ls[i + 1];
      m.push(b ? { start: a.start, end: b.end, text: `${a.text} ${b.text}`, spk: a.spk, tags: [...(a.tags ?? []), ...(b.tags ?? [])] } : a);
    }
    ls = m;
  }
  return ls;
}

const lineRow = (l: Line, id: number, heat: HeatPoint[]) =>
  `L${id} ${l.start.toFixed(1)}|${l.end.toFixed(1)}${heat.length ? `|${interestOf(heat, l.start, l.end).toFixed(2)}` : ""} ${l.spk ? `${l.spk}: ` : ""}${l.text}${l.tags?.length ? ` [${[...new Set(l.tags)].join("] [")}]` : ""}`;

const lineAt = (ls: Line[] | undefined, id: unknown): Line | null => {
  const m = /^L?(\d+)$/i.exec(String(id ?? "").trim());
  return ls && m ? ls[Number(m[1]) - 1] ?? null : null;
};
/** A line that continues a thought ("jadi…", "tapi…", "so…") can't open a clip: its setup is the line before. */
const CONTINUES = /^(jadi|tapi|sebab|so|but|and|dan|lepas tu|pastu|then|because|kerana|oleh itu|maka|tu (la|lah)|haa?)\b/i;

const clamp10 = (v: unknown) => Math.max(0, Math.min(10, Math.round((Number(v) || 0) * 10) / 10));
const scoresOf = (v: any): ClipScores | undefined =>
  v && typeof v === "object" && ["hook", "flow", "value", "payoff"].some((k) => Number.isFinite(Number(v[k])))
    ? { hook: clamp10(v.hook), flow: clamp10(v.flow), value: clamp10(v.value), payoff: clamp10(v.payoff) }
    : undefined;

/** The model's clips held to the transcript: lines snapped, length bounds, no overlaps, best first. */
export function validateClips(raw: any, lines: Line[], heat: HeatPoint[], o: ClipperOptions, dur: number, idLines?: Line[], keepAll = false): ClipperClip[] {
  const b = BOUNDS[o.duration];
  const lo = o.range ? o.range.start : 0;
  const hi = o.range ? Math.min(o.range.end, dur || o.range.end) : dur || Infinity;
  const inRange = lines.filter((l) => l.start >= lo - 0.5 && l.end <= hi + 0.5);
  if (!inRange.length) return [];
  const txt = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const out: ClipperClip[] = [];
  for (const c of Array.isArray(raw?.clips) ? raw.clips : []) {
    const fl = lineAt(idLines, c?.from), tl = lineAt(idLines, c?.to);
    const s0 = fl ? fl.start : Number(c?.start), e0 = tl ? tl.end : Number(c?.end);
    if (!Number.isFinite(s0) || !Number.isFinite(e0) || e0 <= s0) continue;
    // the line that starts nearest the given start, the line that ends nearest the given end
    let si = inRange.reduce((best, l, i) => (Math.abs(l.start - s0) < Math.abs(inRange[best].start - s0) ? i : best), 0);
    let ei = inRange.reduce((best, l, i) => (Math.abs(l.end - e0) < Math.abs(inRange[best].end - e0) ? i : best), 0);
    if (ei < si) continue;
    // a clip can't open mid-thought: pull in the line before when it fits
    if (si > 0 && CONTINUES.test(inRange[si].text) && inRange[ei].end - inRange[si - 1].start <= b.max) si--;
    // too long → drop lines from the end; too short → add the next lines
    while (ei > si && inRange[ei].end - inRange[si].start > b.max) ei--;
    while (ei < inRange.length - 1 && inRange[ei].end - inRange[si].start < b.min) ei++;
    const s = inRange[si].start, e = inRange[ei].end;
    if (e - s < Math.max(5, b.min * 0.6) || e - s > b.max + 8) continue;
    const title = txt(c?.title, 90);
    if (!title) continue;
    const tags = (Array.isArray(c?.hashtags) ? c.hashtags : String(c?.hashtags ?? "").split(/[\s,]+/))
      .map((h: unknown) => String(h ?? "").trim().toLowerCase().replace(/^#?/, "#").replace(/[^#\p{L}\p{N}_]/gu, ""))
      .filter((h: string) => h.length > 1).slice(0, 6);
    // the cold-open tease: a line inside the clip, past its opening
    const fz = lineAt(idLines, c?.flash) ?? (c?.flash && typeof c.flash === "object" ? { start: Number(c.flash.start), end: Number(c.flash.end), text: "" } : null);
    const flash = fz && Number.isFinite(fz.start) && Number.isFinite(fz.end) && fz.start >= s + Math.min(4, (e - s) * 0.2) && fz.end <= e + 0.5 && fz.end > fz.start
      ? { start: Math.round(fz.start * 100) / 100, end: Math.round(Math.min(fz.end, fz.start + 3.2) * 100) / 100 } : null;
    const spks = [...new Set(inRange.slice(si, ei + 1).map((l) => l.spk).filter((x): x is string => !!x))];
    const sc = scoresOf(c?.scores);
    out.push({
      start: Math.round(s * 100) / 100, end: Math.round(e * 100) / 100, title,
      hook: txt(c?.hook, 60) || title.split(" ").slice(0, 6).join(" "),
      score: Math.max(1, Math.min(100, Math.round(Number(c?.score) || 60))),
      reason: txt(c?.reason, 220), caption: txt(c?.caption, 400), hashtags: tags, quote: txt(c?.quote, 240),
      text: inRange.slice(si, ei + 1).map((l) => l.text).join(" ").slice(0, 2400),
      ...(heat.length ? { interest: Math.round(interestOf(heat, s, e) * 100) / 100 } : {}),
      ...(sc ? { scores: sc } : {}),
      ...(flash ? { flash } : {}),
      ...(spks.length ? { speakers: spks } : {}),
    });
  }
  // best first; a clip overlapping a better one is dropped
  out.sort((a, z) => z.score - a.score);
  const kept: ClipperClip[] = [];
  for (const c of out) if (!kept.some((k) => c.start < k.end - 0.5 && c.end > k.start + 0.5)) kept.push(c);
  return keepAll ? kept : kept.slice(0, o.count === "auto" ? 25 : o.count + 2);
}

/** No usable answer from the model: the most-replayed (or loudest) stretches, cut on line boundaries. */
export function fallbackClips(lines: Line[], heat: HeatPoint[], o: ClipperOptions, dur: number, title: string): ClipperClip[] {
  const target = o.duration === "auto" ? 40 : Number(o.duration);
  const n = o.count === "auto" ? Math.max(3, Math.min(8, Math.round(dur / 600) + 3)) : o.count;
  const scored = lines.map((l, i) => ({ i, v: (heat.length ? interestOf(heat, l.start, l.end) : 0.5) + (l.tags?.some((t) => t === "KETAWA" || t === "TEPUK") ? 0.3 : 0) }))
    .filter(({ i }) => !o.range || (lines[i].start >= o.range.start && lines[i].end <= o.range.end))
    .sort((a, b) => b.v - a.v);
  const raw: any[] = [];
  for (const { i } of scored) {
    if (raw.length >= n) break;
    const s = lines[i].start;
    let j = i;
    while (j < lines.length - 1 && lines[j].end - s < target) j++;
    if (raw.some((c) => s < c.end + 20 && lines[j].end > c.start - 20)) continue;
    raw.push({ start: s, end: lines[j].end, title: `${title.split(" ").slice(0, 5).join(" ")} · Momen ${raw.length + 1}`, score: 70 - raw.length * 3,
      reason: "Bahagian paling ramai tonton semula / paling bertenaga dalam video.", hook: lines[i].text.split(" ").slice(0, 6).join(" ") });
  }
  return validateClips({ clips: raw }, lines, heat, o, dur);
}

/** The video split into parts the director reads in parallel (~25 min each, 60 s overlap) — one pass over a 3-hour
 *  transcript loses the middle; per-part candidates are pooled and ranked by the judges. */
function partsOf(ls: Line[], partSec = 1500, overlap = 60): { a: number; b: number; ids: number[] }[] {
  if (!ls.length) return [];
  const t0 = ls[0].start, t1 = ls[ls.length - 1].end;
  if (t1 - t0 <= partSec * 1.25) return [{ a: t0, b: t1, ids: ls.map((_, i) => i) }];
  const n = Math.ceil((t1 - t0) / partSec);
  const size = (t1 - t0) / n;
  const out: { a: number; b: number; ids: number[] }[] = [];
  for (let k = 0; k < n; k++) {
    const a = t0 + k * size, b = k === n - 1 ? t1 : t0 + (k + 1) * size;
    const ids = ls.map((l, i) => ({ l, i })).filter(({ l }) => l.end > a - overlap && l.start < b + overlap).map(({ i }) => i);
    if (ids.length >= 3) out.push({ a, b, ids });
  }
  return out;
}

export async function directClips(opts: {
  meta: { title?: string | null; channel?: string | null; duration: number; language?: string | null };
  heatmap: HeatPoint[];
  lines: Line[];
  options: ClipperOptions;
  deadline?: number;
}): Promise<{ summary: string; clips: ClipperClip[]; director: string | null; fallback: boolean }> {
  const { meta, heatmap, lines, options: o } = opts;
  const lang = (o.language !== "auto" ? o.language : meta.language) || "ms";
  const langName = LANG_NAME[lang] ?? `the video's own language (code "${lang}")`;
  const cnt = countTarget(o, meta.duration);
  const system = SYSTEM(o, langName, BOUNDS[o.duration].say, heatmap.length > 0);
  const ranged = o.range ? lines.filter((l) => l.start >= o.range!.start - 0.5 && l.end <= o.range!.end + 0.5) : lines;
  const shown = promptLines(ranged);
  const parts = partsOf(shown);
  // per part: ~2.5× its share of the final count (min 3) — the judges cut the pool down
  const perPart = Math.max(3, Math.min(10, Math.ceil((cnt.max * 2.5) / Math.max(1, parts.length))));
  const head = `VIDEO: "${meta.title || "(no title)"}"${meta.channel ? ` — channel / host: ${meta.channel}` : ""}. Length ${Math.round(meta.duration)} s.${o.range ? ` Only use ${Math.round(o.range.start)}–${Math.round(o.range.end)} s.` : ""}`;
  const partDeadline = opts.deadline ? opts.deadline - 85_000 : undefined;
  let director: string | null = null;
  const summaries: string[] = [];
  const results = await Promise.all(parts.map(async (p, k) => {
    const block = p.ids.map((i) => lineRow(shown[i], i + 1, heatmap)).join("\n");
    const user = `${head}
${parts.length > 1 ? `This is PART ${k + 1} of ${parts.length} (${Math.round(p.a / 60)}–${Math.round(p.b / 60)} min). Find the best clip candidates in THIS part only — up to ${perPart}, real standouts only (fewer is fine when the part is weak).` : `Find the clips: ${cnt.say}.`}
TRANSCRIPT (ID start|end${heatmap.length ? "|interest" : ""} [speaker:] text [audio tags]):
---
${block}
---
JSON only.`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await orChat({
        modelKey: "model_motion",
        systemPrompt: system,
        userPrompt: attempt === 0 ? user : `${user}\n\nYour previous answer was not valid JSON. Return ONLY the JSON object.`,
        temperature: 0.4,
        maxTokens: parts.length > 1 ? 8000 : 10000,
        timeoutMs: parts.length > 1 ? 150_000 : 200_000,
        stream: true,
        validate: (c) => { try { return Array.isArray(extractJson(c)?.clips); } catch { return false; } },
        ...(partDeadline ? { deadline: partDeadline } : {}),
      });
      if (!r.ok || !r.content) continue;
      try {
        const raw = extractJson(r.content);
        director ??= `${(r as any).provider ?? "?"}/${(r as any).model ?? "?"}`;
        if (raw?.summary) summaries[k] = String(raw.summary).replace(/\s+/g, " ").trim();
        return validateClips(raw, lines, heatmap, o, meta.duration, shown, true);
      } catch { /* retry */ }
    }
    return [] as ClipperClip[];
  }));
  // the pool: every part's candidates, a clip overlapping a better one dropped, the strongest ~30 go to the judges
  const pool: ClipperClip[] = [];
  for (const c of results.flat().sort((a, z) => z.score - a.score)) {
    if (!pool.some((k) => c.start < k.end - 0.5 && c.end > k.start + 0.5)) pool.push(c);
  }
  const short = pool.slice(0, Math.min(30, Math.max(cnt.max + 6, Math.ceil(cnt.max * 1.8))));
  if (!short.length) {
    return { summary: "", clips: fallbackClips(lines, heatmap, o, meta.duration, meta.title || "Klip"), director: null, fallback: true };
  }
  let ranked = short;
  if (short.length > 1 && (!opts.deadline || Date.now() < opts.deadline - 70_000)) {
    ranked = await judgeClips(short, shown, lines, heatmap, o, meta.duration, langName, opts.deadline).catch(() => short);
  }
  // the final set: best first; "auto" keeps the strong ones within the count range
  ranked.sort((a, z) => z.score - a.score);
  const n = o.count === "auto"
    ? Math.max(cnt.min, Math.min(cnt.max, ranked.filter((c) => c.score >= 60).length))
    : o.count;
  const clips = ranked.slice(0, n);
  const summary = (summaries.find(Boolean) && parts.length > 1
    ? summaries.filter(Boolean).slice(0, 3).join(" ")
    : summaries[0] || "").slice(0, 400);
  return { summary, clips, director, fallback: false };
}

/** Two judges (the same director, the candidates in opposite orders — cancels position bias) score every candidate
 *  on the rubric and keep / fix (line IDs) / reject it. Final score = judges (mostly) + the finder's score + audience
 *  interest. A candidate is dropped only when both judges reject it; judges that fail leave the pool as it was. */
async function judgeClips(clips: ClipperClip[], shown: Line[], lines: Line[], heat: HeatPoint[], o: ClipperOptions, dur: number, langName: string,
  deadline?: number): Promise<ClipperClip[]> {
  const b = BOUNDS[o.duration];
  const idx = (t: number, key: "start" | "end") => shown.reduce((best, l, i) => (Math.abs(l[key] - t) < Math.abs(shown[best][key] - t) ? i : best), 0);
  const blockOf = (c: ClipperClip, k: number) => {
    const si = idx(c.start, "start"), ei = idx(c.end, "end");
    const from = Math.max(0, si - 3), to = Math.min(shown.length - 1, ei + 2);
    const rows: string[] = [];
    for (let i = from; i <= to; i++) {
      const l = shown[i];
      rows.push(`${i < si ? "-" : i > ei ? "+" : "*"} L${i + 1} ${l.spk ? `${l.spk}: ` : ""}${l.text}${l.tags?.length ? ` [${[...new Set(l.tags)].join("] [")}]` : ""}`);
    }
    return `C${k} — "${c.title}" — hook "${c.hook}" (L${si + 1}–L${ei + 1}, ${Math.round(c.end - c.start)} s)\n${rows.join("\n")}`;
  };
  const sys = `You are the strict final judge of PeningLab's viral clip candidates (video language: ${langName}; audience: Malaysia; TikTok / Reels / Shorts 2026). You did NOT pick these — be critical. Lines marked * are inside the clip, - are just before it, + just after.

${SIGNALS}

${RUBRIC}

For each candidate also decide:
- "ok": it opens on a line that already pulls (no "jadi / tapi / so…" mid-thought start), the setup it needs is inside, and it ends on the payoff (a complete sentence — plus the laughter / reaction right after it when there is one).
- "fix": give new "from" / "to" line IDs. A missing setup → move FROM earlier; an ending cut mid-thought or before the reaction → move TO later. Keep the clip between ${b.min} and ${b.max} s.
- "reject": no payoff, doesn't stand alone, filler, intro / outro / sponsor read — only when a fix can't save it.
Return ONLY JSON: {"clips": [{"c": "C…", "verdict": "ok" | "fix" | "reject", "from"?: "L…", "to"?: "L…", "scores": {"hook": n, "flow": n, "value": n, "payoff": n}, "score": number, "why": "≤ 12 words"}]} — one entry per candidate.`;
  const order = clips.map((_, k) => k);
  const ask = (ord: number[]) => orChat({
    modelKey: "model_motion",
    systemPrompt: sys,
    userPrompt: ord.map((k) => blockOf(clips[k], k)).join("\n\n") + "\n\nJudge every candidate now. JSON only.",
    temperature: 0.2,
    maxTokens: 6000,
    timeoutMs: 120_000,
    stream: true,
    validate: (c) => { try { return Array.isArray(extractJson(c)?.clips); } catch { return false; } },
    ...(deadline ? { deadline: deadline - 8_000 } : {}),
  }).then((r) => {
    if (!r.ok || !r.content) return null;
    try {
      const list: any[] = extractJson(r.content)?.clips ?? [];
      const by = new Map<number, any>();
      for (const v of list) { const m = /^C?(\d+)$/i.exec(String(v?.c ?? "").trim()); if (m) by.set(Number(m[1]), v); }
      return by;
    } catch { return null; }
  }).catch(() => null);
  const [ja, jb] = await Promise.all([ask(order), ask([...order].reverse())]);
  if (!ja && !jb) return clips;
  const out: ClipperClip[] = [];
  for (const [k, c] of clips.entries()) {
    const vs = [ja?.get(k), jb?.get(k)].filter(Boolean) as any[];
    if (!vs.length) { out.push(c); continue; }
    if (vs.every((v) => v.verdict === "reject")) continue;
    let base = c;
    const fx = vs.find((v) => v.verdict === "fix" && v.from && v.to);
    if (fx) {
      const fl = lineAt(shown, fx.from), tl = lineAt(shown, fx.to);
      const fixed = fl && tl ? validateClips({ clips: [{ ...c, start: fl.start, end: tl.end, flash: c.flash, hashtags: c.hashtags }] }, lines, heat, o, dur, undefined, true)[0] : null;
      if (fixed) base = { ...fixed, reason: c.reason, scores: c.scores, speakers: fixed.speakers ?? c.speakers };
    }
    const js = vs.map((v) => Math.max(1, Math.min(100, Number(v.score) || 0))).filter((x) => x > 1);
    const judge = js.length ? js.reduce((a, x) => a + x, 0) / js.length : base.score;
    const subs = vs.map((v) => scoresOf(v.scores)).filter(Boolean) as ClipScores[];
    const scores = subs.length
      ? (["hook", "flow", "value", "payoff"] as const).reduce((acc, key) => ({ ...acc, [key]: Math.round((subs.reduce((a, s) => a + s[key], 0) / subs.length) * 10) / 10 }), {} as ClipScores)
      : base.scores;
    const interest = typeof base.interest === "number" ? base.interest : null;
    const final = interest !== null ? 0.55 * judge + 0.25 * c.score + 0.2 * interest * 100 : 0.7 * judge + 0.3 * c.score;
    out.push({ ...base, score: Math.max(1, Math.min(100, Math.round(final))), ...(scores ? { scores } : {}) });
  }
  if (!out.length) return clips;
  out.sort((a, z) => z.score - a.score);
  const kept: ClipperClip[] = [];
  for (const c of out) if (!kept.some((k) => c.start < k.end - 0.5 && c.end > k.start + 0.5)) kept.push(c);
  return kept;
}

// ── settle an analysis job ───────────────────────────────────────────────────

type JobRow = { id: string; user_id: string; status: string; task_id: string | null; metadata: any; created_at?: string };

/** A pending analysis: check Modal; finished → the analysis lands in metadata, failed → the error. */
export async function settleClipperJob(row: JobRow, pre?: MotionCheck): Promise<{ state: string; status?: string; error?: string; progress?: { stage?: string; pct?: number } | null }> {
  if (row.status !== "pending") return { state: "skipped" };
  const meta = row.metadata || {};
  const admin = createAdminClient();
  const createdMs = new Date(row.created_at || meta.created_at || Date.now()).getTime();
  if (!row.task_id) {
    if (Date.now() - createdMs > 10 * 60_000) {
      await admin.from("history").update({ status: "failed", error_message: "Analisa tidak bermula — cuba lagi." }).eq("id", row.id).eq("status", "pending");
      return { state: "settled", status: "failed" };
    }
    return { state: "pending" };
  }
  const r = pre ?? (await motionCheck(row.task_id));
  if (r.status === "running" || r.status === "unknown") {
    if (Date.now() - createdMs > ANALYSE_STALE_MS) {
      await admin.from("history").update({ status: "failed", error_message: "Analisa mengambil masa terlalu lama — cuba lagi." }).eq("id", row.id).eq("status", "pending");
      return { state: "settled", status: "failed" };
    }
    return { state: "pending", progress: r.status === "running" ? r.progress ?? null : null };
  }
  if (r.status === "failed") {
    await admin.from("history").update({ status: "failed", error_message: String(r.error || "Analisa gagal").slice(0, 500), metadata: { ...meta, stage: "failed" } })
      .eq("id", row.id).eq("status", "pending");
    return { state: "settled", status: "failed", error: r.error };
  }
  const a = (r.result as any)?.analysis as ClipperAnalysis | undefined;
  if (!a) {
    await admin.from("history").update({ status: "failed", error_message: "Analisa tidak lengkap — cuba lagi." }).eq("id", row.id).eq("status", "pending");
    return { state: "settled", status: "failed" };
  }
  const { data: flipped } = await admin.from("history").update({
    status: "done",
    error_message: a.clips?.length ? null : (a.plan_error ? `AI tidak dapat memilih klip: ${a.plan_error}` : "Tiada klip ditemui."),
    prompt: String(a.title || meta.source?.name || "Video").slice(0, 200),
    thumbnail_url: a.thumb || null,
    duration: Math.round(a.duration || 0),
    metadata: { ...meta, stage: "done", analysis: a, settled_at: new Date().toISOString() },
  }).eq("id", row.id).eq("status", "pending").select("id");
  if (!flipped?.length) return { state: "skipped" };
  return { state: "settled", status: "done" };
}
