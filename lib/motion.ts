// Motion tab — AI motion-graphics videos rendered by Remotion on Modal
// (modal_motion.py + ./motion). Two flows:
//
//   Buat Iklan (feature "motion-ad")   brief → LLM script + scene spec
//     (model_motion cascade) → MiniMax voice per line → Modal: Whisper word
//     timings, music + VO mix, product cut-outs, Remotion MotionAd → MP4.
//
//   Edit Video (feature "motion-edit") client video → Modal: normalise +
//     Whisper transcript → calls back /api/motion/plan (LLM caption/overlay
//     plan, model_motion) → Remotion MotionEdit → MP4.
//
// Billing: rate_motion.per_second (partner markup via priceFor "motion").
// An estimate is RESERVED at submit; settleMotionRow trues it up to
// ceil(actual seconds) × rate on success, or refunds it on failure.

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";
import { orChat } from "@/lib/openrouter";
import { synthesizeSpeech } from "@/lib/tts";
import { deduct, refundReserved } from "@/lib/deduct";
import type { HistoryRow, SettleResult } from "@/lib/settle";
import { MOTION_MY_TIKTOK_GUIDE } from "@/lib/motion-prompts";
import { motionStyle, styleEnergy, type MotionStyleId } from "@/lib/motion-styles";
import { GUARD_RULES, guardFixSlots, guardHits, guardProductRisk, guardStripQuery } from "@/lib/motion-guard";

export const MOTION_AD_DURATIONS = [15, 30, 45] as const;
export const MOTION_EDIT_MAX_SEC = 180;
export const MOTION_EDIT_MAX_MB = 300;
// Fixed overhead of an ad beyond the spoken words: lead-in, pauses, end card.
const AD_OVERHEAD_SEC = 4;
// Natural Malay narration pace for MiniMax at speed 1.0.
const WORDS_PER_SEC = 2.5;
// A Buat Iklan row still without a Modal call after this long was lost
// (function killed mid-plan) → fail + refund.
const PLANNING_STALE_MS = 12 * 60 * 1000;
// Modal job timeout is 30 min; anything pending long past that is dead.
const RENDER_STALE_MS = 50 * 60 * 1000;
export const MOTION_PLANNING_TASK = "motion:planning";

export const MOTION_VOICES = [
  { key: "mira", label: "Mira", gender: "f" },
  { key: "afifah", label: "Afifah", gender: "f" },
  { key: "nana", label: "Nana", gender: "f" },
  { key: "mila", label: "Mila", gender: "f" },
  { key: "jamal", label: "Jamal", gender: "m" },
  { key: "aqil", label: "Aqil", gender: "m" },
] as const;

// ── types (mirror motion/src/types.ts) ────────────────────────────────────────
type Cue = string | number;
export type MotionItem = {
  t: string; text?: string; sub?: string; at: Cue; to?: Cue;
  zone?: "top" | "middle" | "bottom"; tone?: string; mark?: "check" | "cross";
  /** gif: sticker URL — set server-side from the sticker search, never by the model. */
  src?: string;
};
export type AdLinePlan = { id: string; act: string; text: string; tts: string; pause: number };
export type AdScenePlan = {
  id: string; from: Cue; bg?: string; endcard?: boolean; items: MotionItem[];
  hero?: { kind: "product" | "presenter" | "none"; image?: number; side?: "L" | "C" | "R" };
};
export type AdPlan = {
  brand: { name: string; tagline?: string; price?: string; oldPrice?: string; cta?: string; handle?: string; accent: string };
  mood: "chill" | "upbeat" | "hype";
  emotion: string;
  lines: AdLinePlan[];
  scenes: AdScenePlan[];
};
export type EditPlan = {
  hook: { text: string; sub?: string } | null;
  accent: string;
  mood: "chill" | "upbeat" | "hype";
  captions: { on: boolean; style: "pop" | "karaoke" | "box" | "tiktok"; pos: "low" | "mid"; maxWords: number };
  overlays: MotionItem[];
  zooms: { at: Cue; to?: Cue; scale?: number }[];
};

export type AdInput = {
  product: string;
  description: string;
  price?: string;
  oldPrice?: string;
  cta?: string;
  handle?: string;
  audience?: string;
  vibe?: string;
  extra?: string;
  language: "ms" | "en";
  seconds: number;
  voice: string;
  speed: number;
  captions: boolean;
  captionStyle: "pop" | "karaoke" | "box" | "tiktok";
  music: boolean;
  sfx: boolean;
  accent?: string;
  images: { url: string; role: "product" | "presenter" }[];
  style?: MotionStyleId;
  resolution?: "1080" | "720";
  /** Variation k of n — the writer takes a different angle per variation. */
  variant?: { index: number; total: number };
  /** "Check Guideline TikTok" — compliant script, tape over risky text on product photos. */
  guard?: boolean;
};

export type EditInput = {
  videoUrl: string;
  durationSec: number;
  language: "ms" | "en" | "auto";
  instructions?: string;
  product?: string;
  /** The seller's own product photos (≤ 5) — every product B-roll shot comes from these. */
  productImages?: string[];
  captions: boolean;
  captionStyle: "pop" | "karaoke" | "box" | "tiktok";
  captionPos: "low" | "mid";
  music: boolean;
  sfx: boolean;
  accent?: string;
  style?: MotionStyleId;
  resolution?: "1080" | "720";
  jumpcut?: boolean;
  broll?: boolean;
  facts?: boolean;
  /** "Check Guideline TikTok" — compliant copy, tape over risky printed text, mute risky words. */
  guard?: boolean;
  /** AI Auto: the director decides angle, look, colour, captions, hook sound and
   *  music from the video itself (style / caption / music / accent fields unused). */
  auto?: boolean;
};

// ── config + Modal client ─────────────────────────────────────────────────────
type MotionCfg = { api_url: string; secret: string };

