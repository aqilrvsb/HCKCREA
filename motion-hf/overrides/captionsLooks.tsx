// Laju v2 "Pro" caption LOOKS — the caption styles top creators and caption apps use, built as one parametric
// renderer (a look is a set of switches, not its own code path), picked by the AI director per video:
//   hormozi  caps, thick stroke, 2–3 short lines; ONE emphasis word per page in green / yellow (alternating pages)
//   beast    comic-loud caps, the whole page yellow, the emphasis word green with a glow, bouncy tilt
//   karaoke  caps; the spoken word pops ×1.2 in green / yellow (alternating pages)
//   popline  caps; the spoken word grows and a purple bar wipes under it
//   deep     lowercase dark words on a white rounded box; words turn from grey to black as spoken
//   pill     sentence case on light-grey pills; words fill from grey to dark as spoken
//   fill     one caps line; spoken words stay lit in mint (progress fill)
//   pod      condensed caps, 1–2 words, hard cuts; one emphasis word hot pink
//   sticker  CapCut sticker text: coloured fill, thick white outline, hard drop shadow, each word pops (tilted)
//   sweep    a red box slides from word to word behind the spoken word
//   neon     condensed caps; the emphasis word glows cyan, the page flickers on
// Shared: measured layout, Malay-aware line breaks (no line ends on "yang / dan / di / untuk…", "RM 50" stays
// together), balanced lines, kept left of TikTok's button column, lowered under a low face; keyword emoji;
// taped (censored) words. Ideas from Opus Clip / Submagic / Captions presets (described looks only), the
// HyperFrames caption components (Apache-2.0) and Remocn caption-highlight-box (MIT).
import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { LottieEmoji } from './emoji';
import { TapeStrip } from '../../motion/src/guard';
import { clamp } from '../../motion/src/lib';
import type { CaptionKey, KeyColor, LottieMap, Word } from '../../motion/src/types';
import type { Face, Look } from './look';
import { rng, textWidth } from './scenesKit';

type PWord = Word & { gi: number };
type Page = { words: PWord[]; start: number; end: number };

export type CapLookId = 'hormozi' | 'beast' | 'karaoke' | 'popline' | 'deep' | 'pill' | 'fill' | 'pod' | 'sticker' | 'sweep' | 'neon';
type CapLook = {
  case: 'upper' | 'lower' | 'sentence';
  font?: Face;
  size: number;
  /** what takes the colour: the page's emphasis word, the spoken word, everything spoken so far, the whole page */
  hl: 'emphasis' | 'active' | 'fill' | 'none';
  palette: string[];
  base: string;
  /** unspoken words (karaoke / fill looks), else as base */
  dim?: string;
  active: 'pop' | 'underline' | 'sweep' | 'none';
  bg: 'none' | 'box' | 'pill' | 'sticker';
  stroke: number; // em
  shadow: string;
  glow?: boolean;
  enter: 'pop' | 'bounce' | 'cut' | 'flicker';
  /** words appear one by one as spoken */
  reveal?: boolean;
  lines: number;
  maxWords: number;
  tilt?: boolean;
};

const MONT: Face = { family: "'Montserrat', sans-serif", weight: 900, charW: 0.70, upper: true, track: -0.5 };
const ARCH: Face = { family: "'Archivo Black', sans-serif", weight: 400, charW: 0.77, upper: true, track: 0 };
const ANTON: Face = { family: "'Anton', sans-serif", weight: 400, charW: 0.47, upper: true, track: 0.5 };
const BEBAS: Face = { family: "'Bebas Neue', sans-serif", weight: 400, charW: 0.42, upper: true, track: 1 };
const POP: Face = { family: "'Poppins', sans-serif", weight: 800, charW: 0.66, upper: false, track: -0.5 };
const INTER: Face = { family: "'Inter', sans-serif", weight: 800, charW: 0.6, upper: false, track: -0.5 };

