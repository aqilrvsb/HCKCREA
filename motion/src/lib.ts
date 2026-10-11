import { spring } from 'remotion';
import { loadFont as loadMarker } from '@remotion/google-fonts/PermanentMarker';
import { loadFont as loadHand } from '@remotion/google-fonts/PatrickHand';
import { loadFont as loadBlack } from '@remotion/google-fonts/ArchivoBlack';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadMont } from '@remotion/google-fonts/Montserrat';
import type { AdLine, Item, ItemType, Tone, Word, Zone } from './types';

export const F = {
  marker: loadMarker('normal', { weights: ['400'], subsets: ['latin'] }).fontFamily,
  hand: loadHand('normal', { weights: ['400'], subsets: ['latin'] }).fontFamily,
  black: loadBlack('normal', { weights: ['400'], subsets: ['latin'] }).fontFamily,
  inter: loadInter('normal', { weights: ['700', '800', '900'], subsets: ['latin'] }).fontFamily,
  caption: loadMont('normal', { weights: ['800', '900'], subsets: ['latin'] }).fontFamily,
};

export const W = 1080;
export const H = 1920;
export const SAFE_X = 70;
export const EXIT = 6; // frames an element takes to fade out

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

export const popS = (f: number, fps: number, stiff = 180, damp = 12) =>
  spring({ frame: f, fps, config: { damping: damp, stiffness: stiff, mass: 0.7 } });

// Largest font size (≤ base) at which `text` fits `maxLines` lines of `width`
// px, assuming an average glyph is charW × size wide. Also capped so the
// longest single word fits one line (words never break mid-word).
export const fitSize = (text: string, base: number, width: number, maxLines: number, charW = 0.6, min = 22) => {
  const t = (text || '').trim();
  const n = Math.max(1, t.length);
  const longest = Math.max(1, ...t.split(/\s+/).map((w) => w.length));
  const byLines = (width * maxLines) / (n * charW * 1.12);
  const byWord = width / (longest * charW * 1.04);
  return Math.max(min, Math.floor(Math.min(base, byLines, byWord)));
};