/** Is Motion's "Buat Iklan" mode switched on for everyone? Admin toggle:
 *  app_settings.motion_features = { ad: boolean } (unset → on). */
export async function motionAdEnabled(): Promise<boolean> {
  const f = await getSetting<any>("motion_features").catch(() => null);
  return f?.ad !== false;
}

// Several Modal workspaces can share the render load (each has its own
// container limit). app_settings.motion_modal = { api_url, secret } is the main
// one; motion_modal.accounts = [{ id, api_url, secret, enabled? }] adds more.
// A job started on an extra account carries it in its task id —
// "<modal call id>@<account id>" — so status checks / settling reach the right
// one; a plain call id = the main account (every job before multi-account).
type MotionAccount = MotionCfg & { id: string };
const MAIN_ACCOUNT = "main";

/** Accounts that take new jobs; `includeDisabled` also returns switched-off
 *  ones, so jobs already running there can still be checked to the end. */
export async function getMotionAccounts(opts: { includeDisabled?: boolean } = {}): Promise<MotionAccount[]> {
  const c = await getSetting<any>("motion_modal");
  const norm = (a: any, id: string): MotionAccount | null => {
    const api_url = String(a?.api_url || "").replace(/\/+$/, "");
    const secret = String(a?.secret || "");
    return api_url && secret ? { id, api_url, secret } : null;
  };
  const main = norm(c, MAIN_ACCOUNT);
  const extra = (Array.isArray(c?.accounts) ? c.accounts : [])
    .filter((a: any) => (opts.includeDisabled || a?.enabled !== false) && /^[a-z0-9-]{1,20}$/.test(String(a?.id || "")) && a.id !== MAIN_ACCOUNT)
    .map((a: any) => norm(a, String(a.id)))
    .filter(Boolean) as MotionAccount[];
  return [...(main ? [main] : []), ...extra];
}

export async function getMotionConfig(): Promise<MotionCfg | null> {
  return (await getMotionAccounts())[0] ?? null;
}

/** "fc-…@acc2" → { callId: "fc-…", account: "acc2" }; a plain id → the main account. */
function splitTaskId(taskId: string): { callId: string; account: string } {
  const at = taskId.lastIndexOf("@");
  return at > 0 ? { callId: taskId.slice(0, at), account: taskId.slice(at + 1) } : { callId: taskId, account: MAIN_ACCOUNT };
}

/** The account with the fewest Motion jobs still running (ties → listed order). */
async function pickMotionAccount(accounts: MotionAccount[]): Promise<MotionAccount> {
  if (accounts.length < 2) return accounts[0];
  const { data } = await createAdminClient()
    .from("history").select("task_id").eq("tab", "motion").eq("status", "pending").not("task_id", "is", null).limit(1000);
  const load = new Map(accounts.map((a) => [a.id, 0]));
  for (const r of data ?? []) {
    const t = String(r.task_id || "");
    if (t.startsWith(MOTION_PLANNING_TASK)) continue;
    const id = splitTaskId(t).account;
    if (load.has(id)) load.set(id, (load.get(id) ?? 0) + 1);
  }
  return [...accounts].sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0];
}

export async function motionStart(payload: Record<string, any>): Promise<{ ok: true; callId: string } | { ok: false; error: string }> {
  const accounts = await getMotionAccounts();
  if (!accounts.length) return { ok: false, error: "Motion renderer not configured (motion_modal)" };
  const first = await pickMotionAccount(accounts);
  // the least-busy account first; if it can't start the job, the others in turn
  let lastErr = "";
  for (const acc of [first, ...accounts.filter((a) => a.id !== first.id)]) {
    try {
      const r = await fetch(`${acc.api_url}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, secret: acc.secret }),
        signal: AbortSignal.timeout(60_000),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.ok && j?.call_id) {
        const callId = String(j.call_id);
        return { ok: true, callId: acc.id === MAIN_ACCOUNT ? callId : `${callId}@${acc.id}` };
      }
      lastErr = j?.error || `Modal HTTP ${r.status}`;
    } catch (e: any) {
      lastErr = `Modal start failed: ${e?.message || "network"}`;
    }
  }
  return { ok: false, error: lastErr };
}

export type MotionCheck =
  | { status: "running"; progress?: { stage?: string; pct?: number } | null }
  | { status: "done"; result: { url?: string; poster_url?: string | null; duration_sec: number; render_sec?: number; draft?: Record<string, any>; [k: string]: any } }
  | { status: "failed"; error: string }
  | { status: "unknown"; error: string };

export async function motionCheck(taskId: string): Promise<MotionCheck> {
  const { callId, account } = splitTaskId(taskId);
  const cfg = (await getMotionAccounts({ includeDisabled: true })).find((a) => a.id === account);
  if (!cfg) return { status: "unknown", error: `Motion renderer account "${account}" not configured` };
  try {
    const u = `${cfg.api_url}/check?call_id=${encodeURIComponent(callId)}&secret=${encodeURIComponent(cfg.secret)}`;
    const r = await fetch(u, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (j?.status === "running") return { status: "running", progress: j.progress ?? null };
    // a finished render (url) or a finished 2-step draft (draft = the state to review)
    if (j?.status === "done" && (j?.result?.url || j?.result?.draft)) return { status: "done", result: j.result };
    if (j?.status === "failed") return { status: "failed", error: String(j.error || "render failed") };
    return { status: "unknown", error: `Modal check HTTP ${r.status}` };
  } catch (e: any) {
    // Network blips must never fail a row — the next poll retries.
    return { status: "unknown", error: e?.message || "network" };
  }
}

/** Signed one-hour URL the browser POSTs the client video to (Modal → B2).
 *  Vercel caps request bodies at 4.5MB, so the file never touches Next. */
export async function signMotionUpload(userId: string, fileName: string, kind: "video" | "image" = "video"): Promise<{ uploadUrl: string; key: string } | null> {
  const cfg = await getMotionConfig();
  if (!cfg) return null;
  const extRaw = (fileName.split(".").pop() || "").toLowerCase();
  // videos → motion-uploads/, product photos → motion-images/ (Modal checks both)
  const ext = kind === "image"
    ? (["jpg", "jpeg", "png", "webp"].includes(extRaw) ? extRaw : "jpg")
    : (["mp4", "mov", "webm", "m4v"].includes(extRaw) ? extRaw : "mp4");
  const folder = kind === "image" ? "motion-images" : "motion-uploads";
  const key = `${folder}/${userId.replace(/[^A-Za-z0-9_-]/g, "")}/${randomUUID().replace(/-/g, "")}.${ext}`;
  const exp = String(Math.floor(Date.now() / 1000) + 3600);
  const sig = createHmac("sha256", cfg.secret).update(`${key}|${exp}`).digest("hex");
  const qs = new URLSearchParams({ key, exp, sig }).toString();
  return { uploadUrl: `${cfg.api_url}/upload?${qs}`, key };
}

export function newPlanToken(): string {
  return randomBytes(24).toString("hex");
}

export function tokenMatches(a: string, b: string): boolean {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://peninglab.com").replace(/\/+$/, "");
}

// ── pricing helpers ───────────────────────────────────────────────────────────
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const costFor = (seconds: number, rate: number) => round2(Math.ceil(Math.max(0, seconds)) * rate);
/** Seconds an ad of the chosen length really runs (speech + overhead). */
export const adEstimateSec = (target: number) => Math.round(target + 2);

// ── LLM helpers ───────────────────────────────────────────────────────────────
export function extractJson(s: string): any {
  const t = String(s || "").replace(/^﻿/, "").replace(/```(?:json)?/gi, "").trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("model returned no JSON");
  const body = t.slice(a, b + 1);
  try {
    return JSON.parse(body);
  } catch {
    // trailing commas are the usual culprit
    return JSON.parse(body.replace(/,\s*([}\]])/g, "$1"));
  }
}