export const CAP_LOOKS: Record<CapLookId, CapLook> = {
  hormozi: { case: 'upper', size: 112, hl: 'emphasis', palette: ['#00F020', '#F0FF00'], base: '#fff', active: 'none', bg: 'none', stroke: 0.13,
    shadow: '0 8px 0 rgba(0,0,0,0.55)', enter: 'pop', lines: 3, maxWords: 3 },
  beast: { case: 'upper', font: ARCH, size: 104, hl: 'emphasis', palette: ['#3DFF6E'], base: '#FFF200', active: 'none', bg: 'none', stroke: 0.16,
    shadow: '0 9px 0 rgba(0,0,0,0.7)', glow: true, enter: 'bounce', lines: 2, maxWords: 3, tilt: true },
  karaoke: { case: 'upper', size: 98, hl: 'active', palette: ['#3DFF6E', '#FFE600'], base: '#fff', active: 'pop', bg: 'none', stroke: 0.12,
    shadow: '0 6px 14px rgba(0,0,0,0.55)', enter: 'pop', lines: 2, maxWords: 4 },
  popline: { case: 'upper', size: 96, hl: 'none', palette: ['#8B3DFF'], base: '#fff', active: 'underline', bg: 'none', stroke: 0.1,
    shadow: '0 6px 14px rgba(0,0,0,0.55)', enter: 'pop', lines: 2, maxWords: 4 },
  deep: { case: 'lower', font: INTER, size: 74, hl: 'fill', palette: ['#111111'], base: '#111111', dim: '#9a9a9a', active: 'none', bg: 'box', stroke: 0,
    shadow: 'none', enter: 'cut', lines: 2, maxWords: 5 },
  pill: { case: 'sentence', font: POP, size: 72, hl: 'fill', palette: ['#1a1a1a'], base: '#1a1a1a', dim: '#a6a6a6', active: 'none', bg: 'pill', stroke: 0,
    shadow: 'none', enter: 'pop', lines: 2, maxWords: 5 },
  fill: { case: 'upper', size: 94, hl: 'fill', palette: ['#60F0C0'], base: '#fff', active: 'none', bg: 'none', stroke: 0.11,
    shadow: '0 6px 14px rgba(0,0,0,0.55)', enter: 'pop', lines: 2, maxWords: 4 },
  pod: { case: 'upper', font: ANTON, size: 150, hl: 'emphasis', palette: ['#FF40D8'], base: '#fff', active: 'none', bg: 'none', stroke: 0,
    shadow: '0 6px 22px rgba(0,0,0,0.65)', enter: 'cut', lines: 1, maxWords: 2 },
  sticker: { case: 'upper', font: ARCH, size: 96, hl: 'emphasis', palette: ['#FF5FA2', '#3DDC97', '#4FB3FF'], base: '#FFD93B', active: 'none', bg: 'sticker', stroke: 0,
    shadow: 'none', enter: 'pop', reveal: true, lines: 2, maxWords: 3, tilt: true },
  sweep: { case: 'upper', font: { ...MONT, weight: 800 }, size: 94, hl: 'none', palette: ['#ff1745'], base: '#fff', active: 'sweep', bg: 'none', stroke: 0.08,
    shadow: '0 6px 14px rgba(0,0,0,0.5)', enter: 'pop', lines: 2, maxWords: 4 },
  neon: { case: 'upper', font: ANTON, size: 128, hl: 'emphasis', palette: ['#10C0FF'], base: '#fff', active: 'none', bg: 'none', stroke: 0,
    shadow: '0 0 18px rgba(16,192,255,0.55), 0 4px 10px rgba(0,0,0,0.6)', glow: true, enter: 'flicker', lines: 2, maxWords: 3 },
};
export const CAP_LOOK_IDS = Object.keys(CAP_LOOKS) as CapLookId[];

const KEY_COLOR: Record<KeyColor, string> = { benefit: '#4ade80', price: '#FFD93B', pain: '#f87171', brand: '#ffffff', accent: '#ffffff' };

