// EVAL COPY — the CLIPPER director as of commit 06e7f87 ("v1": one LLM pass over the whole transcript + one
// judge/repair pass). Generated with `git show 06e7f87:lib/clipper.ts`; only changes: this header, the imports
// trimmed to what the director needs, and the job-settling section (settleClipperJob) removed. Used by run.ts.
// Do not import from app code.
// CLIPPER tab: a long video (YouTube / Google Drive / upload) → its most viral clips → rendered 9:16 clips.
//
// Analyse: a Modal job (modal_motion.py flow "clip-analyze") reads the title, the transcript (YouTube captions or
// Whisper) and YouTube's "most replayed" heatmap (or the loudness curve), then calls /api/clipper/plan, where the
// master director (model_motion = Sonnet 5.5) picks the clips. The analysis is a History row on its own tab key
// ("clipper-job") — never shown in a grid — with the clips in metadata.analysis.
// Render: every chosen clip is a History row on tab "clipper", rendered by the Edit Video pipeline (flow "clip":
// segment → 9:16 reframe around the speaker → captions / hook / full AI edit → HyperFrames).
import { orChat } from "@/lib/openrouter";
import { extractJson } from "@/lib/motion";

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

export type ClipSourceType = "youtube" | "gdrive" | "upload";
export type ClipDuration = "15" | "30" | "60" | "auto";
export type ClipperOptions = {
  duration: ClipDuration;
  count: "auto" | number;
  focus?: string;
  range?: { start: number; end: number } | null;
  language: "auto" | "ms" | "en" | "id";
};
export type HeatPoint = { start: number; end: number; value: number };
export type Line = { start: number; end: number; text: string };
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
};

const YT_ID = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const GD_ID = /(?:\/file\/d\/|[?&]id=|\/open\?id=)([A-Za-z0-9_-]{20,})/;
const UPLOAD_HOST = /^https:\/\/peninglab-content\.s3\.[a-z0-9-]+\.backblazeb2\.com\/clipper-uploads\//;

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

const SYSTEM = (o: ClipperOptions, langName: string, cnt: { say: string }, durSay: string, hasHeat: boolean) => `You are PeningLab's MASTER DIRECTOR for short-form video, working as a viral clip editor: you find the moments in a long video that will perform best as standalone TikTok / Reels / Shorts clips, for a Malaysian audience.

THE VIDEO'S LANGUAGE: ${langName}. Write "title", "hook", "caption", "hashtags" and "quote" 100% in ${langName} — never translate the video into another language, not even when the focus request is written in another one (Arabic / Islamic greetings inside a Malay or Indonesian video stay as they are; the output stays in ${langName}). Write "reason" and "summary" in Bahasa Melayu (Malaysia) — the client reads them.

WHAT MAKES A WINNING CLIP (TikTok 2026):
- It opens on a hook: the first spoken line already pulls — a bold claim, a surprising number, a question, a conflict, a confession, "the mistake everyone makes", a strong opinion. Never open on "so…", a greeting, a filler or the middle of an explanation; start where the hook starts.
- It stands alone: a viewer who never saw the full video understands it — the setup is inside the clip, and it ends on the payoff (the answer, the punchline, the lesson, the twist), on a complete sentence, never mid-thought.
- One idea per clip; every clip a different topic / moment — no near-duplicates, no filler, no intro / outro / sponsor read / "like and subscribe".
- Energy, emotion, humour, controversy, practical value (a tip, a number, a how-to) and story beats rank highest.${hasHeat ? `
- AUDIENCE DATA: each transcript line carries "interest" (0–1) — how much viewers replayed / engaged there (YouTube "most replayed", or the loudness curve). Prefer moments with high interest, but only when the content there truly works as a clip.` : ""}

CLIP LENGTH: ${durSay}. CLIP COUNT: ${cnt.say}.${o.focus ? `
CLIENT FOCUS: the client wants clips about: "${o.focus}". Prefer moments that fit it — they must still work as strong standalone clips.` : ""}

FIELDS PER CLIP:
- "from" / "to": the transcript line IDs (e.g. "L118") where the clip begins and ends — "from" is the line whose first words already pull (the hook / the setup the clip needs), "to" is the line where the payoff completes. Copy IDs exactly from the transcript. Clips never overlap.
- "title": ≤ 8 words, the catchy post title. NEVER first person (no "saya / aku / gue / I / my") — the client posting it is not the speaker: name the speaker or their role from the video title / channel ("Dr. X dedah…", "Host bongkar…", "CEO explains…") or use curiosity framing ("Fakta sebenar tentang…", "Kenapa ramai gagal…").
- "hook": ≤ 6 words, the on-screen hook text for the first 2.5 s — the clip's promise, punchy, in the speaker's words or meaning (not a copy of the title).
- "score": 1–100, honest viral potential (hook strength × standalone payoff × emotion / value × audience interest).
- "reason": ≤ 20 words, why it will perform.
- "quote": one verbatim line from the clip.
- "caption": a 1–2 sentence social caption that makes people watch.
- "hashtags": 3–6 relevant hashtags (lowercase, with #).

Return ONLY JSON: {"summary": "1–2 sentences: what the video is about", "clips": [{"from": "L…", "to": "L…", "title": string, "hook": string, "score": number, "reason": string, "quote": string, "caption": string, "hashtags": [string]}]} — sorted by score, best first.`;