const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const HEX = /^#[0-9a-f]{6}$/i;
const ITEM_TYPES = new Set(["headline", "note", "tag", "stamp", "chip", "tape", "scribble", "price", "check", "emoji", "counter", "bigword", "callout", "arrow", "stars", "cta",
  "circle", "underline", "point", "gif", "confetti"]);
const ZONES = new Set(["top", "middle", "bottom"]);
const TONES = new Set(["yellow", "white", "red", "green", "accent", "dark"]);
const BGS = new Set(["mat", "paper", "dark", "accent", "blur"]);
const ACTS = new Set(["hook", "pain", "reveal", "benefit", "proof", "price", "cta", "end"]);
const MOODS = new Set(["chill", "upbeat", "hype"]);
const TEXT_MAX: Record<string, number> = {
  headline: 34, note: 48, tag: 22, stamp: 16, chip: 30, tape: 30, scribble: 44, price: 14, check: 32, emoji: 8, counter: 12,
  bigword: 16, callout: 44, arrow: 24, stars: 28, cta: 30,
  circle: 18, underline: 22, point: 20, gif: 40, confetti: 20,
};

const AD_CUE = /^[a-z0-9_]+(?:@[^\s#$+-]{1,30}(?:#\d{1,2})?)?(?:\$)?(?:[+-]\d{0,2}(?:\.\d+)?)?$/i;
const EDIT_CUE = /^w\d{1,4}(?:\$)?(?:[+-]\d{0,2}(?:\.\d+)?)?$/i;

function cleanCue(c: unknown, re: RegExp): Cue | undefined {
  if (typeof c === "number" && Number.isFinite(c) && c >= 0) return Math.round(c * 100) / 100;
  if (typeof c !== "string") return undefined;
  const s = c.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  return re.test(s) ? s : undefined;
}

function cleanItem(raw: any, re: RegExp): MotionItem | null {
  if (!raw || typeof raw !== "object") return null;
  const t = String(raw.t || raw.type || "").toLowerCase();
  if (!ITEM_TYPES.has(t)) return null;
  const at = cleanCue(raw.at, re);
  if (at === undefined) return null;
  const text = clean(raw.text, TEXT_MAX[t] ?? 30);
  if (!text && t !== "emoji" && t !== "confetti") return null;
  const it: MotionItem = { t, text: text || (t === "emoji" ? "✨" : ""), at };
  const to = cleanCue(raw.to, re);
  if (to !== undefined) it.to = to;
  if (raw.sub) it.sub = clean(raw.sub, 28);
  it.zone = ZONES.has(raw.zone) ? raw.zone
    : t === "headline" || t === "tag" || t === "callout" || t === "arrow" || t === "underline" ? "top"
    : t === "check" || t === "chip" || t === "cta" || t === "stars" || t === "point" ? "bottom" : "middle";
  if (TONES.has(raw.tone)) it.tone = raw.tone;
  if (raw.mark === "check" || raw.mark === "cross") it.mark = raw.mark;
  return it;
}

/** Shared item cleaner (used by the Edit Video director). */
export const cleanItemPublic = (raw: any, re: RegExp) => cleanItem(raw, re);

// Keep at most `max` items per zone that are on screen at the same time
// (the renderer packs rows, but a crowded zone still reads badly).
function limitPerZone(items: MotionItem[], max: number): MotionItem[] {
  const count: Record<string, number> = {};
  return items.filter((it) => {
    const z = it.zone || "middle";
    count[z] = (count[z] || 0) + 1;
    return count[z] <= max;
  });
}

// ── Buat Iklan: script + scene spec ──────────────────────────────────────────
const AD_SYSTEM = `You are a senior Malaysian performance-ad copywriter AND motion designer. You write short vertical (9:16) video ads for TikTok / Reels / Shopee, voiced by a narrator and animated as a scrapbook-style motion graphic: sticky notes, marker scribbles, tape labels, price tags and stamps that pop in exactly on the spoken word.

Return ONLY one JSON object (no markdown, no comments):
{
  "brand": {"name": string, "tagline": string, "accent": "#RRGGBB"},
  "mood": "chill" | "upbeat" | "hype",
  "emotion": "happy" | "fluent" | "calm" | "surprised",
  "lines": [{"id": "l1", "act": ACT, "text": string, "tts": string, "pause": number}],
  "scenes": [{"id": "s1", "from": CUE, "bg": BG, "hero": {"kind": "product"|"presenter"|"none", "image": int, "side": "L"|"C"|"R"}, "items": [ITEM], "endcard": boolean}]
}
ACT ∈ hook, pain, reveal, benefit, proof, price, cta, end.

SCRIPT
- Total spoken words ≈ WORD_BUDGET (±10%) — that is what fits the requested length. Count them.
- 5–10 lines, each 4–14 words, one idea per line. Order: hook → pain (optional) → reveal → 1–3 benefit lines → proof (ONLY if the brief gives real proof) → price (ONLY if the brief gives a price) → cta → end (short sign-off, 2–5 words, e.g. "<Brand>. <tagline>").
- Language: natural Malaysian Malay (santai, cara orang Malaysia cakap, bukan bahasa Indonesia; a little English mixing is fine). If language is "en", natural Malaysian English.
- "text" = exactly what the captions show (prices/numbers as digits, e.g. "RM19"). "tts" = the same sentence written for the voice: numbers and prices spelled out in words ("sembilan belas ringgit"), abbreviations expanded, no emoji or symbols, same word order.
- The first line must stop the scroll (relatable pain, bold question, surprising claim) — but never a lie.
- NEVER invent facts: no made-up statistics, ratings, reviews, testimonials, certifications (halal, KKM…), discounts, free gifts, delivery promises or prices. Only use what the brief says.
- "pause" = seconds of silence after the line, 0.15–0.6 (longer after the hook and before the cta).

SCENES
- Usually one scene per line (two short lines may share a scene). scenes[0].from = "l1". Keep scenes in time order.
- The LAST scene is the end card: {"id": "end", "from": "<id of the end line>", "endcard": true, "items": []}. It automatically shows the brand name, tagline, price and CTA — don't repeat them as items there.
- bg ∈ mat (green cutting mat — the scrapbook default), paper (cream paper), dark (dark with an accent glow), accent (brand colour), blur (blurred product photo — ONLY when images exist). Vary it, but keep 2–3 consecutive scenes on one bg for rhythm. dark/accent suit the hook and the reveal.
- hero: when product images exist, show the product (kind "product", image = its index) from the reveal onwards and on benefit/price scenes; side "C" normally, "L"/"R" for variety. Use "presenter" only with an image marked presenter. No images → kind "none" everywhere.
- Keeping the same hero on consecutive scenes keeps it on screen without re-animating.

ITEMS — 1 to 3 per scene, at most 2 per zone:
{"t": TYPE, "text": string, "sub"?: string, "at": CUE, "to"?: CUE, "zone": "top"|"middle"|"bottom", "tone"?: TONE, "mark"?: "check"|"cross"}
TYPE:
  headline — punchy slab, ≤ 4 words (zone top)
  note     — sticky note ≤ 6 words; "sub" = a word shown struck through; "mark" check/cross
  tag      — small ribbon ≤ 3 words ("BARU!", "TERLARIS" only if true)
  stamp    — rubber stamp 1–2 words ("JIMAT")
  chip     — pill ≤ 4 words (a feature/benefit)
  tape     — paper tape label ≤ 4 words
  scribble — handwritten reaction ≤ 6 words ("serius sedap!")
  price    — "text" = the price exactly as in the brief, "sub" = the old price if given
  check    — checklist row ≤ 4 words (benefits; "mark": "cross" for the old way / pain)
  emoji    — a single emoji
  counter  — a real number FROM THE BRIEF only ("text": "1,200+", "sub": label)
  bigword  — the 1–2 strongest words of the line, huge, punched in (zone middle, ~1 s)
  callout  — speech bubble ≤ 6 words (a reaction / aside)
  arrow    — hand-drawn arrow pointing down at the product + ≤ 3-word label
  stars    — 5-star rating row ONLY if the brief gives a real rating ("text": "4.9 · 2k terjual")
  cta      — yellow "Tekan beg kuning" pill with a bouncing arrow (zone bottom, on the cta line)
TONE ∈ yellow, white, red, green, accent, dark (optional).
- With a product hero on screen prefer zones top and bottom; middle only for stamp / emoji / price (they may overlap the product).
- On-screen text is SHORT and highlights the key idea — it is NOT a transcript (captions already show every word).

CUES — when an item pops in:
- "l3" = start of line l3's scene; "l3@pekat" = the moment the first word of line l3's TEXT that starts with "pekat" is spoken (the word must really be in that line's "text"; lowercase, first 4+ letters); "l3@pekat#2" = second occurrence; "l3$" = end of the scene; add offsets like "+0.3" or "-0.2".
- Time each item to the word it illustrates. "to" is optional (default: until the scene ends).

Example item: {"t":"price","text":"RM19","sub":"RM29","at":"l5@rm19","zone":"middle"}

${MOTION_MY_TIKTOK_GUIDE}`;

export async function planAd(input: AdInput): Promise<AdPlan> {
  const speakSec = Math.max(8, input.seconds - AD_OVERHEAD_SEC);
  const budget = Math.round(speakSec * WORDS_PER_SEC);
  const brief = {
    product: input.product,
    description: input.description,
    price: input.price || null,
    old_price: input.oldPrice || null,
    cta: input.cta || null,
    audience: input.audience || null,
    vibe: input.vibe || null,
    extra_instructions: input.extra || null,
    language: input.language,
    target_seconds: input.seconds,
    word_budget: budget,
    images: input.images.map((im, i) => ({ index: i, role: im.role })),
  };
  const userPrompt = `BRIEF (JSON):\n${JSON.stringify(brief, null, 1)}\n\nWORD_BUDGET = ${budget}. Write the ad now. JSON only.`;
  const look = motionStyle(input.style);
  const angles = ["pain-point hook (relatable problem first)", "bold benefit / result hook", "curiosity question hook", "price / promo-first hook", "POV / storytelling hook"];
  const variantNote = input.variant && input.variant.total > 1
    ? `\n\nVARIATION ${input.variant.index + 1} of ${input.variant.total}: use a ${angles[input.variant.index % angles.length]} and a different structure/wording than other variations.`
    : "";
  const styleNote = `\n\nSTYLE = ${look.label.toUpperCase()}: ${look.ad} Colour palette: ${look.palette}.`;
  const guardNote = input.guard ? `\n\n${GUARD_RULES}\nThe "tts" voice-over follows the same rules. Use the brand name without medical words.` : "";
  const system = AD_SYSTEM.replace("WORD_BUDGET", String(budget)) + styleNote + variantNote + guardNote;

  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await orChat({
      modelKey: "model_motion",
      systemPrompt: system,
      userPrompt: attempt === 0 ? userPrompt : `${userPrompt}\n\nYour previous answer was not valid JSON for the schema (${lastErr}). Return ONLY the JSON object.`,
      temperature: input.variant && input.variant.total > 1 ? 0.95 : 0.8,
      maxTokens: 6000,
      timeoutMs: 120_000,
      stream: true,
    });
    if (!r.ok || !r.content) { lastErr = r.error || "empty"; continue; }
    let plan: AdPlan;
    try {
      plan = validateAdPlan(extractJson(r.content), input);
    } catch (e: any) {
      lastErr = e?.message || "invalid";
      continue;
    }
    if (input.guard) await guardAdPlan(plan, input).catch(() => undefined);
    return plan;
  }
  throw new Error(`Script generation failed: ${lastErr}`);
}

/** TikTok guard safety net on the written ad: anything that still hits a
 *  rule is rewritten in one LLM call; what can't be saved loses the phrase
 *  (lines) or is dropped (stickers). The brand loses its medical words. */
async function guardAdPlan(plan: AdPlan, input: AdInput): Promise<void> {
  const name = guardStripQuery(plan.brand.name);
  if (name && name !== plan.brand.name) plan.brand.name = name;
  const slots: { text: string; set: (v: string | null) => void }[] = [];
  const brand = plan.brand;
  if (brand.tagline) slots.push({ text: brand.tagline, set: (v) => { brand.tagline = v ?? undefined; } });
  for (const l of plan.lines) {
    slots.push({ text: l.text, set: (v) => { l.text = v ?? guardStripQuery(l.text); } });
    slots.push({ text: l.tts, set: (v) => { l.tts = v ?? guardStripQuery(l.tts); } });
  }
  for (const sc of plan.scenes) {
    for (const it of sc.items) {
      if (it.text) slots.push({ text: it.text, set: (v) => { it.text = v ?? ""; } });
      if (it.sub) slots.push({ text: it.sub, set: (v) => { it.sub = v ?? undefined; } });
    }
  }
  await guardFixSlots(slots, input.product);
  for (const sc of plan.scenes) sc.items = sc.items.filter((it) => it.t === "emoji" || (!!it.text && guardHits(it.text).length === 0));
  for (const l of plan.lines) if (!l.tts.trim()) l.tts = l.text;
}

export function validateAdPlan(raw: any, input: AdInput): AdPlan {
  const ids = new Set<string>();
  const lines: AdLinePlan[] = [];
  for (const l of Array.isArray(raw?.lines) ? raw.lines : []) {
    let id = String(l?.id || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!id || ids.has(id)) id = `l${lines.length + 1}`;
    const text = clean(l?.text, 170);
    if (!text) continue;
    ids.add(id);
    const pause = Number(l?.pause);
    lines.push({
      id,
      act: ACTS.has(l?.act) ? l.act : "benefit",
      text,
      tts: clean(l?.tts || l?.text, 260).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ""),
      pause: Number.isFinite(pause) ? Math.min(0.8, Math.max(0.1, pause)) : 0.25,
    });
    if (lines.length >= 14) break;
  }
  if (lines.length < 2) throw new Error("script has fewer than 2 lines");
  const nImg = input.images.length;
  const presenterIdx = input.images.findIndex((im) => im.role === "presenter");

  const scenes: AdScenePlan[] = [];
  for (const s of Array.isArray(raw?.scenes) ? raw.scenes : []) {
    if (scenes.length >= 16) break;
    const endcard = !!s?.endcard;
    const from = cleanCue(s?.from, AD_CUE) ?? (scenes.length === 0 ? lines[0].id : undefined);
    if (from === undefined) continue;
    const sc: AdScenePlan = { id: `s${scenes.length + 1}`, from, items: [] };
    if (endcard) { sc.endcard = true; scenes.push(sc); continue; }
    sc.bg = BGS.has(s?.bg) && !(s.bg === "blur" && nImg === 0) ? s.bg : "mat";
    const h = s?.hero;
    if (h && (h.kind === "product" || h.kind === "presenter") && nImg > 0) {
      let image = Math.min(nImg - 1, Math.max(0, Number(h.image) || 0));
      if (h.kind === "presenter" && presenterIdx >= 0) image = presenterIdx;
      sc.hero = { kind: h.kind === "presenter" && presenterIdx < 0 ? "product" : h.kind, image, side: h.side === "L" || h.side === "R" ? h.side : "C" };
    } else sc.hero = { kind: "none" };
    const items = (Array.isArray(s?.items) ? s.items : []).map((it: any) => cleanItem(it, AD_CUE)).filter(Boolean) as MotionItem[];
    // Never show a price the brief didn't give. With a product on screen the
    // big price goes to the top zone so it doesn't cover the product.
    const heroShown = sc.hero.kind !== "none";
    sc.items = limitPerZone(items
      .filter((it) => it.t !== "price" || !!input.price)
      .map((it) => (heroShown && it.t === "price" && it.zone === "middle" ? { ...it, zone: "top" as const } : it)), 2).slice(0, 4);
    scenes.push(sc);
  }
  if (scenes.length === 0) scenes.push({ id: "s1", from: lines[0].id, bg: "mat", hero: { kind: nImg ? "product" : "none", image: 0, side: "C" }, items: [] });
  scenes[0].from = lines[0].id;

  // Exactly one end card, last.
  const endIdx = scenes.findIndex((s) => s.endcard);
  const endLine = [...lines].reverse().find((l) => l.act === "end");
  const endScene: AdScenePlan = { id: "end", from: endIdx >= 0 ? scenes[endIdx].from : endLine ? endLine.id : `${lines[lines.length - 1].id}$-2.2`, endcard: true, items: [] };
  const body = scenes.filter((s) => !s.endcard);
  if (body.length === 0) body.push({ id: "s1", from: lines[0].id, bg: "dark", hero: { kind: "none" }, items: [] });

  const accent = HEX.test(input.accent || "") ? input.accent! : HEX.test(raw?.brand?.accent) ? raw.brand.accent : "#22c55e";
  return {
    brand: {
      name: clean(input.product || raw?.brand?.name, 40),
      tagline: clean(raw?.brand?.tagline, 60) || undefined,
      // Commercial facts come from the client's brief, never from the model.
      price: clean(input.price, 14) || undefined,
      oldPrice: clean(input.oldPrice, 14) || undefined,
      cta: clean(input.cta, 40) || undefined,
      handle: clean(input.handle, 40) || undefined,
      accent,
    },
    mood: MOODS.has(raw?.mood) ? raw.mood : "upbeat",
    emotion: ["happy", "fluent", "calm", "surprised"].includes(raw?.emotion) ? raw.emotion : "happy",
    lines,
    scenes: [...body, endScene],
  };
}