// ── Malay-aware line breaking ─────────────────────────────────────────────────

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}%]/gu, '');
const NO_END = new Set(['yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'pada', 'tak', 'nak', 'tidak', 'akan', 'kepada', 'dalam', 'ni', 'the', 'a', 'to', 'of', 'rm', 'atau', 'ataupun', 'sebab', 'kalau', 'bila']);
const NO_START = new Set(['ini', 'itu', 'ni', 'tu', 'pun', 'lah', 'je', 'jer', 'kan', '%', 'sen', 'hari', 'jam', 'minit', 'minggu', 'bulan', 'tahun', 'kali', 'ringgit']);
/** a break between words a|b costs this much (number + unit, "RM" + number and function words stay together) */
const breakCost = (a: string, b: string) => {
  const na = norm(a);
  const nb = norm(b);
  let c = 0;
  if (NO_END.has(na)) c += 240;
  if (NO_START.has(nb)) c += 200;
  if (/^\d/.test(nb) && /^rm$/.test(na)) c += 600;
  if (/\d$/.test(na) && /^(%|sen|hari|jam|minit|minggu|bulan|tahun|kali|ringgit|kg|g|ml|pcs|helai|biji)$/.test(nb)) c += 600;
  return c;
};

/** Lines of word indices: ≤ maxLines, each ≤ maxW; balanced (a little heavier at the bottom), the costly breaks avoided. */
export const breakWords = (widths: number[], words: string[], gap: number, maxW: number, maxLines: number): number[][] | null => {
  const n = widths.length;
  const lineW = (a: number, b: number) => widths.slice(a, b).reduce((s, w) => s + w, 0) + gap * Math.max(0, b - a - 1);
  let best: { cost: number; lines: number[][] } | null = null;
  const consider = (cuts: number[]) => {
    const bounds = [0, ...cuts, n];
    const lines: number[][] = [];
    let cost = 0;
    let widest = 0;
    for (let i = 0; i + 1 < bounds.length; i++) {
      const w = lineW(bounds[i], bounds[i + 1]);
      if (w > maxW) return;
      widest = Math.max(widest, w);
      lines.push(Array.from({ length: bounds[i + 1] - bounds[i] }, (_, k) => bounds[i] + k));
    }
    for (const c of cuts) cost += breakCost(words[c - 1], words[c]);
    // balanced: the widest line as short as possible; a top line wider than the one under it costs a little
    cost += widest;
    for (let i = 0; i + 1 < lines.length; i++) {
      const a = lineW(lines[i][0], lines[i][lines[i].length - 1] + 1);
      const b = lineW(lines[i + 1][0], lines[i + 1][lines[i + 1].length - 1] + 1);
      if (a > b) cost += (a - b) * 0.25;
    }
    cost += (lines.length - 1) * 40; // fewer lines when they fit
    if (!best || cost < best.cost) best = { cost, lines };
  };
  consider([]);
  if (maxLines >= 2) for (let a = 1; a < n; a++) consider([a]);
  if (maxLines >= 3) for (let a = 1; a < n; a++) for (let b = a + 1; b < n; b++) consider([a, b]);
  return best ? (best as { lines: number[][] }).lines : null;
};

/** The page's one emphasis word: a director keyword, else a number / price / %, else the longest word (≥ 6 letters). */
const emphasisOf = (page: Page, keyOf: Map<number, CaptionKey>): number => {
  const k = page.words.find((w) => keyOf.has(w.gi));
  if (k) return k.gi;
  const num = page.words.find((w) => /\d|^rm/i.test(w.w));
  if (num) return num.gi;
  let best = -1;
  let len = 5;
  for (const w of page.words) { const l = norm(w.w).length; if (l > len) { len = l; best = w.gi; } }
  return best;
};

const caseOf = (lk: CapLook, w: string, first: boolean) =>
  lk.case === 'upper' ? w.toUpperCase() : lk.case === 'lower' ? w.toLowerCase() : first ? w.charAt(0).toUpperCase() + w.slice(1) : w;

/** A sticker outline: a ring of hard white shadows (rounder than -webkit-text-stroke on heavy faces) + a drop shadow. */
const stickerShadow = (size: number) => {
  const r = Math.max(4, size * 0.085);
  const ring = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return `${(Math.cos(a) * r).toFixed(1)}px ${(Math.sin(a) * r).toFixed(1)}px 0 #fff`;
  });
  return [...ring, `0 ${(r + size * 0.06).toFixed(1)}px 0 rgba(0,0,0,0.45)`].join(', ');
};

