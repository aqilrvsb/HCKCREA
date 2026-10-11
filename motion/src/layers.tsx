import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { RENDER } from './elements';
import { EXIT, F, SAFE_X, W, clamp, fitSize, highlight, inkOn, popS, shade, type Row, type SfxEvent } from './lib';
import type { Bg, CaptionStyle, Word, Zone } from './types';

// ── zones ─────────────────────────────────────────────────────────────────────
export type ZoneBoxes = Record<Zone, { top: number; height: number; justify: 'flex-start' | 'center' | 'flex-end' }>;

// Renders every zone as a column of rows. Each row is a 1×1 grid: all of its
// items sit in the same cell (sized to the biggest), inactive ones hidden — so
// positions are fixed for the whole scene and nothing jumps.
export const ZoneStack: React.FC<{ rows: Record<Zone, Row[]>; boxes: ZoneBoxes; ink: string; accent: string; surface: 'dark' | 'light' | 'accent' }> = ({ rows, boxes, ink, accent, surface }) => {
  const frame = useCurrentFrame();
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
                  return (
                    <div key={p.key} style={{ gridArea: '1 / 1', visibility: active ? 'visible' : 'hidden' }}>
                      <R it={p.it} f={active ? frame - p.s : 0} out={out} i={p.key} ink={ink} accent={accent} maxW={maxW} surface={surface} />
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

// ── sfx ───────────────────────────────────────────────────────────────────────
export const SfxTrack: React.FC<{ events: SfxEvent[] }> = ({ events }) => (
  <>
    {events.map((ev, k) => (
      <Sequence key={k} from={Math.max(0, ev.frame)} durationInFrames={ev.len} layout="none">
        <Audio src={staticFile(`sfx/${ev.name}.wav`)} volume={ev.vol} />
      </Sequence>
    ))}
  </>
);

// ── captions ──────────────────────────────────────────────────────────────────
type Page = { words: Word[]; start: number; end: number };

// Split timed words into short caption pages: max `maxWords`, and break early
// on sentence punctuation or a pause, never across `breaks` (line boundaries).
export const toPages = (words: Word[], maxWords: number, breaks: Set<number> = new Set()): Page[] => {
  const pages: Page[] = [];
  let cur: Word[] = [];
  const flush = () => { if (cur.length) { pages.push({ words: cur, start: cur[0].t, end: 0 }); cur = []; } };
  words.forEach((w, k) => {
    if (breaks.has(k)) flush();
    const prev = words[k - 1];
    if (cur.length && prev && w.t - (prev.e ?? prev.t + 0.3) > 0.55) flush();
    cur.push(w);
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

export const Captions: React.FC<{
  pages: Page[]; style: CaptionStyle; accent: string; centerY: number; hideFrom?: number; hiOverride?: string;
}> = ({ pages, style, accent, centerY, hideFrom, hiOverride }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (hideFrom !== undefined && frame >= hideFrom) return null;
  const t = frame / fps;
  const page = pages.find((p) => t >= p.start - 0.06 && t < p.end);
  if (!page) return null;
  const hi = hiOverride ?? highlight(accent);
  const text = page.words.map((w) => w.w).join(' ');
  const size = fitSize(text.toUpperCase(), 92, W - 150, 2, 0.7, 40);
  const pf = Math.round((t - page.start) * fps);
  const inS = popS(pf + 2, fps, 320, 16);
  let cur = -1;
  page.words.forEach((w, k) => { if (t >= w.t - 0.02) cur = k; });
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: 60, right: 60, top: centerY, transform: `translateY(-50%) scale(${0.88 + 0.12 * inS})`,
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', columnGap: size * 0.42, rowGap: size * 0.1 }}>
        {page.words.map((w, k) => {
          const spoken = k <= cur;
          const isCur = k === cur;
          const ws = popS(Math.round((t - w.t) * fps), fps, 380, 14);
          const base: React.CSSProperties = {
            display: 'inline-block', fontFamily: F.caption, fontWeight: 900, fontSize: size, lineHeight: 1.08, textTransform: 'uppercase',
            letterSpacing: -0.5, WebkitTextStroke: `${Math.max(8, Math.round(size / 7))}px #000`, paintOrder: 'stroke fill',
          } as React.CSSProperties;
          if (style === 'box') {
            return (
              <span key={k} style={{ ...base, WebkitTextStroke: isCur ? '0px' : base.WebkitTextStroke, color: isCur ? '#111' : '#fff',
                background: isCur ? hi : 'transparent', borderRadius: 14, padding: '0 14px',
                transform: `scale(${isCur ? 1 + 0.08 * ws : 1}) rotate(${isCur ? -2 : 0}deg)` } as React.CSSProperties}>{w.w}</span>
            );
          }
          return (
            <span key={k} style={{ ...base, color: isCur ? hi : '#fff', opacity: style === 'karaoke' && !spoken ? 0.38 : 1,
              transform: `translateY(${spoken ? (1 - ws) * 10 : 0}px) scale(${isCur ? 1 + 0.06 * ws : 1})`, transformOrigin: 'center bottom' }}>{w.w}</span>
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
