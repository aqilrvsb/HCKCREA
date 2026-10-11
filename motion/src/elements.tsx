// Scrapbook element library, ported from peningbot-promo Ad1 and adapted to
// flow layout: no element takes x/y — the zone stack positions it. Text is
// auto-fitted so an LLM-written line can't overflow the frame.
import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { F, TONE, clamp, fitSize, inkOn, lum, popS, tilt } from './lib';
import type { Item, ItemType } from './types';

export type ElProps = {
  it: Item;
  /** Frames since the element's cue (≥ 0 while visible). */
  f: number;
  /** Exit factor 1 → 0 over the last EXIT frames. */
  out: number;
  i: number;
  /** Colour for bare marker / tick strokes on the current background. */
  ink: string;
  accent: string;
  maxW: number;
  /** What the element sits on — picks colours that stay visible. */
  surface: 'dark' | 'light' | 'accent';
};

const NOTE_Y = '#FFE45C';
const NOTE_W = '#F7F4EC';
const PAPER = '#F5F2EA';

const Headline: React.FC<ElProps> = ({ it, f, out, i, accent, maxW, surface }) => {
  const { fps } = useVideoConfig();
  const s = popS(f, fps, 260, 11);
  const text = it.text ?? '';
  const size = fitSize(text, 108, maxW - 70, 2, 0.68);
  const tone = TONE(it.tone, accent, surface === 'accent' && lum(accent) > 0.5 ? 'dark' : 'yellow');
  return (
    <div style={{
      transform: `rotate(${tilt(i) + (1 - s) * 4}deg) scale(${(1.35 - 0.35 * s) * (0.85 + 0.15 * out)})`,
      opacity: Math.min(1, f / 2) * out, background: tone.bg, color: tone.fg,
      padding: `${size * 0.08}px ${size * 0.26}px`, fontFamily: F.black, fontSize: size, lineHeight: 1.06,
      letterSpacing: -1, textAlign: 'center', maxWidth: maxW, boxShadow: '0 12px 22px rgba(0,0,0,0.32)',
    }}>
      {text}
    </div>
  );
};

const DrawMark: React.FC<{ f: number; kind: 'check' | 'cross'; size: number; style?: React.CSSProperties }> = ({ f, kind, size, style }) => {
  const p = interpolate(f, [6, 14], [0, 1], clamp);
  const color = kind === 'check' ? '#15803d' : '#dc2626';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute', ...style }}>
      {kind === 'check' ? (
        <path d="M14 54 L40 80 L88 18" fill="none" stroke={color} strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
      ) : (
        <>
          <path d="M20 20 L80 80" fill="none" stroke={color} strokeWidth={13} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - Math.min(1, p * 2)} />
          <path d="M80 20 L20 80" fill="none" stroke={color} strokeWidth={13} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - Math.max(0, p * 2 - 1)} />
        </>
      )}
    </svg>
  );
};

