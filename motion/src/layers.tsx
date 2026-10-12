import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { RENDER } from './elements';
import { LottieEmoji } from './emoji';
import { TapeStrip } from './guard';
import { noise2D } from '@remotion/noise';
import { createRoundedTextBox } from '@remotion/rounded-text-box';
import { EXIT, F, SAFE_X, W, clamp, fitSize, highlight, inkOn, popS, shade, type Placed, type Row } from './lib';
import type { Slot } from './layout';
import type { SfxEvent } from './sfx';
import type { Bg, CaptionKey, CaptionStyle, KeyColor, LottieMap, Style, Word, Zone } from './types';

// ── zones ─────────────────────────────────────────────────────────────────────
export type ZoneBoxes = Record<Zone, { top: number; height: number; justify: 'flex-start' | 'center' | 'flex-end' }>;

// Renders every zone as a column of rows. Each row is a 1×1 grid: all of its
// items sit in the same cell (sized to the biggest), inactive ones hidden — so
// positions are fixed for the whole scene and nothing jumps.
export const ZoneStack: React.FC<{
  rows: Record<Zone, Row[]>; boxes: ZoneBoxes; ink: string; accent: string; surface: 'dark' | 'light' | 'accent'; style?: Style; lottie?: LottieMap;
}> = ({ rows, boxes, ink, accent, surface, style, lottie }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const maxW = W - SAFE_X * 2;
  return (
    <>
      {(Object.keys(boxes) as Zone[]).map((z) => {
        const zr = rows[z];
        if (!zr || zr.length === 0) return null;
        const box = boxes[z];
        return (
          <div key={z} style={{ position: 'absolute', left: SAFE_X, right: SAFE_X, top: box.top, height: box.height, display: 'flex',
            flexDirection: 'column', alignItems: 'center', justifyContent: box.justify, gap: 26 }}>
            {zr.map((row, ri) => (
              <div key={ri} style={{ display: 'grid', justifyItems: 'center', alignItems: 'center', maxWidth: maxW }}>
                {row.map((p) => {
                  const active = frame >= p.s && frame < p.e;
                  const R = RENDER[p.it.t] ?? RENDER.headline;
                  const out = active ? interpolate(frame, [p.e - EXIT, p.e], [1, 0], clamp) : 1;
                  const idle = active ? breathe(frame, frame - p.s, p.key, (p.e - p.s) / fps) : '';
                  return (
                    <div key={p.key} style={{ gridArea: '1 / 1', visibility: active ? 'visible' : 'hidden', transform: idle || undefined }}>
                      <R it={p.it} f={active ? frame - p.s : 0} out={out} i={p.key} ink={ink} accent={accent} maxW={maxW} surface={surface} style={style} lottie={lottie} />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
};

// Gentle organic idle motion (@remotion/noise) for stickers that stay on screen
// a while, so nothing sits frozen — eases in after the entry animation.
export const breathe = (frame: number, f: number, key: number, lifeSec: number) => {
  const k = lifeSec > 1.2 ? interpolate(f, [12, 26], [0, 1], clamp) : 0;
  if (k <= 0) return '';
  const s = 1 + 0.022 * k * noise2D(`s${key}`, frame / 42, 0);
  const r = 1.5 * k * noise2D(`r${key}`, frame / 58, 1);
  const y = 7 * k * noise2D(`y${key}`, frame / 50, 2);
  return `translateY(${y.toFixed(2)}px) scale(${s.toFixed(4)}) rotate(${r.toFixed(3)}deg)`;
};

// ── Edit Video: one fixed, face-aware slot per sticker (layout.ts) ──────────
export const SlotStack: React.FC<{
  placed: Placed[]; slots: Map<number, Slot>; ink: string; accent: string; style?: Style; lottie?: LottieMap;
}> = ({ placed, slots, ink, accent, style, lottie }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const maxW = W - SAFE_X * 2;
  return (
    <>
      {placed.map((p) => {
        if (frame < p.s || frame >= p.e) return null;
        const slot = slots.get(p.key);
        if (!slot) return null;
        const R = RENDER[p.it.t] ?? RENDER.headline;
        const f = frame - p.s;
        const out = interpolate(frame, [p.e - EXIT, p.e], [1, 0], clamp);
        return (
          <div key={p.key} style={{ position: 'absolute', left: SAFE_X, right: SAFE_X, top: slot.y, display: 'flex', justifyContent: 'center' }}>
            <div style={{ transform: `scale(${slot.scale}) ${breathe(frame, f, p.key, (p.e - p.s) / fps)}`, transformOrigin: 'top center' }}>
              <R it={p.it} f={f} out={out} i={p.key} ink={ink} accent={accent} maxW={maxW} surface="dark" style={style} lottie={lottie} />
            </div>
          </div>
        );
      })}
    </>
  );
};

// ── sfx ───────────────────────────────────────────────────────────────────────
export const SfxTrack: React.FC<{ events: SfxEvent[] }> = ({ events }) => (
  <>
    {events.map((ev, k) => (
      <Sequence key={k} from={Math.max(0, ev.frame)} durationInFrames={ev.len} layout="none">
        <Audio src={ev.src} volume={ev.vol} />
      </Sequence>
    ))}
  </>
);

// ── captions ──────────────────────────────────────────────────────────────────
/** `gi` = index of the word in the full transcript (for keyword colours). */
type PWord = Word & { gi: number };
type Page = { words: PWord[]; start: number; end: number };

// Split timed words into short caption pages: max `maxWords`, and break early
// on sentence punctuation or a pause, never across `breaks` (line boundaries).
export const toPages = (words: Word[], maxWords: number, breaks: Set<number> = new Set()): Page[] => {
  const pages: Page[] = [];
  let cur: PWord[] = [];
  const flush = () => { if (cur.length) { pages.push({ words: cur, start: cur[0].t, end: 0 }); cur = []; } };
  words.forEach((w, k) => {
    if (breaks.has(k)) flush();
    const prev = words[k - 1];
    if (cur.length && prev && w.t - (prev.e ?? prev.t + 0.3) > 0.55) flush();
    cur.push({ ...w, gi: k });
    if (cur.length >= maxWords || /[.!?…,;:]$/.test(w.w)) flush();
  });
  flush();
  pages.forEach((p, k) => {
    const last = p.words[p.words.length - 1];
    const naturalEnd = (last.e ?? last.t + 0.35) + 0.25;
    p.end = k + 1 < pages.length ? Math.min(pages[k + 1].start, naturalEnd + 0.6) : naturalEnd + 0.4;
  });
  return pages;
};

const KEY_COLOR: Record<KeyColor, string> = { benefit: '#4ade80', price: '#FFD93B', pain: '#f87171', brand: '#ffffff', accent: '#ffffff' };

// TikTok's own text style: black words on a white box that hugs each line
// with rounded corners (@remotion/layout-utils measures the real font,
// @remotion/rounded-text-box draws the outline). Current word in the accent.
const TT_FONT = 64;
const TT_PAD = 26;
const TT_LINE = Math.round(TT_FONT * 1.18);
// Canvas text metrics with the font as loaded right now (measureText from
// @remotion/layout-utils caches its first answer, which can predate the
// Google font finishing loading → a box narrower than the text).
let ttCtx: CanvasRenderingContext2D | null = null;
const ttWidth = (text: string) => {
  if (!ttCtx && typeof document !== 'undefined') ttCtx = document.createElement('canvas').getContext('2d');
  if (!ttCtx) return text.length * TT_FONT * 0.6;
  ttCtx.font = `800 ${TT_FONT}px ${F.caption}`;
  return ttCtx.measureText(text).width;
};
const TikTokCaption: React.FC<{ page: Page; cur: number; centerY: number; hi: string; inS: number; taped: Set<number> }> = ({ page, cur, centerY, hi, inS, taped }) => {
  const shown = page.words.map((w) => (taped.has(w.gi) ? '▇▇▇' : w.w));
  const maxLine = W - 220;
  const lines: number[][] = [[]];
  let width = 0;
  const spaceW = ttWidth(' ');
  shown.forEach((txt, k) => {
    const ww = ttWidth(txt);
    const add = (lines[lines.length - 1].length ? spaceW : 0) + ww;
    if (lines[lines.length - 1].length && width + add > maxLine) { lines.push([k]); width = ww; } else { lines[lines.length - 1].push(k); width += add; }
  });
  const dims = lines.map((ln) => ({ width: ttWidth(ln.map((k) => shown[k]).join(' ')), height: TT_LINE }));
  const box = createRoundedTextBox({ textMeasurements: dims, textAlign: 'center', horizontalPadding: TT_PAD, borderRadius: 22 });
  const bw = box.boundingBox.width;
  const bh = box.boundingBox.height;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: (W - bw) / 2, top: centerY - bh / 2, width: bw, height: bh,
        transform: `scale(${0.9 + 0.1 * inS})`, transformOrigin: 'center' }}>
        <svg width={bw} height={bh} viewBox={box.boundingBox.viewBox} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          <path d={box.d} fill="#ffffff" />
        </svg>
        <div style={{ position: 'relative', width: bw, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {lines.map((ln, li) => (
            <div key={li} style={{ height: dims[li].height, width: dims[li].width + TT_PAD * 2, textAlign: 'center', fontFamily: F.caption, fontWeight: 800,
              fontSize: TT_FONT, lineHeight: `${dims[li].height}px`, whiteSpace: 'pre' }}>
              {ln.map((k, j) => (
                <span key={k} style={{ color: taped.has(page.words[k].gi) ? '#d9ccaa' : k === cur ? hi : '#111111' }}>
                  {(j ? ' ' : '') + shown[k]}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Captions: React.FC<{
  pages: Page[]; style: CaptionStyle; accent: string; centerY: number; hideFrom?: number; hiOverride?: string;
  keywords?: CaptionKey[]; lottie?: LottieMap; gempak?: boolean;
  /** Word indices muted by the TikTok guard — shown as a strip of tape. */
  censor?: number[];
}> = ({ pages, style, accent, centerY, hideFrom, hiOverride, keywords, lottie, gempak, censor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (hideFrom !== undefined && frame >= hideFrom) return null;
  const t = frame / fps;
  const page = pages.find((p) => t >= p.start - 0.06 && t < p.end);
  if (!page) return null;
  const hi = hiOverride ?? highlight(accent);
  const keyOf = new Map<number, CaptionKey>((keywords ?? []).map((k) => [k.i, k]));
  const taped = new Set(censor ?? []);
  const text = page.words.map((w) => w.w).join(' ');
  const size = fitSize(text.toUpperCase(), 92, W - 150, 2, 0.7, 40);
  const pf = Math.round((t - page.start) * fps);
  const inS = popS(pf + 2, fps, 320, 16);
  let cur = -1;
  page.words.forEach((w, k) => { if (t >= w.t - 0.02) cur = k; });
  if (style === 'tiktok') return <TikTokCaption page={page} cur={cur} centerY={centerY} hi={hi} inS={inS} taped={taped} />;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: 60, right: 60, top: centerY, transform: `translateY(-50%) scale(${0.88 + 0.12 * inS})`,
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', columnGap: size * 0.42, rowGap: size * 0.1 }}>
        {page.words.map((w, k) => {
          const spoken = k <= cur;
          const isCur = k === cur;
          const ws = popS(Math.round((t - w.t) * fps), fps, gempak ? 420 : 380, gempak ? 11 : 14);
          if (taped.has(w.gi)) {
            // Same footprint as the word, so the line doesn't reflow — the
            // word itself never reaches the frame.
            const tw = Math.max(size * 1.4, w.w.length * size * 0.62);
            return (
              <span key={k} style={{ display: 'inline-block', width: tw, height: size * 0.95, verticalAlign: 'middle',
                transform: `rotate(${(w.gi % 3) - 1.5}deg) scale(${spoken ? 0.9 + 0.1 * ws : 0.9})` }}>
                <TapeStrip w={tw} h={size * 0.95} seed={w.gi + 3} />
              </span>
            );
          }
          const key = keyOf.get(w.gi);
          const keyCol = key ? (key.color === 'brand' || key.color === 'accent' ? hi : KEY_COLOR[key.color]) : null;
          const emoji = key?.emoji && spoken ? (
            <span style={{ display: 'inline-block', marginLeft: size * 0.12, verticalAlign: 'middle', transform: `scale(${ws})` }}>
              <LottieEmoji char={key.emoji} size={size * 1.05} lottie={lottie} />
            </span>
          ) : null;
          const base: React.CSSProperties = {
            display: 'inline-block', fontFamily: F.caption, fontWeight: 900, fontSize: size, lineHeight: 1.08, textTransform: 'uppercase',
            letterSpacing: -0.5, WebkitTextStroke: `${Math.max(8, Math.round(size / 7))}px #000`, paintOrder: 'stroke fill',
          } as React.CSSProperties;
          if (style === 'box') {
            return (
              <span key={k} style={{ ...base, WebkitTextStroke: isCur ? '0px' : base.WebkitTextStroke, color: isCur ? '#111' : keyCol ?? '#fff',
                background: isCur ? (keyCol ?? hi) : 'transparent', borderRadius: 14, padding: '0 14px',
                transform: `scale(${isCur ? 1 + 0.08 * ws : 1}) rotate(${isCur ? -2 : 0}deg)` } as React.CSSProperties}>{w.w}{emoji}</span>
            );
          }
          return (
            <span key={k} style={{ ...base, color: keyCol && spoken ? keyCol : isCur ? hi : '#fff', opacity: style === 'karaoke' && !spoken ? 0.38 : 1,
              transform: `translateY(${spoken ? (1 - ws) * 10 : 0}px) scale(${isCur ? 1 + (gempak ? 0.09 : 0.06) * ws : 1}) rotate(${isCur && gempak ? -2 : 0}deg)`,
              transformOrigin: 'center bottom' }}>{w.w}{emoji}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ── backgrounds (no CSS blur filters — software GL renders those slowly) ─────
export const Background: React.FC<{ bg: Bg; accent: string; blurUrl?: string }> = ({ bg, accent, blurUrl }) => {
  const frame = useCurrentFrame();
  if (bg === 'blur' && blurUrl) {
    return (
      <AbsoluteFill style={{ background: '#000' }}>
        <Img src={blurUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${1.05 + frame * 0.0003})` }} />
        <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 100%)' }} />
      </AbsoluteFill>
    );
  }
  if (bg === 'paper') {
    return (
      <AbsoluteFill style={{ background: '#F5F2EA' }}>
        <AbsoluteFill style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,0.09) 2px, transparent 2.5px)', backgroundSize: '44px 44px' }} />
        <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(255,255,255,0.6) 0%, rgba(0,0,0,0) 60%, rgba(60,40,10,0.14) 100%)' }} />
      </AbsoluteFill>
    );
  }
  if (bg === 'dark') {
    const x = 50 + Math.sin(frame / 70) * 18;
    const y = 42 + Math.cos(frame / 90) * 12;
    return (
      <AbsoluteFill style={{ background: '#0b0b10' }}>
        <AbsoluteFill style={{ background: `radial-gradient(circle at ${x}% ${y}%, ${shade(accent, 0.75)} 0%, rgba(0,0,0,0) 46%)`, opacity: 0.55 }} />
        <AbsoluteFill style={{ background: `radial-gradient(circle at ${100 - x}% ${100 - y}%, ${shade(accent, 0.45)} 0%, rgba(0,0,0,0) 40%)`, opacity: 0.45 }} />
      </AbsoluteFill>
    );
  }
  if (bg === 'accent') {
    return (
      <AbsoluteFill style={{ background: `linear-gradient(160deg, ${accent} 0%, ${shade(accent, 0.62)} 100%)` }}>
        <AbsoluteFill style={{ backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.07) 0 26px, transparent 26px 64px)',
          backgroundPosition: `${frame * 0.6}px 0` }} />
      </AbsoluteFill>
    );
  }
  // mat — green cutting mat (the Ad1 look)
  return (
    <AbsoluteFill style={{ background: '#136C4F' }}>
      <AbsoluteFill style={{
        backgroundImage: [
          'linear-gradient(rgba(255,255,255,0.13) 2px, transparent 2px)',
          'linear-gradient(90deg, rgba(255,255,255,0.13) 2px, transparent 2px)',
          'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)',
          'linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
        ].join(','),
        backgroundSize: '135px 135px, 135px 135px, 27px 27px, 27px 27px',
        backgroundPosition: '-2px -2px, -2px -2px, -1px -1px, -1px -1px',
      }} />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 42%, rgba(60,150,110,0.28) 0%, rgba(0,0,0,0) 55%, rgba(0,20,10,0.42) 100%)' }} />
    </AbsoluteFill>
  );
};

export const inkForBg = (bg: Bg, accent: string): string => {
  if (bg === 'paper') return '#1f2937';
  if (bg === 'accent') return inkOn(accent);
  return '#ffffff';
};