/** The lines the prompt shows (≤ ~4000: a longer source is merged pairwise) — their IDs (L1, L2, …) are what the
 *  model answers with, so a boundary is always a real line (no invented seconds). */
function promptLines(lines: Line[]): Line[] {
  let ls = lines;
  while (ls.length > 4000) {
    const m: Line[] = [];
    for (let i = 0; i < ls.length; i += 2) {
      const a = ls[i], b = ls[i + 1];
      m.push(b ? { start: a.start, end: b.end, text: `${a.text} ${b.text}` } : a);
    }
    ls = m;
  }
  return ls;
}

function transcriptBlock(ls: Line[], heat: HeatPoint[]): string {
  return ls.map((l, i) => `L${i + 1} ${l.start.toFixed(1)}|${l.end.toFixed(1)}${heat.length ? `|${interestOf(heat, l.start, l.end).toFixed(2)}` : ""} ${l.text}`).join("\n");
}

const lineAt = (ls: Line[] | undefined, id: unknown): Line | null => {
  const m = /^L?(\d+)$/i.exec(String(id ?? "").trim());
  return ls && m ? ls[Number(m[1]) - 1] ?? null : null;
};
/** A line that continues a thought ("jadi…", "tapi…", "so…") can't open a clip: its setup is the line before. */
const CONTINUES = /^(jadi|tapi|sebab|so|but|and|dan|lepas tu|pastu|then|because|kerana|oleh itu|maka|tu (la|lah)|haa?)\b/i;

/** The model's clips held to the transcript: lines snapped, length bounds, no overlaps, best first. */
export function validateClips(raw: any, lines: Line[], heat: HeatPoint[], o: ClipperOptions, dur: number, idLines?: Line[]): ClipperClip[] {
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
    out.push({
      start: Math.round(s * 100) / 100, end: Math.round(e * 100) / 100, title,
      hook: txt(c?.hook, 60) || title.split(" ").slice(0, 6).join(" "),
      score: Math.max(1, Math.min(100, Math.round(Number(c?.score) || 60))),
      reason: txt(c?.reason, 220), caption: txt(c?.caption, 400), hashtags: tags, quote: txt(c?.quote, 240),
      text: inRange.slice(si, ei + 1).map((l) => l.text).join(" ").slice(0, 2400),
      ...(heat.length ? { interest: Math.round(interestOf(heat, s, e) * 100) / 100 } : {}),
    });
  }
  // best first; a clip overlapping a better one is dropped
  out.sort((a, z) => z.score - a.score);
  const kept: ClipperClip[] = [];
  for (const c of out) if (!kept.some((k) => c.start < k.end - 0.5 && c.end > k.start + 0.5)) kept.push(c);
  return kept.slice(0, o.count === "auto" ? 25 : o.count + 2);
}

/** No usable answer from the model: the most-replayed (or loudest) stretches, cut on line boundaries. */
export function fallbackClips(lines: Line[], heat: HeatPoint[], o: ClipperOptions, dur: number, title: string): ClipperClip[] {
  const target = o.duration === "auto" ? 40 : Number(o.duration);
  const n = o.count === "auto" ? Math.max(3, Math.min(8, Math.round(dur / 600) + 3)) : o.count;
  const scored = lines.map((l, i) => ({ i, v: heat.length ? interestOf(heat, l.start, l.end) : 0.5 }))
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
  const system = SYSTEM(o, langName, cnt, BOUNDS[o.duration].say, heatmap.length > 0);
  const ranged = o.range ? lines.filter((l) => l.start >= o.range!.start - 0.5 && l.end <= o.range!.end + 0.5) : lines;
  const shown = promptLines(ranged);
  const user = `VIDEO: "${meta.title || "(no title)"}"${meta.channel ? ` — channel / host: ${meta.channel}` : ""}. Length ${Math.round(meta.duration)} s.${o.range ? ` Only use ${Math.round(o.range.start)}–${Math.round(o.range.end)} s.` : ""}
TRANSCRIPT (ID start|end${heatmap.length ? "|interest" : ""} text):
---
${transcriptBlock(shown, heatmap)}
---
Find the clips now. JSON only.`;
  let raw: any = null;
  let director: string | null = null;
  for (let attempt = 0; attempt < 2 && !raw; attempt++) {
    const r = await orChat({
      modelKey: "model_motion",
      systemPrompt: system,
      userPrompt: attempt === 0 ? user : `${user}\n\nYour previous answer was not valid JSON. Return ONLY the JSON object.`,
      temperature: 0.4,
      maxTokens: 9000,
      timeoutMs: 200_000,
      stream: true,
      validate: (c) => { try { return validateClips(extractJson(c), lines, heatmap, o, meta.duration, shown).length > 0; } catch { return false; } },
      ...(opts.deadline ? { deadline: opts.deadline } : {}),
    });
    if (!r.ok || !r.content) continue;
    try { raw = extractJson(r.content); director = `${(r as any).provider ?? "?"}/${(r as any).model ?? "?"}`; } catch { raw = null; }
  }
  let clips = raw ? validateClips(raw, lines, heatmap, o, meta.duration, shown) : [];
  // second pass (time allowing): a judge checks every clip's start / setup / payoff and repairs or rejects it
  if (clips.length && (!opts.deadline || Date.now() < opts.deadline - 75_000)) {
    clips = await repairClips(clips, lines, heatmap, o, meta.duration, langName, opts.deadline).catch(() => clips);
  }
  if (clips.length) return { summary: String(raw?.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 400), clips, director, fallback: false };
  return { summary: "", clips: fallbackClips(lines, heatmap, o, meta.duration, meta.title || "Klip"), director: null, fallback: true };
}

