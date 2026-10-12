// Face-aware sticker placement for Edit Video.
//
// The zone stack (lib.ts packRows) keeps every row of a zone alive for the
// whole video, so once three stickers overlapped, every later sticker in that
// zone sat two rows lower — right over the speaker's eyes. Here each sticker
// gets ONE fixed slot (y + scale) for its lifetime, chosen when it appears:
//   free space = safe frame − speaker's face during its window (from the face
//   track, padded for punch-in zooms) − captions − hook − PiP card − stickers
//   already on screen at the same time.
// "top" stickers take the highest free gap, "bottom" ones sit just above the
// captions, "middle" ones the roomiest gap; when nothing fits at full size the
// sticker shrinks (down to 55 %) instead of covering the face.
import { SAFE_X, W, fitSize, type Placed } from './lib';
import type { Face, Item, Zone } from './types';

export type Slot = { y: number; scale: number };
type Span = { a: number; b: number };

const TOP_SAFE = 170; // below the progress bar / TikTok top bar
const BOTTOM_SAFE = 1610; // above TikTok's caption + product-link area
const GAP = 18;
const MAXW = W - SAFE_X * 2;

const lines = (text: string, size: number, width: number, charW: number, max: number) =>
  Math.min(max, Math.max(1, Math.ceil(((text || '').length * charW * size * 1.12) / Math.max(1, width))));

/** Approximate rendered height (px, before slot scale) of a sticker — mirrors elements.tsx. */
export function estHeight(it: Item): number {
  const t = it.text ?? '';
  switch (it.t) {
    case 'headline': { const s = fitSize(t, 108, MAXW - 70, 2, 0.68); return lines(t, s, MAXW - 70, 0.68, 2) * s * 1.06 + s * 0.2 + 16; }
    case 'note': { const w = Math.min(MAXW, Math.max(360, Math.min(600, 250 + t.length * 9))); const s = fitSize(t, 62, w - 44, 4, 0.48); return Math.max(w * 0.62, lines(t, s, w - 44, 0.48, 4) * s * 1.05 + 48) + (it.sub ? s * 1.25 : 0) + 20; }
    case 'tag': return fitSize(t, 58, MAXW - 60, 1, 0.66) * 1.2 + 14;
    case 'stamp': return fitSize(t, 124, MAXW - 120, 1, 0.72) * 1.15 + 30;
    case 'chip': return fitSize(t, 54, MAXW - 120, 1, 0.58) * 1.2 + 28;
    case 'tape': return fitSize(t, 50, MAXW - 80, 1, 0.6) * 1.3 + 12;
    case 'scribble': { const s = fitSize(t, 66, MAXW - 40, 2, 0.56); return lines(t, s, MAXW - 40, 0.56, 2) * s * 1.12 + 8; }
    case 'price': { const s = fitSize(t, 176, MAXW - 80, 1, 0.66); return s * 1.25 + (it.sub ? s * 0.45 + 6 : 0); }
    case 'check': { const s = fitSize(t, 62, MAXW - 130, 2, 0.55); return Math.max(s * 1.25, lines(t, s, MAXW - 130, 0.55, 2) * s * 1.1) + 8; }
    case 'emoji': return 240;
    case 'gif': return 380;
    case 'counter': { const s = fitSize(t, 160, MAXW - 40, 1, 0.66); return s * 1.05 + (it.sub ? s * 0.36 + 6 : 0); }
    case 'bigword': { const s = fitSize(t.toUpperCase(), 250, MAXW, 2, 0.7, 60); return lines(t, s, MAXW, 0.7, 2) * s * 0.98 + 10; }
    case 'callout': { const s = fitSize(t, 60, Math.min(MAXW, 760) - 70, 3, 0.55); return lines(t, s, 690, 0.55, 3) * s * 1.1 + 54 + 50; }
    case 'arrow': return (t ? fitSize(t, 62, MAXW - 120, 1, 0.58) * 1.2 : 0) + 190;
    case 'stars': return 104 + (t ? 64 : 0);
    case 'cta': { const s = fitSize(t || 'Tekan beg kuning', 66, MAXW - 200, 1, 0.58); return s * 1.2 + 46 + (it.sub ? s * 0.75 : 0) + 122; }
    case 'fact': { const s = fitSize(t, 54, Math.min(MAXW, 900) - 150, 3, 0.52); return Math.max(84, lines(t, s, 750, 0.52, 3) * s * 1.12 + (it.sub ? 40 : 0)) + 52; }
    case 'circle': return fitSize(t, 78, MAXW - 140, 1, 0.62) * 1.2 + 90;
    case 'underline': return fitSize(t, 80, MAXW - 60, 1, 0.66) * 1.15 + 46;
    case 'point': return 210;
    default: return 120;
  }
}