const Note: React.FC<ElProps> = ({ it, f, out, i, maxW }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = popS(f, fps, 200, 12);
  const text = it.text ?? '';
  const w = Math.min(maxW, Math.max(360, Math.min(600, 250 + text.length * 9)));
  const size = fitSize(text, 62, w - 44, 4, 0.48);
  const bg = it.tone === 'white' ? NOTE_W : NOTE_Y;
  const strikeP = interpolate(f, [8, 16], [0, 1], clamp);
  const sway = Math.sin((frame + i * 37) / 38) * 0.5;
  return (
    <div style={{
      position: 'relative', width: w, minHeight: Math.round(w * 0.62),
      transform: `translateY(${(1 - s) * -40}px) rotate(${tilt(i, 3) + (1 - s) * 8 + sway}deg) scale(${(1.15 - 0.15 * s) * (0.85 + 0.15 * out)})`,
      opacity: Math.min(1, f / 3) * out,
    }}>
      <div style={{ position: 'absolute', inset: 0, background: bg, boxShadow: '0 14px 20px rgba(0,0,0,0.32)',
        backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.25), rgba(0,0,0,0) 40%, rgba(0,0,0,0.07))' }} />
      <div style={{ position: 'absolute', top: -9, left: w / 2 - 10, width: 20, height: 20, borderRadius: 10,
        background: 'radial-gradient(circle at 35% 35%, #ff8a8a, #d61f1f 60%, #8b0000)', boxShadow: '0 3px 4px rgba(0,0,0,0.35)' }} />
      <div style={{ position: 'relative', padding: '26px 22px 22px', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', textAlign: 'center', fontFamily: F.hand, fontSize: size, lineHeight: 1.05, color: '#1f2937', minHeight: Math.round(w * 0.62) }}>
        <div>{text}</div>
        {it.sub && (
          <div style={{ position: 'relative', fontSize: size * 1.2, marginTop: 6, color: '#374151' }}>
            {it.sub}
            <div style={{ position: 'absolute', left: -6, right: -6, top: '52%', height: 5, background: '#dc2626', borderRadius: 3,
              transformOrigin: 'left', transform: `scaleX(${strikeP}) rotate(-6deg)` }} />
          </div>
        )}
      </div>
      {it.mark && <DrawMark f={f} kind={it.mark} size={96} style={{ right: -30, bottom: -26 }} />}
    </div>
  );
};

const Tag: React.FC<ElProps> = ({ it, f, out, i, accent, maxW }) => {
  const { fps } = useVideoConfig();
  const s = popS(f, fps, 300, 10);
  const text = it.text ?? '';
  const size = fitSize(text, 54, maxW - 60, 1, 0.66);
  const tone = TONE(it.tone, accent, 'red');
  return (
    <div style={{ transform: `rotate(${tilt(i, 5) - 2}deg) scale(${(1.6 - 0.6 * s) * (0.85 + 0.15 * out)})`,
      opacity: Math.min(1, f / 2) * out, background: tone.bg, color: tone.fg, fontFamily: F.black, fontSize: size,
      padding: '4px 22px', letterSpacing: 1, boxShadow: '0 8px 14px rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>
      {text}
    </div>
  );
};

const Stamp: React.FC<ElProps> = ({ it, f, out, i, accent, maxW }) => {
  const { fps } = useVideoConfig();
  const s = popS(f, fps, 320, 9);
  const text = it.text ?? '';
  const size = fitSize(text, 118, maxW - 120, 1, 0.72);
  const c = TONE(it.tone, accent, 'red').bg;
  return (
    <div style={{ transform: `rotate(${tilt(i, 4) - 6}deg) scale(${(2.2 - 1.2 * s) * (0.85 + 0.15 * out)})`,
      opacity: Math.min(1, f / 2) * out, border: `10px solid ${c}`, borderRadius: 18, color: c, background: 'rgba(255,255,255,0.93)',
      fontFamily: F.black, fontSize: size, padding: '0 30px', letterSpacing: 2, boxShadow: '0 10px 18px rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>
      {text}
    </div>
  );
};

const Chip: React.FC<ElProps> = ({ it, f, out, i, accent, maxW }) => {
  const { fps } = useVideoConfig();
  const s = popS(f, fps, 240, 12);
  const text = it.text ?? '';
  const size = fitSize(text, 52, maxW - 120, 1, 0.58);
  return (
    <div style={{ transform: `rotate(${tilt(i, 1.5)}deg) scale(${(1.3 - 0.3 * s) * (0.85 + 0.15 * out)})`,
      opacity: Math.min(1, f / 2) * out, background: '#fff', borderRadius: 999, padding: '12px 30px', fontFamily: F.inter, fontWeight: 800,
      fontSize: size, color: '#0f172a', boxShadow: '0 8px 14px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: 14, whiteSpace: 'nowrap' }}>
      <div style={{ width: size * 0.38, height: size * 0.38, borderRadius: 99, background: accent }} />
      {text}
    </div>
  );
};

const Tape: React.FC<ElProps> = ({ it, f, out, i, maxW }) => {
  const reveal = interpolate(f, [0, 7], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const text = it.text ?? '';
  const size = fitSize(text, 48, maxW - 80, 1, 0.6);
  return (
    <div style={{ transform: `rotate(${tilt(i, 2.5)}deg) scale(${0.9 + 0.1 * out})`, opacity: out }}>
      <div style={{ clipPath: `inset(0 ${(1 - reveal) * 100}% 0 0)`, background: PAPER, padding: '6px 26px 2px', fontFamily: F.marker,
        fontSize: size, color: '#111', whiteSpace: 'nowrap', boxShadow: '0 6px 12px rgba(0,0,0,0.28)',
        maskImage: 'linear-gradient(90deg, transparent 0, #000 6px, #000 calc(100% - 6px), transparent 100%)',
        WebkitMaskImage: 'linear-gradient(90deg, transparent 0, #000 6px, #000 calc(100% - 6px), transparent 100%)' }}>
        {text}
      </div>
    </div>
  );
};

const Scribble: React.FC<ElProps> = ({ it, f, out, i, ink, maxW }) => {
  const { fps } = useVideoConfig();
  const text = it.text ?? '';
  const size = fitSize(text, 66, maxW - 40, 2, 0.56);
  const cps = 20;
  const n = Math.min(text.length, Math.floor((Math.max(0, f) * cps) / fps) + 1);
  return (
    <div style={{ position: 'relative', transform: `rotate(${tilt(i, 2) - 1}deg)`, opacity: out, fontFamily: F.marker, fontSize: size,
      color: ink, letterSpacing: 1, textAlign: 'center', maxWidth: maxW, lineHeight: 1.12,
      textShadow: ink === '#ffffff' ? '0 3px 0 rgba(0,0,0,0.25)' : 'none' }}>
      {/* full text keeps the box size stable while the visible part types on */}
      <span style={{ visibility: 'hidden' }}>{text}</span>
      <span style={{ position: 'absolute', inset: 0 }}>{text.slice(0, n)}</span>
    </div>
  );
};

const Rays: React.FC<{ p: number; r: number; color: string; clearTop: boolean }> = ({ p, r, color, clearTop }) => {
  const rays = clearTop ? [-170, -150, -30, -10, 20, 45, 135, 160] : [-160, -135, -110, -70, -45, -20, 20, 45, 135, 160];
  return (
    <svg width={r * 2} height={r * 2} style={{ position: 'absolute', left: '50%', top: '50%', marginLeft: -r, marginTop: -r, overflow: 'visible' }}>
      {rays.map((a, k) => {
        const rad = (a * Math.PI) / 180;
        const r1 = r * (0.8 + 0.08 * (k % 2));
        const r2 = r1 + 54 * p;
        return <line key={k} x1={r + Math.cos(rad) * r1} y1={r + Math.sin(rad) * r1} x2={r + Math.cos(rad) * r2} y2={r + Math.sin(rad) * r2}
          stroke={color} strokeWidth={8} strokeLinecap="round" opacity={p} />;
      })}
    </svg>
  );
};

const Price: React.FC<ElProps> = ({ it, f, out, accent, ink, maxW }) => {
  const { fps } = useVideoConfig();
  const s = popS(f - 4, fps, 220, 10);
  const strikeP = interpolate(f, [2, 9], [0, 1], clamp);
  const raysP = interpolate(f, [4, 12], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
  const text = it.text ?? '';
  const size = fitSize(text, 170, maxW - 80, 1, 0.66);
  const tone = TONE(it.tone, accent, 'yellow');
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: Math.min(1, f / 2) * out }}>
      {it.sub && (
        <div style={{ position: 'relative', fontFamily: F.black, fontSize: size * 0.34, color: ink, opacity: 0.85, marginBottom: 6 }}>
          {it.sub}
          <div style={{ position: 'absolute', left: -8, right: -8, top: '50%', height: 7, background: '#dc2626', borderRadius: 4,
            transformOrigin: 'left', transform: `scaleX(${strikeP}) rotate(-5deg)` }} />
        </div>
      )}
      <div style={{ position: 'relative', transform: `scale(${(0.4 + 0.6 * s) * (0.85 + 0.15 * out)}) rotate(-3deg)` }}>
        <Rays p={raysP} r={size * 1.25} color={ink} clearTop={!!it.sub} />
        <div style={{ position: 'relative', background: tone.bg, color: tone.fg, fontFamily: F.black, fontSize: size, lineHeight: 1,
          padding: `${size * 0.1}px ${size * 0.22}px`, borderRadius: 14, boxShadow: '0 16px 30px rgba(0,0,0,0.35)', whiteSpace: 'nowrap' }}>
          {text}
        </div>
      </div>
    </div>
  );
};

const Check: React.FC<ElProps> = ({ it, f, out, i, ink, accent, maxW, surface }) => {
  const { fps } = useVideoConfig();
  const s = popS(f, fps, 220, 13);
  const p = interpolate(f, [3, 11], [0, 1], clamp);
  const text = it.text ?? '';
  const size = fitSize(text, 62, maxW - 130, 2, 0.55);
  const isCross = it.mark === 'cross';
  const box = isCross ? '#dc2626' : surface === 'accent' ? '#111111' : accent;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22, maxWidth: maxW, opacity: Math.min(1, f / 2) * out,
      transform: `translateX(${(1 - s) * -60}px) rotate(${tilt(i, 0.8)}deg)` }}>
      <div style={{ flex: '0 0 auto', width: size * 1.25, height: size * 1.25, borderRadius: 14, background: box, display: 'flex',
        alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 12px rgba(0,0,0,0.3)' }}>
        <svg width={size} height={size} viewBox="0 0 100 100">
          {isCross ? (
            <>
              <path d="M22 22 L78 78" fill="none" stroke="#fff" strokeWidth={15} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - Math.min(1, p * 2)} />
              <path d="M78 22 L22 78" fill="none" stroke="#fff" strokeWidth={15} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - Math.max(0, p * 2 - 1)} />
            </>
          ) : (
            <path d="M16 54 L40 78 L86 22" fill="none" stroke={inkOn(box)} strokeWidth={15} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
          )}
        </svg>
      </div>
      <div style={{ fontFamily: F.inter, fontWeight: 900, fontSize: size, color: ink, lineHeight: 1.1, letterSpacing: -0.5,
        textShadow: ink === '#ffffff' ? '0 4px 14px rgba(0,0,0,0.45)' : 'none' }}>{text}</div>
    </div>
  );
};

const Emoji: React.FC<ElProps> = ({ it, f, out }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = popS(f, fps, 260, 8);
  const wob = Math.sin(frame / 7) * 5;
  return (
    <div style={{ fontSize: 190, lineHeight: 1, opacity: Math.min(1, f / 2) * out,
      transform: `scale(${(0.2 + 0.8 * s) * (0.85 + 0.15 * out)}) rotate(${wob}deg)` }}>
      {(it.text ?? '✨').slice(0, 8)}
    </div>
  );
};

const Counter: React.FC<ElProps> = ({ it, f, out, ink, accent, maxW, surface }) => {
  const { fps } = useVideoConfig();
  const text = it.text ?? '';
  const m = text.match(/(\d[\d,]*\.?\d*)/);
  const num = m ? parseFloat(m[1].replace(/,/g, '')) : 0;
  const dec = m && m[1].includes('.') ? m[1].split('.')[1].length : 0;
  const p = interpolate(f, [0, 22], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const shown = m
    ? text.replace(m[1], (num * p).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }))
    : text;
  const size = fitSize(text, 150, maxW - 40, 1, 0.66);
  const s = popS(f, fps, 240, 12);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: Math.min(1, f / 2) * out,
      transform: `scale(${(0.7 + 0.3 * s) * (0.85 + 0.15 * out)})` }}>
      <div style={{ fontFamily: F.black, fontSize: size, color: TONE(it.tone, accent, surface === 'accent' ? 'yellow' : 'accent').bg, lineHeight: 1,
        WebkitTextStroke: `${Math.round(size / 18)}px #111`, paintOrder: 'stroke fill', fontVariantNumeric: 'tabular-nums' } as React.CSSProperties}>
        {/* reserve final width so the zone doesn't jitter while counting */}
        <span style={{ display: 'inline-grid' }}>
          <span style={{ gridArea: '1/1', visibility: 'hidden' }}>{text}</span>
          <span style={{ gridArea: '1/1', textAlign: 'center' }}>{shown}</span>
        </span>
      </div>
      {it.sub && <div style={{ fontFamily: F.inter, fontWeight: 800, fontSize: size * 0.3, color: ink, marginTop: 6 }}>{it.sub}</div>}
    </div>
  );
};

export const RENDER: Record<ItemType, React.FC<ElProps>> = {
  headline: Headline, note: Note, tag: Tag, stamp: Stamp, chip: Chip, tape: Tape, scribble: Scribble,
  price: Price, check: Check, emoji: Emoji, counter: Counter,
};