/** Judge → repair: each clip with a few lines of context either side; the model keeps, moves (line IDs) or rejects it.
 *  Fixes move the START earlier for a missing setup rather than cutting the ending. A judge that rejects everything is
 *  ignored (the first pass stands). */
async function repairClips(clips: ClipperClip[], lines: Line[], heat: HeatPoint[], o: ClipperOptions, dur: number, langName: string,
  deadline?: number): Promise<ClipperClip[]> {
  const b = BOUNDS[o.duration];
  const idx = (t: number, key: "start" | "end") => lines.reduce((best, l, i) => (Math.abs(l[key] - t) < Math.abs(lines[best][key] - t) ? i : best), 0);
  const blocks = clips.map((c, k) => {
    const si = idx(c.start, "start"), ei = idx(c.end, "end");
    const from = Math.max(0, si - 4), to = Math.min(lines.length - 1, ei + 3);
    const rows = [];
    for (let i = from; i <= to; i++) rows.push(`${i >= si && i <= ei ? "*" : " "} L${i + 1} ${lines[i].text}`);
    return `CLIP ${k} — "${c.title}" (now L${si + 1}–L${ei + 1}, ${Math.round(c.end - c.start)} s; lines inside the clip are marked *)\n${rows.join("\n")}`;
  });
  const r = await orChat({
    modelKey: "model_motion",
    systemPrompt: `You are PeningLab's master director checking viral clip candidates before they are rendered (video language: ${langName}). For each clip decide:
- "ok": it opens on a line that already pulls (no "jadi / tapi / so…" mid-thought start), the setup it needs is inside, and it ends on the payoff (the answer, punchline, lesson or twist — a complete sentence, not an unanswered question or a trailing "and…").
- "fix": give new "from" / "to" line IDs. A missing setup → move FROM earlier; an ending cut mid-thought → move TO to where the payoff completes. Keep the clip between ${b.min} and ${b.max} s.
- "reject": no payoff exists or it doesn't stand alone — only when a fix can't save it.
Return ONLY JSON: {"clips": [{"i": number, "verdict": "ok" | "fix" | "reject", "from"?: "L…", "to"?: "L…", "why": "≤ 12 words"}]}`,
    userPrompt: blocks.join("\n\n") + "\n\nJudge every clip now. JSON only.",
    temperature: 0.2,
    maxTokens: 3000,
    timeoutMs: 90_000,
    stream: true,
    ...(deadline ? { deadline: deadline - 10_000 } : {}),
  });
  if (!r.ok || !r.content) return clips;
  const verdicts: any[] = extractJson(r.content)?.clips ?? [];
  const out: ClipperClip[] = [];
  for (const [k, c] of clips.entries()) {
    const v = verdicts.find((x) => Number(x?.i) === k);
    if (v?.verdict === "reject") continue;
    if (v?.verdict === "fix") {
      const fl = lineAt(lines, v.from), tl = lineAt(lines, v.to);
      const fixed = fl && tl ? validateClips({ clips: [{ ...c, start: fl.start, end: tl.end, hashtags: c.hashtags }] }, lines, heat, o, dur)[0] : null;
      if (fixed) { out.push({ ...fixed, reason: c.reason }); continue; }
    }
    out.push(c);
  }
  if (!out.length) return clips;
  out.sort((a, z) => z.score - a.score);
  const kept: ClipperClip[] = [];
  for (const c of out) if (!kept.some((k) => c.start < k.end - 0.5 && c.end > k.start + 0.5)) kept.push(c);
  return kept;
}