// ── Edit Video: caption + overlay plan ───────────────────────────────────────
const EDIT_SYSTEM = `You are a TikTok video editor for Malaysian sellers and creators. You get the timed transcript of the client's own video and plan motion-graphic overlays that make it clearer and more engaging: an opening hook headline, word-synced stickers / labels / ticks / prices, and punch-in zooms. Animated captions are added automatically — don't plan them.

Return ONLY one JSON object (no markdown):
{
  "hook": {"text": string, "sub"?: string} | null,
  "accent": "#RRGGBB",
  "mood": "chill" | "upbeat" | "hype",
  "overlays": [ITEM],
  "zooms": [{"at": CUE, "to": CUE, "scale": number}]
}
ITEM = {"t": TYPE, "text": string, "sub"?: string, "at": CUE, "to"?: CUE, "zone": "top"|"middle"|"bottom", "tone"?: TONE, "mark"?: "check"|"cross"}
TYPE:
  headline — punchy slab ≤ 4 words (top)
  note     — sticky note ≤ 6 words ("sub" = a struck-through word; "mark" check/cross)
  tag      — ribbon ≤ 3 words
  stamp    — 1–2 word stamp
  chip     — pill ≤ 4 words (a feature / benefit)
  tape     — paper label ≤ 4 words
  scribble — handwritten reaction ≤ 6 words
  price    — a price that is SPOKEN in the video ("sub" = old price if spoken)
  check    — checklist row ≤ 4 words (benefits; "mark": "cross" for the old way)
  emoji    — one emoji
  counter  — a number that is SPOKEN ("text": "3", "sub": short label)
TONE ∈ yellow, white, red, green, accent, dark.
CUE: "w12" = when transcript word #12 starts, "w12$" = when it ends, offsets like "w12+0.2"; or plain seconds.

Rules:
- Density: about one overlay every 4–6 seconds; never more than 2 on screen at once; nothing in the last 0.5 s. Each overlay normally lasts 1.5–3 s ("to").
- Place each overlay on the word it emphasises: product names, numbers and prices that are said, key benefits, emotions, the call to action. On-screen text is ≤ 5 words, in the video's language, and is NOT a transcript.
- Zones: top for headlines / tags / tape; bottom for chips / checks (they sit just above the captions); middle only for short emoji / stamp / price (don't cover the speaker's face for long).
- Zooms: one every 5–8 s on emphasis moments, 0.8–2 s long, scale 1.08–1.2. None during the hook.
- Hook: the video's promise in ≤ 5 punchy words (+ optional ≤ 5-word sub); null if the video is shorter than 5 s.
- Never invent facts, prices, claims or numbers that are not in the transcript or the client's notes.
- The client's extra instructions override these style rules (never the no-invented-facts rule).`;

