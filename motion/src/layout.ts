// Face-aware sticker placement for Edit Video.
//
// The zone stack (lib.ts packRows) keeps every row of a zone alive for the
// whole video, so once three stickers overlapped, every later sticker in that
// zone sat two rows lower — right over the speaker's eyes. Here each sticker
// gets ONE fixed slot (y + scale) for its lifetime, chosen when it appears:
//   free space = safe frame − speaker's face during its window (from the face
//   track, padded for the punch-in zooms in that window) − captions − hook −
//   PiP card − stickers already on screen at the same time.
// "top" stickers take the highest free gap, "bottom" ones sit just above the
// captions, "middle" ones the roomiest gap. When nothing fits, a sticker
// shrinks (never below 60 %), then may sit over the mouth / chin. It never
// covers the eyes and never overlaps another sticker: with no room left at
// all it is skipped (no slot — the caller drops it).
//
// Sizes are measured, not guessed: each sticker's text is wrapped with the
// real font widths (fontMetrics.ts — identical in the Node planner, which picks
// the sound effects and GIFs, and in the browser), and the box reserves room for its tilt and the
// idle "breathe" motion, so a tilted stamp or a headline that wraps to an
// extra line can't spill onto the face or the next sticker.
import { F, SAFE_X, W, fitSize, tilt, type Placed } from './lib';
import { tableWidth } from './fontMetrics';
import type { Face, Item, Zone } from './types';

export type Slot = { y: number; scale: number };
type Span = { a: number; b: number };

const TOP_SAFE = 170; // below the progress bar / TikTok top bar
const BOTTOM_SAFE = 1610; // above TikTok's caption + product-link area
const GAP = 18;
const MAXW = W - SAFE_X * 2;
const MIN_SCALE = 0.6;

// ── real text widths (measured font tables, fontMetrics.ts) ─────────────────────────
type Font = { family: string; weight: number; charW: number; track?: number };
const FONT = {
  black: { family: F.black, weight: 400, charW: 0.68 },
  hand: { family: F.hand, weight: 400, charW: 0.48 },
  marker: { family: F.marker, weight: 400, charW: 0.56 },
  inter9: { family: F.inter, weight: 900, charW: 0.55 },
  inter8: { family: F.inter, weight: 800, charW: 0.58 },
} satisfies Record<string, Font>;

const widths = new Map<string, number>();

/** Width of `text` at 100 px in its real font (fontMetrics.ts — the same in the Node planner and the browser), or null for an unknown face. */
function w100(text: string, f: Font): number | null {
  const key = `${f.family}|${f.weight}|${text}`;
  const hit = widths.get(key);
  if (hit !== undefined) return hit;
  const w = tableWidth(text, f.family, f.weight, 100);
  if (w !== null) widths.set(key, w);
  return w;
}

/** Rendered width (px) of one line at `size`, +2 % margin; the charW guess when it can't be measured. */
const textW = (text: string, f: Font, size: number) =>
  (((w100(text, f) ?? text.length * f.charW * 112) * size) / 100 + Math.max(0, text.length - 1) * (f.track ?? 0)) * 1.02;

/** How the browser wraps `text` in a `width` px box (greedy, by words): line count and widest line. */
function wrap(text: string, f: Font, size: number, width: number): { n: number; w: number } {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { n: 1, w: 0 };
  let n = 1;
  let line = '';
  let widest = 0;
  for (const word of words) {
    const cand = line ? `${line} ${word}` : word;
    if (line && textW(cand, f, size) > width) {
      widest = Math.max(widest, textW(line, f, size));
      n++;
      line = word;
    } else line = cand;
  }
  return { n, w: Math.max(widest, textW(line, f, size)) }; // > width when one word is longer than the box
}

type Box = { h: number; w: number; tilt: number };