// ── colour ────────────────────────────────────────────────────────────────────
const hexRgb = (hex: string): [number, number, number] => {
  let h = (hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return [255, 217, 59];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
export const lum = (hex: string) => {
  const [r, g, b] = hexRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const inkOn = (bg: string) => (lum(bg) > 0.45 ? '#111111' : '#ffffff');
export const shade = (hex: string, k: number) => {
  const [r, g, b] = hexRgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `rgb(${r},${g},${b})`;
};
export const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
export const safeAccent =(hex: string) => (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex || '') ? (hex.startsWith('#') ? hex : `#${hex}`) : '#FFD93B');
// Highlight colour that reads on top of video / dark backgrounds.
export const highlight = (accent: string) => (lum(accent) < 0.18 ? '#FFD93B' : accent);

export const TONE = (tone: Tone | undefined, accent: string, fallback: Tone): { bg: string; fg: string } => {
  switch (tone ?? fallback) {
    case 'yellow': return { bg: '#FFD93B', fg: '#111111' };
    case 'white': return { bg: '#F7F4EC', fg: '#111111' };
    case 'red': return { bg: '#E11D48', fg: '#ffffff' };
    case 'green': return { bg: '#16A34A', fg: '#ffffff' };
    case 'dark': return { bg: '#111111', fg: '#ffffff' };
    case 'accent': return { bg: accent, fg: inkOn(accent) };
  }
  return { bg: '#FFD93B', fg: '#111111' };
};

// ── cues ──────────────────────────────────────────────────────────────────────
const NUM = /^[+-]?\d*\.?\d+$/;

/** Buat Iklan cue → seconds. "l3", "l3@harga", "l3@harga#2", "l3$", "+0.3"
 *  offsets, or plain seconds. Unknown lines / words fall back instead of throwing. */
export const makeAdCue = (lines: AdLine[]) => (c: string | number | undefined, fallback: number): number => {
  if (c === undefined || c === null || c === '') return fallback;
  if (typeof c === 'number') return Number.isFinite(c) ? c : fallback;
  const s = String(c).trim();
  if (NUM.test(s)) return parseFloat(s);
  const m = s.match(/^([a-z0-9_]+)(?:@([^#$+-]+?)(?:#(\d+))?)?(\$)?([+-]\d*\.?\d+)?$/i);
  if (!m) return fallback;
  const l = lines.find((x) => x.id === m[1]);
  if (!l) return fallback;
  let t: number;
  if (m[4]) t = l.sceneEnd;
  else if (m[2]) {
    const want = norm(m[2]);
    const hits = l.words.filter((w) => {
      const n = norm(w.w);
      return n.startsWith(want) || (want.length > 3 && n.includes(want));
    });
    const w = hits[(Number(m[3]) || 1) - 1] || hits[0];
    t = l.audioStart + (w ? w.t : 0);
  } else t = l.sceneStart;
  return t + (m[5] ? parseFloat(m[5]) : 0);
};

/** Edit Video cue → seconds. "w12" (word start), "w12$" (word end), "w12+0.2", or seconds. */
export const makeEditCue = (words: Word[]) => (c: string | number | undefined, fallback: number): number => {
  if (c === undefined || c === null || c === '') return fallback;
  if (typeof c === 'number') return Number.isFinite(c) ? c : fallback;
  const s = String(c).trim();
  if (NUM.test(s)) return parseFloat(s);
  const m = s.match(/^w(\d+)(\$)?([+-]\d*\.?\d+)?$/i);
  if (!m) return fallback;
  const w = words[Math.min(words.length - 1, Number(m[1]))];
  if (!w) return fallback;
  const base = m[2] ? (w.e ?? w.t + 0.3) : w.t;
  return base + (m[3] ? parseFloat(m[3]) : 0);
};

// ── zone layout ───────────────────────────────────────────────────────────────
export type Placed = { it: Item; s: number; e: number; key: number };
export type Row = Placed[];

// Items in a zone are packed into rows: an item reuses the first row whose
// previous item has already left, otherwise opens a new row. Each row is a
// grid cell sized to its biggest item, so the layout never jumps when items
// come and go — and items that follow each other share the same spot.
export const packRows = (placed: Placed[]): Record<Zone, Row[]> => {
  const out: Record<Zone, Row[]> = { top: [], middle: [], bottom: [] };
  const sorted = [...placed].sort((a, b) => a.s - b.s);
  for (const p of sorted) {
    const z = (p.it.zone && out[p.it.zone] ? p.it.zone : 'middle') as Zone;
    const rows = out[z];
    const row = rows.find((r) => r[r.length - 1].e <= p.s);
    if (row) row.push(p);
    else rows.push([p]);
  }
  return out;
};

export const SFX_FOR: Record<ItemType, { name: string; vol: number; len?: number }> = {
  headline: { name: 'thump', vol: 0.45 },
  note: { name: 'pop', vol: 0.32 },
  tag: { name: 'stamp', vol: 0.3 },
  stamp: { name: 'stamp', vol: 0.55 },
  chip: { name: 'pop', vol: 0.24 },
  tape: { name: 'paper', vol: 0.3 },
  scribble: { name: 'marker', vol: 0.2, len: 40 },
  price: { name: 'sparkle', vol: 0.42 },
  check: { name: 'tick', vol: 0.3 },
  emoji: { name: 'pop', vol: 0.35 },
  counter: { name: 'tick', vol: 0.26 },
};

export type SfxEvent = { frame: number; name: string; vol: number; len: number };

// Deterministic small rotation per element so a scene looks hand-placed.
export const tilt = (i: number, amp = 2.2) => [-1, 0.7, -0.4, 1, -0.8, 0.5][i % 6] * amp;