export async function planEdit(opts: {
  words: { i: number; w: string; t: number; e?: number }[];
  duration: number;
  input: EditInput;
}): Promise<EditPlan> {
  const { words, duration, input } = opts;
  const transcript = words.slice(0, 1400).map((w) => `${w.i}@${w.t.toFixed(2)} ${w.w}`).join("\n");
  const userPrompt =
    `VIDEO: ${duration.toFixed(1)} s, ${words.length} words, language ${input.language}.\n` +
    (input.product ? `PRODUCT / CONTEXT: ${clean(input.product, 300)}\n` : "") +
    (input.instructions ? `CLIENT INSTRUCTIONS: ${clean(input.instructions, 600)}\n` : "") +
    (input.accent ? `PREFERRED ACCENT: ${input.accent}\n` : "") +
    `\nTRANSCRIPT (index@seconds word):\n${transcript || "(no speech detected)"}\n\nPlan the overlays now. JSON only.`;

  let raw: any = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 2 && !raw; attempt++) {
    const r = await orChat({
      modelKey: "model_motion",
      systemPrompt: EDIT_SYSTEM,
      userPrompt: attempt === 0 ? userPrompt : `${userPrompt}\n\nYour previous answer was not valid JSON (${lastErr}). Return ONLY the JSON object.`,
      temperature: 0.6,
      maxTokens: 5000,
    });
    if (!r.ok || !r.content) { lastErr = r.error || "empty"; continue; }
    try { raw = extractJson(r.content); } catch (e: any) { lastErr = e?.message || "invalid"; }
  }
  if (!raw) throw new Error(`Overlay plan failed: ${lastErr}`);
  return validateEditPlan(raw, words.length, duration, input);
}