/** Rendered box (px, before slot scale) of a sticker — mirrors elements.tsx — and its resting tilt (deg). */
function box(it: Item, i: number): Box {
  const t = it.text ?? '';
  switch (it.t) {
    case 'headline': {
      const s = fitSize(t, 108, MAXW - 70, 2, 0.68);
      const r = wrap(t, { ...FONT.black, track: -1 }, s, MAXW - s * 0.52);
      return { h: r.n * s * 1.06 + s * 0.16 + 12, w: r.w + s * 0.52, tilt: tilt(i) };
    }
    case 'note': {
      const w = Math.min(MAXW, Math.max(360, Math.min(600, 250 + t.length * 9)));
      const s = fitSize(t, 62, w - 44, 4, 0.48);
      const r = wrap(t, FONT.hand, s, w - 44);
      const sub = it.sub ? wrap(it.sub, FONT.hand, s * 1.2, w - 44).n * s * 1.26 + 6 : 0;
      return { h: Math.max(w * 0.62, r.n * s * 1.05 + 48 + sub) + 26, w, tilt: tilt(i, 3) + 0.5 };
    }
    case 'tag': { const s = fitSize(t, 58, MAXW - 60, 1, 0.66); return { h: s * 1.2 + 14, w: textW(t, { ...FONT.black, track: 1 }, s) + 44, tilt: tilt(i, 5) - 2 }; }
    case 'stamp': { const s = fitSize(t, 124, MAXW - 120, 1, 0.72); return { h: s * 1.15 + 30, w: textW(t, { ...FONT.black, track: 2 }, s) + 80, tilt: tilt(i, 4) - 6 }; }
    case 'chip': { const s = fitSize(t, 54, MAXW - 120, 1, 0.58); return { h: s * 1.2 + 30, w: textW(t, FONT.inter8, s) + 74 + s * 0.38, tilt: tilt(i, 1.5) }; }
    case 'tape': { const s = fitSize(t, 50, MAXW - 80, 1, 0.6); return { h: s * 1.3 + 14, w: textW(t, FONT.marker, s) + 52, tilt: tilt(i, 2.5) }; }
    case 'scribble': {
      const s = fitSize(t, 66, MAXW - 40, 2, 0.56);
      const r = wrap(t, { ...FONT.marker, track: 1 }, s, MAXW);
      return { h: r.n * s * 1.12 + 10, w: r.w, tilt: tilt(i, 2) - 1 };
    }
    case 'price': {
      const s = fitSize(t, 176, MAXW - 80, 1, 0.66);
      return { h: s * 1.2 + (it.sub ? s * 0.45 + 6 : 0) + 10, w: textW(t, FONT.black, s) + s * 0.44, tilt: 3 };
    }
    case 'check': {
      const s = fitSize(t, 62, MAXW - 130, 2, 0.55);
      const r = wrap(t, { ...FONT.inter9, track: -0.5 }, s, MAXW - s * 1.25 - 22);
      return { h: Math.max(s * 1.25, r.n * s * 1.1) + 8, w: r.w + s * 1.25 + 22, tilt: tilt(i, 0.8) };
    }
    case 'emoji': return { h: 240, w: 240, tilt: 5 };
    case 'gif': return { h: 370, w: 360, tilt: tilt(i, 4) };
    case 'counter': { const s = fitSize(t, 160, MAXW - 40, 1, 0.66); return { h: s * 1.05 + (it.sub ? s * 0.36 + 6 : 0) + 6, w: textW(t, FONT.black, s), tilt: 0 }; }
    case 'bigword': {
      const u = t.toUpperCase();
      const s = fitSize(u, 250, MAXW, 2, 0.7, 60);
      const r = wrap(u, { ...FONT.black, track: -2 }, s, MAXW);
      return { h: r.n * s * 0.98 + s * 0.08 + 10, w: r.w, tilt: 3 };
    }
    case 'callout': {
      const w = Math.min(MAXW, 760);
      const s = fitSize(t, 60, w - 70, 3, 0.55);
      const r = wrap(t, FONT.inter9, s, w - 78);
      return { h: r.n * s * 1.1 + 54 + 50, w: r.w + 78, tilt: 2.8 };
    }
    case 'arrow': { const s = fitSize(t, 62, MAXW - 120, 1, 0.58); return { h: (t ? s * 1.2 : 0) + 190, w: Math.max(420, t ? textW(t, FONT.marker, s) : 0), tilt: t ? 3 : 0 }; }
    case 'stars': return { h: 104 + (t ? 64 : 0), w: Math.max(478, t ? textW(t, FONT.inter9, 50) : 0), tilt: 0 };
    case 'cta': { const s = fitSize(t || 'Tekan beg kuning', 66, MAXW - 200, 1, 0.58); return { h: s * 1.2 + 46 + (it.sub ? s * 0.75 : 0) + 122, w: 0, tilt: 0 }; }
    case 'fact': {
      const w = Math.min(MAXW, 900);
      const s = fitSize(t, 54, w - 150, 3, 0.52);
      const r = wrap(t, FONT.inter9, s, w - 170);
      return { h: Math.max(84, r.n * s * 1.12 + (it.sub ? 44 : 0)) + 52, w, tilt: 0 };
    }
    case 'circle': { const s = fitSize(t, 78, MAXW - 140, 1, 0.62); return { h: s * 1.2 + 90, w: Math.min(MAXW, Math.max(260, t.length * s * 0.62 + 150)), tilt: tilt(i, 2) }; }
    case 'underline': { const s = fitSize(t, 80, MAXW - 60, 1, 0.66); return { h: s * 1.15 + 46, w: Math.min(MAXW, t.length * s * 0.66 + 40), tilt: tilt(i, 1.5) + 1 }; }
    case 'point': return { h: 210, w: t ? textW(t, FONT.marker, 60) : 130, tilt: t ? 3 : 0 };
    default: return { h: 120, w: MAXW, tilt: 0 };
  }
}