/** Speaker's face (px band, padded) during [s, e] frames, or null when no face is tracked. */
function faceBand(faces: Face[] | undefined, s: number, e: number, fps: number): Span | null {
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
  const pad = (bot - top) * 0.18; // punch-in zooms grow the face around its centre
  return { a: Math.max(0, top - pad - 50), b: Math.min(1920, bot + pad + 70) };
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

export function layoutEdit(placed: Placed[], o: {
  faces?: Face[]; fps: number; hookEnd: number; captions: Span | null; pips: { s: number; e: number }[];
  /** Full-screen B-roll windows that show a label card near the top. */
  labels?: { s: number; e: number }[];
}): Map<number, Slot> {
  const slots = new Map<number, Slot>();
  const done: { s: number; e: number; span: Span }[] = [];
  for (const p of [...placed].sort((a, b) => a.s - b.s || a.key - b.key)) {
    if (p.it.t === 'confetti') continue; // full-frame effect, no slot
    const h = estHeight(p.it) + GAP;
    const busy: Span[] = [];
    const face = faceBand(o.faces, p.s, p.e, o.fps);
    if (face) busy.push(face);
    if (o.captions) busy.push(o.captions);
    if (p.s < o.hookEnd) busy.push({ a: 190, b: 600 });
    if (o.pips.some((b) => p.s < b.e && p.e > b.s)) busy.push({ a: 190, b: 880 });
    if (o.labels?.some((b) => p.s < b.e && p.e > b.s)) busy.push({ a: 200, b: 350 });
    for (const d of done) if (p.s < d.e && p.e > d.s) busy.push(d.span);
    const gaps = freeGaps(busy);
    const zone: Zone = p.it.zone ?? 'middle';
    const order = [...gaps].sort((x, y) =>
      zone === 'top' ? x.a - y.a : zone === 'bottom' ? y.b - x.b : (y.b - y.a) - (x.b - x.a));
    const fit = (g: Span, scale: number): Slot => {
      const hh = h * scale;
      const y = zone === 'bottom' ? g.b - hh : zone === 'middle' ? g.a + (g.b - g.a - hh) / 2 : g.a;
      return { y: Math.round(y + GAP / 2), scale };
    };
    let slot: Slot | null = null;
    // 1) its own side (top stays on top…), shrinking a little if needed
    const home = order[0];
    if (home) for (const scale of [1, 0.9, 0.8]) if (home.b - home.a >= h * scale) { slot = fit(home, scale); break; }
    // 2) any free gap, shrinking further
    if (!slot) {
      for (const scale of [1, 0.85, 0.7, 0.55]) {
        const g = order.find((x) => x.b - x.a >= h * scale);
        if (g) { slot = fit(g, scale); break; }
      }
    }
    if (!slot) {
      // Nothing free — squeeze into the roomiest gap (or the zone's home spot).
      const g = [...gaps].sort((x, y) => (y.b - y.a) - (x.b - x.a))[0];
      if (g) slot = { y: Math.round(g.a), scale: Math.max(0.45, Math.min(1, (g.b - g.a) / h)) };
      else slot = { y: zone === 'top' ? 200 : zone === 'bottom' ? 1100 : 760, scale: 0.55 };
    }
    slots.set(p.key, slot);
    done.push({ s: p.s, e: p.e, span: { a: slot.y - GAP / 2, b: slot.y + h * slot.scale } });
  }
  return slots;
}