export const CaptionsLook: React.FC<{
  pages: Page[]; lookId: CapLookId; look: Look; centerY: number; keywords?: CaptionKey[]; lottie?: LottieMap; censor?: number[];
  /** the bottom of the face on screen (px) at the page's start, or null */
  faceBottom?: (t: number) => number | null;
}> = ({ pages, lookId, look, centerY, keywords, lottie, censor, faceBottom }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lk = CAP_LOOKS[lookId] ?? CAP_LOOKS.hormozi;
  const t = frame / fps;
  const pi = pages.findIndex((p) => t >= p.start - 0.06 && t < p.end);
  if (pi < 0) return null;
  const page = pages[pi];
  const keyOf = new Map<number, CaptionKey>((keywords ?? []).map((k) => [k.i, k]));
  const taped = new Set(censor ?? []);
  const face = lk.font ?? look.caption;
  const texts = page.words.map((w, k) => caseOf(lk, w.w, k === 0));
  // TikTok's button column starts near x ≈ 930: the block keeps left of it
  const LEFT = 90;
  const MAXW = 830;
  const pad = lk.bg === 'pill' ? 0.3 : lk.bg === 'sticker' ? 0.12 : 0.02;
  let size = lk.size * (face.charW < 0.5 && !lk.font ? 1.22 : 1);
  let lines: number[][] | null = null;
  let widths: number[] = [];
  let gap = 0;
  for (; size >= 44; size -= 4) {
    widths = texts.map((x) => textWidth(x, face, size) + size * pad * 2);
    // a popping / growing word needs air on both sides: half its growth (on the widest word) plus the outline
    const grow = lk.active === 'pop' ? 0.16 : lk.active === 'underline' ? 0.07 : 0;
    gap = lk.bg === 'pill' ? size * 0.22 : size * 0.3 + size * lk.stroke + (grow * Math.max(...widths)) / 2;
    lines = breakWords(widths, texts, gap, MAXW, lk.lines);
    if (lines) break;
  }
  if (!lines) { size = 44; gap = size * 0.3; widths = texts.map((x) => textWidth(x, face, size) + size * pad * 2); lines = [texts.map((_, i) => i)]; }
  const lh = size * (lk.bg === 'pill' ? 1.36 : lk.bg === 'box' ? 1.18 : 1.1);
  const blockH = lines.length * lh;
  // a low face pushes the captions down (never into TikTok's bottom band)
  const fb = faceBottom?.(page.start) ?? null;
  const cy = fb != null ? Math.min(1440, Math.max(centerY, fb + 50 + blockH / 2)) : centerY;
  const top = cy - blockH / 2;
  const pf = Math.round((t - page.start) * fps);
  const leaveF = Math.round((page.end - t) * fps);
  const leave = leaveF < 4 ? Math.max(0, leaveF / 4) : 1;
  const ent = lk.enter === 'cut' ? 1 : spring({ frame: pf + 2, fps, config: { damping: lk.enter === 'bounce' ? 9 : 16, stiffness: 300, mass: 0.7 } });
  const flick = lk.enter === 'flicker' && pf < 12 ? (rng(page.start * 997 + pf)() > 0.3 ? 1 : 0.25) : 1;
  let cur = -1;
  page.words.forEach((w, k) => { if (t >= w.t - 0.02) cur = k; });
  const emph = lk.hl === 'emphasis' ? emphasisOf(page, keyOf) : -1;
  const palCol = lk.palette[pi % lk.palette.length];
  const tiltPage = lk.tilt ? ((pi % 2 ? 1 : -1) * 2.5) : 0;
  // word boxes
  const boxes: { x: number; y: number; w: number; li: number }[] = [];
  lines.forEach((ln, li) => {
    const lw = ln.reduce((s, i) => s + widths[i], 0) + gap * (ln.length - 1);
    let x = LEFT + (MAXW - lw) / 2;
    for (const i of ln) { boxes[i] = { x, y: top + li * lh, w: widths[i], li }; x += widths[i] + gap; }
  });
  // the sweep box slides from the previous spoken word to the current one
  let sweep: React.ReactNode = null;
  if (lk.active === 'sweep' && cur >= 0) {
    const wf = Math.round((t - page.words[cur].t) * fps);
    const k = spring({ frame: wf, fps, config: { damping: 18, stiffness: 260 } });
    const a = boxes[Math.max(0, cur - 1)];
    const b = boxes[cur];
    const same = cur === 0 || a.li !== b.li;
    const x = same ? b.x : a.x + (b.x - a.x) * k;
    const w = same ? b.w : a.w + (b.w - a.w) * k;
    const sc = same ? 0.6 + 0.4 * k : 1;
    sweep = <div style={{ position: 'absolute', left: x - size * 0.14, top: b.y + size * 0.02, width: w + size * 0.28, height: size * 1.08, borderRadius: size * 0.16,
      background: 'linear-gradient(180deg, #ff1745, #df1238)', transform: `rotate(-2deg) scale(${sc.toFixed(3)})`, boxShadow: '0 6px 0 rgba(0,0,0,0.35)' }} />;
  }
  let emojiShown = false;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: leave * flick }}>
      <div style={{ position: 'absolute', inset: 0, transformOrigin: `${LEFT + MAXW / 2}px ${cy}px`,
        transform: `translateY(${((1 - ent) * 34).toFixed(1)}px) scale(${((0.84 + 0.16 * ent) * (0.95 + 0.05 * leave)).toFixed(4)}) rotate(${tiltPage}deg)` }}>
        {lk.bg === 'box' && (() => {
          const lw = Math.max(...lines.map((ln) => ln.reduce((s, i) => s + widths[i], 0) + gap * (ln.length - 1)));
          return <div style={{ position: 'absolute', left: LEFT + (MAXW - lw) / 2 - size * 0.42, top: top - size * 0.22, width: lw + size * 0.84, height: blockH + size * 0.44,
            background: '#fff', borderRadius: size * 0.3, boxShadow: '0 10px 30px rgba(0,0,0,0.35)' }} />;
        })()}
        {lk.bg === 'pill' && lines.map((ln, li) => {
          const lw = ln.reduce((s, i) => s + widths[i], 0) + gap * (ln.length - 1);
          return <div key={`p${li}`} style={{ position: 'absolute', left: LEFT + (MAXW - lw) / 2 - size * 0.2, top: top + li * lh + size * 0.02, width: lw + size * 0.4, height: size * 1.26,
            background: '#e7e5e7', borderRadius: size, boxShadow: '0 6px 18px rgba(0,0,0,0.25)' }} />;
        })}
        {sweep}
        {page.words.map((w, k) => {
          const b = boxes[k];
          if (!b) return null;
          const spoken = k <= cur;
          const isCur = k === cur;
          const wf = Math.round((t - w.t) * fps);
          if (lk.reveal && !spoken) return null;
          if (taped.has(w.gi)) {
            return <div key={k} style={{ position: 'absolute', left: b.x, top: b.y + size * 0.08, transform: `rotate(${(w.gi % 3) - 1.5}deg)` }}><TapeStrip w={b.w} h={size * 0.95} seed={w.gi + 3} /></div>;
          }
          const key = keyOf.get(w.gi);
          const isEmph = w.gi === emph;
          let color = lk.base;
          if (lk.hl === 'emphasis' && isEmph) color = key && lookId !== 'beast' && lookId !== 'neon' && lookId !== 'pod' ? (key.color === 'brand' || key.color === 'accent' ? palCol : KEY_COLOR[key.color] ?? palCol) : palCol;
          if (lk.hl === 'active' && isCur) color = palCol;
          if (lk.hl === 'fill') color = spoken ? palCol : (lk.dim ?? lk.base);
          if (lk.dim && lk.hl !== 'fill' && !spoken) color = lk.dim;
          if (lk.active === 'sweep' && isCur) color = '#fff';
          const pop = (lk.active === 'pop' && isCur) ? interpolate(wf, [0, 2, 6], [1, 1.16, 1.06], { ...clamp, easing: Easing.out(Easing.cubic) })
            : lk.active === 'underline' && isCur ? interpolate(wf, [0, 3], [1, 1.07], clamp) : 1;
          const wordPop = lk.reveal ? spring({ frame: wf + 1, fps, config: { damping: 10, stiffness: 320, mass: 0.6 } }) : 1;
          const tilt = lk.bg === 'sticker' ? (rng(w.gi * 7 + 3)() - 0.5) * 7 : 0;
          const stroke = lk.stroke > 0 ? Math.max(5, Math.round(size * lk.stroke)) : 0;
          const glow = lk.glow && isEmph ? `0 0 ${(size * 0.1).toFixed(0)}px ${color}, 0 0 ${(size * 0.26).toFixed(0)}px ${color}, ` : '';
          const textShadow = lk.bg === 'sticker' ? stickerShadow(size) : `${glow}${lk.shadow}`;
          const showEmoji = !!(key?.emoji && spoken && !emojiShown);
          if (showEmoji) emojiShown = true;
          const es = showEmoji ? spring({ frame: wf, fps, config: { damping: 11, stiffness: 360, mass: 0.7 } }) : 0;
          return (
            <div key={k} style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, textAlign: 'center',
              transform: `scale(${(pop * wordPop).toFixed(3)}) rotate(${tilt.toFixed(1)}deg)`, transformOrigin: 'center bottom' }}>
              <span style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: size, lineHeight: `${(size * 1.1).toFixed(1)}px`, letterSpacing: face.track,
                color, whiteSpace: 'nowrap', WebkitTextStroke: stroke ? `${stroke}px #000` : '0px', paintOrder: 'stroke fill', textShadow } as React.CSSProperties}>{texts[k]}</span>
              {lk.active === 'underline' && isCur && (
                <div style={{ position: 'absolute', left: size * 0.04, right: size * 0.04, bottom: -size * 0.06, height: Math.max(8, size * 0.11), borderRadius: 99,
                  background: lk.palette[0], transform: `scaleX(${interpolate(wf, [0, 4], [0, 1], clamp)})`, transformOrigin: 'left center', boxShadow: '0 3px 0 #000' }} />
              )}
              {showEmoji && (b.li === 0 ? (
                // on the top line: above the word; lower down it would sit on the line above — beside it instead
                <div style={{ position: 'absolute', left: '50%', bottom: '100%', marginLeft: -size * 0.5, transform: `scale(${es.toFixed(3)}) rotate(${(w.gi % 2 ? 6 : -6) * es}deg)`, transformOrigin: '50% 100%' }}>
                  <LottieEmoji char={key!.emoji!} size={size} lottie={lottie} />
                </div>
              ) : (
                <div style={{ position: 'absolute', top: size * 0.05, ...(b.x + b.w + size * 0.95 < 1000 ? { left: b.w + size * 0.1 } : { right: b.w + size * 0.1 }),
                  transform: `scale(${es.toFixed(3)}) rotate(${(w.gi % 2 ? 6 : -6) * es}deg)` }}>
                  <LottieEmoji char={key!.emoji!} size={size * 0.9} lottie={lottie} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