/** Room a sticker needs above and below its box (px, before slot scale): its tilt plus the idle breathe (±1.5°, ±7 px, ±2 %). */
const overhang = (b: Box) => (b.w / 2) * Math.sin(((Math.abs(b.tilt) + 1.2) * Math.PI) / 180) + 7 + b.h * 0.011;

/** Approximate rendered height (px, before slot scale) of a sticker incl. its tilt — mirrors elements.tsx. */
export function estHeight(it: Item, key = 0): number {
  const b = box(it, key);
  return b.h + 2 * overhang(b);
}

/** Speaker's face (px band, padded for the camera's punch-in; `eyes` = brows → nose only) during [s, e] frames, or null when no face is tracked. */
function faceBand(faces: Face[] | undefined, s: number, e: number, fps: number, zoom: number): (Span & { eyes: Span; bot: number }) | null {
  if (!faces?.length) return null;
  const t0 = s / fps - 0.25;
  const t1 = e / fps + 0.25;
  let hits = faces.filter((f) => f.t >= t0 && f.t <= t1);
  if (!hits.length) {
    const mid = (s + e) / 2 / fps;
    const near = faces.reduce((a, b) => (Math.abs(b.t - mid) < Math.abs(a.t - mid) ? b : a));
    if (Math.abs(near.t - mid) > 1.2) return null;
    hits = [near];
  }
  const top = Math.min(...hits.map((f) => f.y)) * 1920;
  const bot = Math.max(...hits.map((f) => f.y + f.h)) * 1920;
  const h = bot - top;
  // The detector box spans brows → chin. The camera scales about the face's centre (punch-in zooms, emphasis
  // bumps, overscan ≈ ×1.08 on top of the zoom), so the face's edges move out by half its height × (k − 1).
  const grow = (h / 2) * Math.max(0, zoom * 1.08 - 1);
  const pad = Math.max(h * 0.07, grow);
  const a = Math.max(0, top - pad - 12);
  return { a, b: Math.min(1920, bot + pad + 28), eyes: { a, b: top + h / 2 + h * 0.1 * zoom * 1.08 + 12 }, bot };
}

function freeGaps(busy: Span[]): Span[] {
  const sorted = busy.filter((x) => x.b > TOP_SAFE && x.a < BOTTOM_SAFE).sort((x, y) => x.a - y.a);
  const out: Span[] = [];
  let cur = TOP_SAFE;
  for (const s of sorted) {
    if (s.a > cur) out.push({ a: cur, b: s.a });
    cur = Math.max(cur, s.b);
  }
  if (cur < BOTTOM_SAFE) out.push({ a: cur, b: BOTTOM_SAFE });
  return out.filter((g) => g.b - g.a >= 50);
}

/**
 * One slot per sticker. A sticker with no slot in the result found no room clear of the eyes, the captions and
 * the other stickers — the caller drops it (no render, no sound effect).
 */