export function validateEditPlan(raw: any, nWords: number, duration: number, input: EditInput): EditPlan {
  const inRange = (c: Cue | undefined) => {
    if (c === undefined) return false;
    if (typeof c === "number") return c >= 0 && c < duration - 0.4;
    const m = /^w(\d+)/i.exec(c);
    return !!m && Number(m[1]) < nWords;
  };
  const maxOverlays = Math.max(2, Math.ceil(duration / 3));
  const overlays = (Array.isArray(raw?.overlays) ? raw.overlays : [])
    .map((it: any) => cleanItem(it, EDIT_CUE))
    .filter((it: MotionItem | null): it is MotionItem => !!it && inRange(it.at))
    .map((it: MotionItem) => (it.to !== undefined && !inRange(it.to) ? { ...it, to: undefined } : it))
    .slice(0, maxOverlays);
  const zooms = (Array.isArray(raw?.zooms) ? raw.zooms : [])
    .map((z: any) => {
      const at = cleanCue(z?.at, EDIT_CUE);
      if (!inRange(at)) return null;
      const to = cleanCue(z?.to, EDIT_CUE);
      const scale = Math.min(1.25, Math.max(1.05, Number(z?.scale) || 1.12));
      return { at: at!, ...(inRange(to) ? { to } : {}), scale };
    })
    .filter(Boolean)
    .slice(0, Math.max(1, Math.ceil(duration / 4))) as EditPlan["zooms"];
  const hookText = clean(raw?.hook?.text, 40);
  const accent = HEX.test(input.accent || "") ? input.accent! : HEX.test(raw?.accent) ? raw.accent : "#FFD93B";
  return {
    hook: hookText && duration >= 5 ? { text: hookText, ...(raw?.hook?.sub ? { sub: clean(raw.hook.sub, 40) } : {}) } : null,
    accent,
    mood: MOODS.has(raw?.mood) ? raw.mood : "chill",
    captions: {
      on: input.captions,
      style: input.captionStyle,
      pos: input.captionPos,
      maxWords: input.captionStyle === "karaoke" ? 4 : 3,
    },
    overlays,
    zooms,
  };
}

