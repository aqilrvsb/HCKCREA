// Motion Edit Video — 2-step flow ("Jana Skrip & Caption" → review → "Jana
// Video"). Step 1 only transcribes and stores a draft: the words on the
// jump-cut timeline (captions, already spelling-fixed). The client reads /
// edits the caption lines; step 2 cuts the video, the AI plans the edit on
// those words and renders. (Older drafts also carry the plan, so their hook,
// on-screen texts, re-hook and CTA are editable too.) Pure helpers shared by
// the review box (client) and /api/motion/render (server), so both see the
// same caption lines.

export type DraftWord = { w: string; t: number; e?: number; ri?: number };
/** The director's plan as stored (free-form JSON from the AI, validated upstream). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DraftPlan = Record<string, any>;
export type CaptionLine = { start: number; end: number; from: number; to: number; text: string };

/** The draft's words grouped into readable caption lines: a new line after a
 *  pause, a sentence end or 10 words. `from` / `to` = word indices (to exclusive). */
export function captionLines(words: DraftWord[]): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const end = Number(w.e ?? w.t + 0.3);
    const gap = next ? Number(next.t) - end : Infinity;
    if (!next || gap > 0.6 || /[.?!]$/.test(w.w) || i + 1 - from >= 10) {
      lines.push({ start: Number(words[from].t), end, from, to: i + 1, text: words.slice(from, i + 1).map((x) => x.w).join(" ") });
      from = i + 1;
    }
  }
  return lines;
}

const CUE = /^w(\d{1,4})(\$)?([+-]\d*(?:\.\d+)?)?$/i;

/** A plan cue ("w12", "w12$", "w12+0.3" or seconds) → seconds on the draft's words. */
export function cueSeconds(c: unknown, words: DraftWord[]): number | undefined {
  if (typeof c === "number" && Number.isFinite(c)) return c;
  const s = String(c ?? "").trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = CUE.exec(s);
  if (!m) return undefined;
  const w = words[Number(m[1])];
  if (!w) return undefined;
  const base = m[2] ? Number(w.e ?? w.t + 0.3) : Number(w.t);
  const off = m[3] && m[3] !== "+" && m[3] !== "-" ? parseFloat(m[3]) : 0;
  return Math.max(0, Math.round((base + off) * 100) / 100);
}

type Timed = { at?: unknown; to?: unknown };
const timed = <T extends Timed>(x: T, words: DraftWord[]): T => {
  const at = cueSeconds(x.at, words);
  const to = cueSeconds(x.to, words);
  return { ...x, ...(at !== undefined ? { at } : {}), ...(to !== undefined ? { to } : { to: undefined }) };
};

/** Overlay types whose text a client reads on screen (and may correct). */
export const EDITABLE_OVERLAY = new Set([
  "headline", "tag", "stamp", "chip", "tape", "scribble", "note", "check", "bigword", "callout", "arrow", "point",
  "circle", "underline", "counter", "price", "cta",
]);

export type DraftEdits = {
  /** caption line index → corrected text */
  lines?: Record<string, string>;
  hook?: { text?: string; sub?: string };
  rehook?: string;
  cta?: { text?: string; sub?: string };
  /** overlay index → corrected text / sub */
  overlays?: Record<string, { text?: string; sub?: string }>;
  /** the client's own headline overlays: slot i (over, split, pip, split) — words and / or their B-roll */
  headlines?: { i: number; lead?: string; big?: string; box?: string; url?: string; video?: boolean }[];
};

const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The reviewed words + plan for the render. Every plan cue is turned into
 *  seconds first (on the ORIGINAL words), so edited lines with more or fewer
 *  words never move a sticker; an edited line's words share its time span. */
export function applyDraftEdits(draft: { words: DraftWord[]; plan: DraftPlan }, edits: DraftEdits): { words: DraftWord[]; plan: DraftPlan } {
  const words = draft.words || [];
  const p = draft.plan || {};
  const plan: DraftPlan = {
    ...p,
    overlays: (p.overlays || []).map((o: Timed) => timed(o, words)),
    zooms: (p.zooms || []).map((z: Timed) => timed(z, words)),
    broll: (p.broll || []).map((b: Timed) => timed(b, words)),
    facts: (p.facts || []).map((f: Timed) => timed(f, words)),
    ...(p.rehook ? { rehook: timed(p.rehook, words) } : {}),
    ...(p.cta ? { cta: timed(p.cta, words) } : {}),
    ...(p.hook ? { hook: { ...p.hook, ...(p.hook.to !== undefined ? { to: cueSeconds(p.hook.to, words) } : {}) } } : {}),
  };

  // captions: rebuild the word list line by line
  const lines = captionLines(words);
  const out: DraftWord[] = [];
  const newIndex = new Map<number, number>(); // old word index → new (unchanged lines only)
  lines.forEach((ln, k) => {
    const edited = edits.lines?.[String(k)];
    const text = edited === undefined ? undefined : clean(edited, 400);
    if (text === undefined || text === ln.text) {
      for (let i = ln.from; i < ln.to; i++) { newIndex.set(i, out.length); out.push({ ...words[i] }); }
      return;
    }
    const toks = text.split(" ").filter(Boolean);
    if (!toks.length) return; // line cleared → its captions disappear (the audio stays)
    const span = Math.max(0.2, ln.end - ln.start);
    toks.forEach((w, j) => {
      const t = ln.start + (span * j) / toks.length;
      out.push({ w, t: Math.round(t * 100) / 100, e: Math.round((ln.start + (span * (j + 1)) / toks.length) * 100) / 100 });
    });
  });
  // coloured keywords follow their word; those inside an edited line are dropped
  plan.keywords = (p.keywords || [])
    .map((kw: { i: number }) => (newIndex.has(kw.i) ? { ...kw, i: newIndex.get(kw.i) } : null))
    .filter(Boolean);
  delete plan.censor;
  delete plan.fixes; // already in the words

  // on-screen texts
  if (plan.hook && edits.hook) {
    const text = clean(edits.hook.text ?? plan.hook.text, 60);
    plan.hook = text ? { ...plan.hook, text, sub: clean(edits.hook.sub ?? plan.hook.sub, 60) || undefined } : null;
  }
  if (plan.rehook && edits.rehook !== undefined) {
    const text = clean(edits.rehook, 40);
    if (text) plan.rehook = { ...plan.rehook, text }; else delete plan.rehook;
  }
  if (plan.cta && edits.cta) {
    const text = clean(edits.cta.text ?? plan.cta.text, 40);
    if (text) plan.cta = { ...plan.cta, text, sub: clean(edits.cta.sub ?? plan.cta.sub, 50) || undefined }; else delete plan.cta;
  }
  if (edits.overlays) {
    plan.overlays = plan.overlays
      .map((o: DraftPlan, k: number) => {
        const e = edits.overlays?.[String(k)];
        if (!e || !EDITABLE_OVERLAY.has(o.t)) return o;
        const text = clean(e.text ?? o.text, 80);
        if (!text) return null; // cleared → sticker removed
        return { ...o, text, ...(e.sub !== undefined ? { sub: clean(e.sub, 60) || undefined } : {}) };
      })
      .filter(Boolean);
  }
  return { words: out, plan };
}