export function layoutEdit(placed: Placed[], o: {
  faces?: Face[]; fps: number; hookEnd: number; captions: Span | null; pips: { s: number; e: number }[];
  /** Full-screen B-roll windows that show a label card near the top. */
  labels?: { s: number; e: number }[];
  /** Largest camera zoom during [s, e] frames (1 = none). */
  zoomAt?: (s: number, e: number) => number;
}): Map<number, Slot> {
  const slots = new Map<number, Slot>();
  const skipped = new Set<number>();
  const done: { s: number; e: number; span: Span }[] = [];
  const sorted = [...placed].sort((a, b) => a.s - b.s || a.key - b.key);
  for (const p of sorted) {
    if (p.it.t === 'confetti' || slots.has(p.key) || skipped.has(p.key)) continue; // confetti = full-frame, no slot
    // A checklist is one block: items that pop in while the first is still up
    // get their room reserved together and read top → down.
    const group = p.it.t === 'check'
      ? sorted.filter((q) => q.it.t === 'check' && !slots.has(q.key) && !skipped.has(q.key) && q.s >= p.s && q.s < p.e)
      : [p];
    const boxes = group.map((q) => box(q.it, q.key));
    const over = boxes.map(overhang);
    const hs = boxes.map((b, i) => b.h + 2 * over[i] + GAP);
    // a sticker wider than the safe area (fitSize's char-count guess undershoots wide faces, e.g. Archivo Black
    // capitals) is scaled down until it fits: every slot scale below includes this
    const k0 = Math.min(1, ...boxes.map((b) => MAXW / Math.max(1, b.w)));
    const h = hs.reduce((x, y) => x + y, 0) * k0;
    const s = p.s;
    const e = Math.max(...group.map((q) => q.e));
    const zone: Zone = p.it.zone ?? 'middle';
    const face = faceBand(o.faces, s, e, o.fps, Math.max(1, o.zoomAt?.(s, e) ?? 1));
    const base: Span[] = [];
    if (o.captions) {
      // both caption renderers push the captions below a low face (centre ≤ 1440): reserve where they will be
      const ch = o.captions.b - o.captions.a;
      const pushed = face ? Math.min(1440 + ch * 0.6, face.bot + 50 + ch * 1.1) : o.captions.b;
      base.push({ a: o.captions.a, b: Math.max(o.captions.b, pushed) });
    }
    if (s < o.hookEnd) base.push({ a: 190, b: 600 });
    if (o.pips.some((b) => s < b.e && e > b.s)) base.push({ a: 190, b: 880 });
    if (o.labels?.some((b) => s < b.e && e > b.s)) base.push({ a: 200, b: 350 });
    for (const d of done) if (s < d.e && e > d.s) base.push(d.span);
    const gapsWith = (f: Span | null) => freeGaps(f ? [...base, f] : base);
    const order = (gaps: Span[]) => [...gaps].sort((x, y) =>
      zone === 'top' ? x.a - y.a : zone === 'bottom' ? y.b - x.b : (y.b - y.a) - (x.b - x.a));
    // top of the reservation in gap g at this scale
    const fit = (g: Span, scale: number): Slot => {
      const hh = h * scale;
      const y = zone === 'bottom' ? g.b - hh : zone === 'middle' ? g.a + (g.b - g.a - hh) / 2 : g.a;
      return { y, scale: scale * k0 };
    };
    const tryGaps = (gaps: Span[], homeScales: number[], anyScales: number[]): Slot | null => {
      const ord = order(gaps);
      const home = ord[0];
      if (home) for (const sc of homeScales) if (home.b - home.a >= h * sc) return fit(home, sc);
      for (const sc of anyScales) {
        const g = ord.find((x) => x.b - x.a >= h * sc);
        if (g) return fit(g, sc);
      }
      return null;
    };
    // 1) clear of the whole face, own side first, shrinking (never < 60 %)
    // 2) over the mouth / chin / chest — the eyes stay clear (pro edits do this)
    // 3) no room: skip the sticker — never over the eyes, never on another sticker
    const slot = tryGaps(gapsWith(face), [1, 0.9, 0.8], [1, 0.85, 0.7, MIN_SCALE])
      ?? (face ? tryGaps(gapsWith(face.eyes), [1, 0.9], [1, 0.85, 0.7, MIN_SCALE]) : null);
    if (!slot) {
      for (const q of group) skipped.add(q.key);
      continue;
    }
    let y = slot.y;
    group.forEach((q, i) => {
      slots.set(q.key, { y: Math.round(y + (GAP / 2 + over[i]) * slot.scale), scale: slot.scale });
      done.push({ s: q.s, e: q.e, span: { a: y, b: y + hs[i] * slot.scale } });
      y += hs[i] * slot.scale;
    });
  }
  return slots;
}