// ── Buat Iklan pipeline (runs in the create route's after()) ─────────────────
async function patchMeta(historyId: string, patch: Record<string, any>, extra: Record<string, any> = {}) {
  const admin = createAdminClient();
  const { data } = await admin.from("history").select("metadata").eq("id", historyId).maybeSingle();
  await admin.from("history").update({ ...extra, metadata: { ...(data?.metadata || {}), ...patch } }).eq("id", historyId);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

export async function runAdJob(historyId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: row } = await admin.from("history").select("id, user_id, status, metadata").eq("id", historyId).maybeSingle();
  if (!row || row.status !== "pending") return;
  const input = row.metadata?.input as AdInput;
  try {
    await patchMeta(historyId, { stage: "script" });
    const [plan, risk] = await Promise.all([
      planAd(input),
      input.guard
        ? guardProductRisk(`${input.product}\n${input.description}${input.extra ? `\n${input.extra}` : ""}`).catch(() => null)
        : Promise.resolve(null),
    ]);
    await patchMeta(historyId, {
      stage: "voice",
      plan: { brand: plan.brand, mood: plan.mood, lines: plan.lines.map((l) => ({ id: l.id, act: l.act, text: l.text })) },
      ...(input.guard ? { guard: { risk } } : {}),
    }, { prompt: plan.lines.map((l) => l.text).join(" ").slice(0, 2000) });

    const audio = await mapLimit(plan.lines, 4, async (l) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await synthesizeSpeech({
          text: l.tts, voice: input.voice, emotion: plan.emotion, speed: input.speed,
          language: input.language, keyPrefix: `motion-tts/${row.user_id}`,
        });
        if (r.ok) return r.audioUrl;
        if (attempt === 1) throw new Error(`Voice failed on "${l.text.slice(0, 40)}": ${r.error}`);
      }
      return "";
    });

    const start = await motionStart({
      flow: "ad",
      history_id: historyId,
      user_id: row.user_id,
      language: input.language,
      lines: plan.lines.map((l, i) => ({ id: l.id, act: l.act, text: l.text, pause: l.pause, audio_url: audio[i] })),
      scenes: plan.scenes,
      brand: plan.brand,
      images: input.images.map((im) => ({ url: im.url, cutout: true })),
      captions: input.captions,
      caption_style: input.captionStyle,
      sfx: input.sfx,
      music: input.music,
      mood: plan.mood,
      style: styleEnergy(input.style), // render energy of the chosen look
      look: motionStyle(input.style).id,
      resolution: input.resolution ?? "1080",
      guard: !!input.guard,
      ...(input.guard && row.metadata?.plan_token
        ? { guard_url: `${siteUrl()}/api/motion/guard`, plan_token: row.metadata.plan_token }
        : {}),
    });
    if (!start.ok) throw new Error(start.error);
    await patchMeta(historyId, { stage: "queued", provider: "modal-motion", call_started_at: new Date().toISOString() }, { task_id: start.callId });
  } catch (e: any) {
    await failMotionRow({ ...row, task_id: null } as any, e?.message || "Motion pipeline error");
  }
}

// ── settle ────────────────────────────────────────────────────────────────────
export async function failMotionRow(hist: Pick<HistoryRow, "id" | "user_id" | "metadata">, error: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: cur } = await admin.from("history").select("metadata").eq("id", hist.id).maybeSingle();
  const meta = cur?.metadata || hist.metadata || {};
  // A failed free re-render puts the card back to the video it had before.
  const prev = meta.resubmit_prev;
  if (prev?.output_url) {
    const { resubmit_prev: _drop, ...rest } = meta;
    void _drop;
    const { data: restored } = await admin
      .from("history")
      .update({
        status: "done", output_url: prev.output_url, thumbnail_url: prev.output_url, cost: Number(prev.cost) || 0,
        error_message: null,
        metadata: { ...rest, ...(prev.metadata || {}), stage: "done", resubmit_error: String(error).slice(0, 300) },
      })
      .eq("id", hist.id)
      .eq("status", "pending")
      .select("id");
    if (!restored?.length) return false;
    // a paid re-render gives back what it held
    const held = Number(meta.reserved) || 0;
    if (held > 0) await refundReserved(hist.user_id, "motion", held, hist.id);
    return true;
  }
  const { data: flipped } = await admin
    .from("history")
    .update({ status: "failed", error_message: String(error).slice(0, 500), cost: 0, metadata: { ...meta, stage: "failed" } })
    .eq("id", hist.id)
    .eq("status", "pending")
    .select("id");
  if (!flipped?.length) return false; // someone else already settled it
  const reserved = Number(meta.reserved) || 0;
  if (reserved > 0) await refundReserved(hist.user_id, "motion", reserved, hist.id);
  return true;
}

export async function settleMotionRow(hist: HistoryRow, pre?: MotionCheck): Promise<SettleResult> {
  if (hist.status !== "pending") return { state: "skipped", reason: "already settled" };
  const meta = hist.metadata || {};
  // a resubmitted / reviewed-then-rendered job times out from its new start
  const createdMs = new Date(meta.render_started_at || meta.resubmit_started_at || (hist as any).created_at || meta.created_at || Date.now()).getTime();

  // "motion:planning" = Buat Iklan row still in script/voice (stamped at insert
  // so the poll-pending cron, which only scans rows with a task_id, still
  // reaches it and can expire it).
  if (!hist.task_id || hist.task_id.startsWith(MOTION_PLANNING_TASK)) {
    if (Date.now() - createdMs > PLANNING_STALE_MS) {
      await failMotionRow(hist, "Motion: script/voice step timed out — credit refunded. Please try again.");
      return { state: "settled", status: "failed", error: "planning timed out" };
    }
    return { state: "pending", p2Status: String(meta.stage || "planning") };
  }

  const r = pre ?? (await motionCheck(hist.task_id));
  if (r.status === "running" || r.status === "unknown") {
    if (Date.now() - createdMs > RENDER_STALE_MS) {
      await failMotionRow(hist, "Motion: render timed out — credit refunded.");
      return { state: "settled", status: "failed", error: "render timed out" };
    }
    return { state: "pending", p2Status: r.status === "running" ? String(r.progress?.stage || "render") : "unknown" };
  }
  if (r.status === "failed") {
    await failMotionRow(hist, `Motion render failed: ${r.error}`.slice(0, 500));
    return { state: "settled", status: "failed", error: r.error };
  }

  const res = r.result;
  const admin = createAdminClient();

  // 2-step flow, step 1 finished: the script / captions wait for the client's
  // review. Nothing is charged yet — the credit stays held until the render.
  if (res.draft && !res.url) {
    const { data: drafted } = await admin
      .from("history")
      .update({
        status: "review",
        task_id: null,
        error_message: null,
        metadata: { ...meta, stage: "review", draft: res.draft, review_at: new Date().toISOString() },
      })
      .eq("id", hist.id)
      .eq("status", "pending")
      .select("id");
    if (!drafted?.length) return { state: "skipped", reason: "settled concurrently" };
    return { state: "settled", status: "review" };
  }

  const dur = Number(res.duration_sec) || 0;
  const rate = Number(meta.rate) || 0;
  const finalCost = costFor(dur, rate);
  // a free re-render (resubmit) keeps showing what the client paid the first time
  const paidBefore = Number(meta.resubmit_prev?.cost) || 0;
  const { data: flipped } = await admin
    .from("history")
    .update({
      status: "done",
      output_url: res.url,
      thumbnail_url: res.url,
      cost: round2(finalCost + paidBefore),
      duration: Math.round(dur),
      error_message: null,
      metadata: {
        ...meta,
        stage: "done",
        poster_url: res.poster_url || meta.poster_url || null,
        render: { duration_sec: dur, render_sec: res.render_sec ?? null, plan_fallback: !!res.plan_fallback },
        ...(res.guard || meta.guard ? { guard: { ...(meta.guard || {}), ...(res.guard || {}) } } : {}),
        settled_at: new Date().toISOString(),
      },
    })
    .eq("id", hist.id)
    .eq("status", "pending")
    .select("id");
  if (!flipped?.length) return { state: "skipped", reason: "settled concurrently" };

  // True-up the reserved estimate to the real length.
  const diff = round2(finalCost - (Number(meta.reserved) || 0));
  if (diff >= 0.01) await deduct(hist.user_id, "motion", diff, hist.id);
  else if (diff <= -0.01) await refundReserved(hist.user_id, "motion", -diff, hist.id);
  return { state: "settled", status: "done", outputUrl: res.url };
}
