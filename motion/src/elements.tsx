// Element library. No element takes x/y — the zone stack positions it. Text
// is auto-fitted so an LLM-written line can't overflow the frame. Shadows are
// HARD offsets (no blur): blurred shadows are the slowest thing to paint on a
// CPU renderer and the hard look is the scrapbook / TikTok-sticker style anyway.
import React from 'react';
import { AnimatedImage, interpolate, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { Burst } from './effects';
import { LottieEmoji } from './emoji';
import { F, TONE, clamp, fitSize, inkOn, lum, popS, tilt } from './lib';
import type { Item, ItemType, LottieMap, Style } from './types';

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
  style?: Style;
  lottie?: LottieMap;
};

const NOTE_Y = '#FFE45C';
const NOTE_W = '#F7F4EC';
const PAPER = '#F5F2EA';
const HARD = '8px 10px 0 rgba(0,0,0,0.38)';
const HARD_S = '5px 6px 0 rgba(0,0,0,0.35)';
const CONFETTI = (accent: string) => ['#FFD93B', '#ffffff', accent, '#ff5c8a', '#22c55e'];

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
      letterSpacing: -1, textAlign: 'center', maxWidth: maxW, boxShadow: HARD,
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
      <div style={{ position: 'absolute', inset: 0, background: bg, boxShadow: HARD,
        backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.25), rgba(0,0,0,0) 40%, rgba(0,0,0,0.07))' }} />
      <div style={{ position: 'absolute', top: -9, left: w / 2 - 10, width: 20, height: 20, borderRadius: 10,
        background: 'radial-gradient(circle at 35% 35%, #ff8a8a, #d61f1f 60%, #8b0000)' }} />
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
  const size = fitSize(text, 58, maxW - 60, 1, 0.66);
  const tone = TONE(it.tone, accent, 'red');
  return (
    <div style={{ transform: `rotate(${tilt(i, 5) - 2}deg) scale(${(1.6 - 0.6 * s) * (0.85 + 0.15 * out)})`,
      opacity: Math.min(1, f / 2) * out, background: tone.bg, color: tone.fg, fontFamily: F.black, fontSize: size,
      padding: '4px 22px', letterSpacing: 1, boxShadow: HARD_S, whiteSpace: 'nowrap' }}>
      {text}
    </div>
  );
};

const Stamp: React.FC<ElProps> = ({ it, f, out, i, accent, maxW }) => {
  const { fps } = useVideoConfig();
  const s = popS(f, fps, 320, 9);
  const text = it.text ?? '';
  const size = fitSize(text, 124, maxW - 120, 1, 0.72);
  const c = TONE(it.tone, accent, 'red').bg;
  return (
    <div style={{ transform: `rotate(${tilt(i, 4) - 6}deg) scale(${(2.2 - 1.2 * s) * (0.85 + 0.15 * out)})`,
      opacity: Math.min(1, f / 2) * out, border: `10px solid ${c}`, borderRadius: 18, color: c, background: 'rgba(255,255,255,0.94)',
      fontFamily: F.black, fontSize: size, padding: '0 30px', letterSpacing: 2, boxShadow: HARD, whiteSpace: 'nowrap' }}>
      {text}
    </div>
  );
};

const Chip: React.FC<ElProps> = ({ it, f, out, i, accent, maxW }) => {
  const { fps } = useVideoConfig();
  const s = popS(f, fps, 240, 12);
  const text = it.text ?? '';
  const size = fitSize(text, 54, maxW - 120, 1, 0.58);
  return (
    <div style={{ transform: `translateX(${(1 - s) * (i % 2 ? 160 : -160)}px) rotate(${tilt(i, 1.5)}deg) scale(${0.85 + 0.15 * out})`,
      opacity: Math.min(1, f / 2) * out, background: '#fff', borderRadius: 999, padding: '12px 30px', fontFamily: F.inter, fontWeight: 800,
      fontSize: size, color: '#0f172a', boxShadow: HARD_S, display: 'flex', alignItems: 'center', gap: 14, whiteSpace: 'nowrap' }}>
      <div style={{ width: size * 0.38, height: size * 0.38, borderRadius: 99, background: accent }} />
      {text}
    </div>
  );
};

const Tape: React.FC<ElProps> = ({ it, f, out, i, maxW }) => {
  const reveal = interpolate(f, [0, 7], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const text = it.text ?? '';
  const size = fitSize(text, 50, maxW - 80, 1, 0.6);
  return (
    <div style={{ transform: `rotate(${tilt(i, 2.5)}deg) scale(${0.9 + 0.1 * out})`, opacity: out }}>
      <div style={{ clipPath: `inset(0 ${(1 - reveal) * 100}% 0 0)`, background: PAPER, padding: '6px 26px 2px', fontFamily: F.marker,
        fontSize: size, color: '#111', whiteSpace: 'nowrap', boxShadow: HARD_S }}>
        {text}
      </div>
    </div>
  );
};

const Scribble: React.FC<ElProps> = ({ it, f, out, i, ink, maxW }) => {
  const { fps } = useVideoConfig();
  const text = it.text ?? '';
  const size = fitSize(text, 66, maxW - 40, 2, 0.56);
  const n = Math.min(text.length, Math.floor((Math.max(0, f) * 20) / fps) + 1);
  return (
    <div style={{ position: 'relative', transform: `rotate(${tilt(i, 2) - 1}deg)`, opacity: out, fontFamily: F.marker, fontSize: size,
      color: ink, letterSpacing: 1, textAlign: 'center', maxWidth: maxW, lineHeight: 1.12,
      textShadow: ink === '#ffffff' ? '3px 4px 0 rgba(0,0,0,0.55)' : 'none' }}>
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

// Price reveal: struck-out old price → new price slams in → rays + confetti.
const Price: React.FC<ElProps> = ({ it, f, out, accent, ink, maxW, style }) => {
  const { fps } = useVideoConfig();
  const hasOld = !!it.sub;
  const slam = hasOld ? 9 : 2;
  const s = popS(f - slam, fps, 220, 10);
  const strikeP = interpolate(f, [2, 8], [0, 1], clamp);
  const raysP = interpolate(f, [slam + 2, slam + 10], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
  const text = it.text ?? '';
  const size = fitSize(text, 176, maxW - 80, 1, 0.66);
  const tone = TONE(it.tone, accent, 'yellow');
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: Math.min(1, f / 2) * out }}>
      {hasOld && (
        <div style={{ position: 'relative', fontFamily: F.black, fontSize: size * 0.36, color: ink, opacity: 0.9, marginBottom: 6,
          textShadow: ink === '#ffffff' ? '3px 4px 0 rgba(0,0,0,0.5)' : 'none' }}>
          {it.sub}
          <div style={{ position: 'absolute', left: -8, right: -8, top: '50%', height: 8, background: '#dc2626', borderRadius: 4,
            transformOrigin: 'left', transform: `scaleX(${strikeP}) rotate(-5deg)` }} />
        </div>
      )}
      <div style={{ position: 'relative', transform: `scale(${f < slam ? 0 : (0.4 + 0.6 * s) * (0.85 + 0.15 * out)}) rotate(-3deg)` }}>
        <Rays p={raysP} r={size * 1.25} color={ink} clearTop={hasOld} />
        {style === 'gempak' && <Burst f={f - slam} colors={CONFETTI(accent)} n={20} radius={size * 1.9} seed={7} />}
        <div style={{ position: 'relative', background: tone.bg, color: tone.fg, fontFamily: F.black, fontSize: size, lineHeight: 1,
          padding: `${size * 0.1}px ${size * 0.22}px`, borderRadius: 14, boxShadow: HARD, whiteSpace: 'nowrap' }}>
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
        alignItems: 'center', justifyContent: 'center', boxShadow: HARD_S }}>
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
        textShadow: ink === '#ffffff' ? '3px 4px 0 rgba(0,0,0,0.55)' : 'none' }}>{text}</div>
    </div>
  );
};

const Emoji: React.FC<ElProps> = ({ it, f, out, accent, style, lottie }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = popS(f, fps, 260, 8);
  const wob = Math.sin(frame / 7) * 5;
  const char = Array.from(it.text ?? '✨').slice(0, 2).join('');
  return (
    <div style={{ position: 'relative', opacity: Math.min(1, f / 2) * out, transform: `scale(${(0.2 + 0.8 * s) * (0.85 + 0.15 * out)}) rotate(${wob}deg)` }}>
      {style === 'gempak' && <Burst f={f} colors={CONFETTI(accent)} n={12} radius={170} seed={3} />}
      <LottieEmoji char={char} size={230} lottie={lottie} />
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
  const shown = m ? text.replace(m[1], (num * p).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })) : text;
  const size = fitSize(text, 160, maxW - 40, 1, 0.66);
  const s = popS(f, fps, 240, 12);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: Math.min(1, f / 2) * out,
      transform: `scale(${(0.7 + 0.3 * s) * (0.85 + 0.15 * out)})` }}>
      <div style={{ fontFamily: F.black, fontSize: size, color: TONE(it.tone, accent, surface === 'accent' ? 'yellow' : 'accent').bg, lineHeight: 1,
        WebkitTextStroke: `${Math.round(size / 18)}px #111`, paintOrder: 'stroke fill', fontVariantNumeric: 'tabular-nums' } as React.CSSProperties}>
        <span style={{ display: 'inline-grid' }}>
          <span style={{ gridArea: '1/1', visibility: 'hidden' }}>{text}</span>
          <span style={{ gridArea: '1/1', textAlign: 'center' }}>{shown}</span>
        </span>
      </div>
      {it.sub && <div style={{ fontFamily: F.inter, fontWeight: 800, fontSize: size * 0.3, color: ink, marginTop: 6,
        textShadow: ink === '#ffffff' ? '3px 4px 0 rgba(0,0,0,0.55)' : 'none' }}>{it.sub}</div>}
    </div>
  );
};

// Huge kinetic word punched into the middle (1–2 words).
const BigWord: React.FC<ElProps> = ({ it, f, out, accent, maxW, style }) => {
  const { fps } = useVideoConfig();
  const s = popS(f, fps, 420, 13);
  const text = (it.text ?? '').toUpperCase();
  const size = fitSize(text, 250, maxW, 2, 0.7, 60);
  const fill = TONE(it.tone, accent, 'white').bg;
  return (
    <div style={{ position: 'relative', textAlign: 'center', opacity: Math.min(1, f / 1.5) * out,
      transform: `scale(${(2.4 - 1.4 * s) * (0.9 + 0.1 * out)}) rotate(${(1 - s) * -8 - 3}deg)` }}>
      {style === 'gempak' && <Burst f={f} colors={CONFETTI(accent)} n={18} radius={size * 2.2} seed={11} />}
      <div style={{ fontFamily: F.black, fontSize: size, lineHeight: 0.98, color: fill, letterSpacing: -2,
        WebkitTextStroke: `${Math.max(10, Math.round(size / 11))}px #111`, paintOrder: 'stroke fill',
        textShadow: `${Math.round(size / 16)}px ${Math.round(size / 13)}px 0 ${accent}` } as React.CSSProperties}>
        {text}
      </div>
    </div>
  );
};

// Speech bubble.
const Callout: React.FC<ElProps> = ({ it, f, out, i, maxW }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = popS(f, fps, 300, 10);
  const text = it.text ?? '';
  const w = Math.min(maxW, 760);
  const size = fitSize(text, 60, w - 70, 3, 0.55);
  const wig = Math.sin((frame + i * 13) / 5) * (f < 20 ? 3 : 0.8);
  const left = i % 2 === 0;
  return (
    <div style={{ position: 'relative', maxWidth: w, opacity: Math.min(1, f / 2) * out,
      transform: `scale(${(0.3 + 0.7 * s) * (0.88 + 0.12 * out)}) rotate(${wig + (left ? -2 : 2)}deg)`, transformOrigin: left ? '20% 100%' : '80% 100%' }}>
      <div style={{ background: '#fff', borderRadius: 40, padding: '22px 34px', fontFamily: F.inter, fontWeight: 900, fontSize: size,
        lineHeight: 1.1, color: '#111', boxShadow: HARD, border: '5px solid #111', textAlign: 'center' }}>{text}</div>
      <svg width={70} height={56} viewBox="0 0 70 56" style={{ position: 'absolute', bottom: -48, ...(left ? { left: 70 } : { right: 70 }) }}>
        <path d="M6 0 L64 0 L18 52 Z" fill="#fff" stroke="#111" strokeWidth={5} strokeLinejoin="round" />
        <rect x={4} y={-6} width={62} height={10} fill="#fff" />
      </svg>
    </div>
  );
};

// Hand-drawn arrow drawing on, pointing down at the subject, with a label.
const Arrow: React.FC<ElProps> = ({ it, f, out, i, ink, accent, maxW }) => {
  const p = interpolate(f, [2, 14], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const text = it.text ?? '';
  const size = fitSize(text, 62, maxW - 120, 1, 0.58);
  const flip = i % 2 === 1;
  const col = ink === '#ffffff' ? '#FFD93B' : accent;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: flip ? 'flex-end' : 'flex-start', opacity: out, minWidth: 420 }}>
      {text && (
        <div style={{ fontFamily: F.marker, fontSize: size, color: col, transform: `rotate(${flip ? 3 : -3}deg)`,
          textShadow: '3px 4px 0 rgba(0,0,0,0.6)', opacity: Math.min(1, f / 3) }}>{text}</div>
      )}
      <svg width={300} height={190} viewBox="0 0 300 190" style={{ transform: flip ? 'scaleX(-1)' : undefined, overflow: 'visible', marginTop: -6 }}>
        <path d="M30 10 C 150 10, 230 50, 240 160" fill="none" stroke={col} strokeWidth={14} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
        <path d="M205 130 L240 168 L268 122" fill="none" stroke={col} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" opacity={p > 0.92 ? 1 : 0} />
      </svg>
    </div>
  );
};

// 5-star rating row filling in one by one.
const Stars: React.FC<ElProps> = ({ it, f, out, ink, accent, style }) => {
  const { fps } = useVideoConfig();
  const label = it.text ?? '';
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, opacity: out }}>
      {style === 'gempak' && <Burst f={f - 12} colors={['#FFD93B', '#ffffff', accent]} n={14} radius={300} seed={5} />}
      <div style={{ display: 'flex', gap: 14, background: '#111', padding: '14px 24px', borderRadius: 999, boxShadow: HARD_S }}>
        {[0, 1, 2, 3, 4].map((k) => {
          const s = popS(f - k * 3, fps, 380, 10);
          return (
            <svg key={k} width={74} height={74} viewBox="0 0 24 24" style={{ transform: `scale(${s})` }}>
              <path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z" fill="#FFD93B" stroke="#b45309" strokeWidth={0.8} />
            </svg>
          );
        })}
      </div>
      {label && <div style={{ fontFamily: F.inter, fontWeight: 900, fontSize: 50, color: ink, textShadow: ink === '#ffffff' ? '3px 4px 0 rgba(0,0,0,0.55)' : 'none',
        opacity: interpolate(f, [10, 16], [0, 1], clamp) }}>{label}</div>}
    </div>
  );
};

// "Tekan beg kuning" call to action — yellow basket pill + bouncing arrow.
const Cta: React.FC<ElProps> = ({ it, f, out, accent, maxW, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = popS(f, fps, 260, 11);
  const text = it.text || 'Tekan beg kuning';
  const size = fitSize(text, 66, maxW - 200, 1, 0.58);
  const bob = Math.sin(frame / 4) * 10;
  const pulse = 1 + Math.sin(frame / 6) * 0.03;
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, opacity: Math.min(1, f / 2) * out }}>
      {style === 'gempak' && <Burst f={f} colors={CONFETTI(accent)} n={16} radius={320} seed={9} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, background: '#FFD93B', color: '#111', borderRadius: 999, padding: '18px 40px',
        fontFamily: F.black, fontSize: size, boxShadow: HARD, border: '5px solid #111', transform: `scale(${(0.3 + 0.7 * s) * pulse})`, whiteSpace: 'nowrap' }}>
        <svg width={size * 1.05} height={size * 1.05} viewBox="0 0 24 24">
          <path d="M6 8h12l-1.2 11.2a1.5 1.5 0 0 1-1.5 1.3H8.7a1.5 1.5 0 0 1-1.5-1.3z" fill="#f59e0b" stroke="#111" strokeWidth={1.6} strokeLinejoin="round" />
          <path d="M9 8V6.5a3 3 0 0 1 6 0V8" fill="none" stroke="#111" strokeWidth={1.6} strokeLinecap="round" />
        </svg>
        {text}
      </div>
      {it.sub && <div style={{ fontFamily: F.inter, fontWeight: 900, fontSize: size * 0.62, color: '#fff', textShadow: '3px 4px 0 rgba(0,0,0,0.6)' }}>{it.sub}</div>}
      <svg width={120} height={110} viewBox="0 0 120 110" style={{ transform: `translateY(${bob}px)` }}>
        <path d="M60 6 L60 80" stroke="#FFD93B" strokeWidth={16} strokeLinecap="round" />
        <path d="M24 56 L60 96 L96 56" fill="none" stroke="#FFD93B" strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

// Web fact card — dark card, icon, ≤12 words, "Sumber: domain".
const Fact: React.FC<ElProps> = ({ it, f, out, accent, maxW }) => {
  const { fps } = useVideoConfig();
  const s = popS(f, fps, 230, 13);
  const text = it.text ?? '';
  const w = Math.min(maxW, 900);
  const size = fitSize(text, 54, w - 150, 3, 0.52);
  return (
    <div style={{ display: 'flex', gap: 22, alignItems: 'center', maxWidth: w, background: 'rgba(12,12,18,0.9)',
      border: `4px solid ${accent}`, borderRadius: 28, padding: '22px 28px', boxShadow: HARD, opacity: Math.min(1, f / 2) * out,
      transform: `translateY(${(1 - s) * -70}px) scale(${0.9 + 0.1 * s})` }}>
      <div style={{ flex: '0 0 auto', width: 84, height: 84, borderRadius: 22, background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 52 }}>💡</div>
      <div>
        <div style={{ fontFamily: F.inter, fontWeight: 900, fontSize: size, color: '#fff', lineHeight: 1.12 }}>{text}</div>
        {it.sub && <div style={{ fontFamily: F.inter, fontWeight: 700, fontSize: 30, color: 'rgba(255,255,255,0.72)', marginTop: 8 }}>Sumber: {it.sub}</div>}
      </div>
    </div>
  );
};

// Deterministic hand-drawn loop: an ellipse with a wobbly radius that overshoots
// its start, like a marker circle drawn in one go.
const loopPath = (w: number, h: number, seed: number) => {
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2 - 12;
  const ry = h / 2 - 12;
  const pts: string[] = [];
  const n = 44;
  for (let k = 0; k <= n; k++) {
    const a = -2.6 + (k / n) * (Math.PI * 2 + 0.55);
    const wob = 1 + Math.sin(k * 0.9 + seed) * 0.035 + (k / n) * 0.05;
    pts.push(`${(cx + Math.cos(a) * rx * wob).toFixed(1)} ${(cy + Math.sin(a) * ry * wob).toFixed(1)}`);
  }
  return `M ${pts.join(' L ')}`;
};

// Word circled with a marker (key benefit, number, "JIMAT").
const Circle: React.FC<ElProps> = ({ it, f, out, i, ink, accent, maxW }) => {
  const p = interpolate(f, [3, 16], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const text = it.text ?? '';
  const size = fitSize(text, 78, maxW - 140, 1, 0.62);
  const w = Math.min(maxW, Math.max(260, text.length * size * 0.62 + 150));
  const h = size * 1.2 + 80;
  const col = it.tone ? TONE(it.tone, accent, 'red').bg : '#ef4444';
  return (
    <div style={{ position: 'relative', width: w, height: h, display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: Math.min(1, f / 2) * out, transform: `rotate(${tilt(i, 2)}deg)` }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <path d={loopPath(w, h, i)} fill="none" stroke={col} strokeWidth={11} strokeLinecap="round" strokeLinejoin="round"
          pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
      </svg>
      <div style={{ position: 'relative', fontFamily: F.black, fontSize: size, color: ink, whiteSpace: 'nowrap',
        textShadow: ink === '#ffffff' ? '4px 5px 0 rgba(0,0,0,0.6)' : 'none' }}>{text}</div>
    </div>
  );
};

// Bold word with a double marker underline scribbled under it.
const Underline: React.FC<ElProps> = ({ it, f, out, i, ink, accent, maxW }) => {
  const p1 = interpolate(f, [4, 12], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const p2 = interpolate(f, [9, 16], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const text = it.text ?? '';
  const size = fitSize(text, 80, maxW - 60, 1, 0.66);
  const w = Math.min(maxW, text.length * size * 0.66 + 40);
  const col = it.tone ? TONE(it.tone, accent, 'yellow').bg : '#FFD93B';
  const wave = (y: number, amp: number) => `M 6 ${y} C ${w * 0.25} ${y - amp}, ${w * 0.5} ${y + amp}, ${w * 0.75} ${y - amp * 0.6} S ${w - 4} ${y + amp * 0.4}, ${w - 6} ${y - amp * 0.2}`;
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: Math.min(1, f / 2) * out,
      transform: `rotate(${tilt(i, 1.5) - 1}deg) scale(${0.9 + 0.1 * Math.min(1, f / 6)})` }}>
      <div style={{ fontFamily: F.black, fontSize: size, color: ink, lineHeight: 1.05, whiteSpace: 'nowrap',
        textShadow: ink === '#ffffff' ? '4px 5px 0 rgba(0,0,0,0.6)' : 'none' }}>{text}</div>
      <svg width={w} height={44} viewBox={`0 0 ${w} 44`} style={{ overflow: 'visible', marginTop: -4 }}>
        <path d={wave(14, 7)} fill="none" stroke={col} strokeWidth={10} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p1} />
        <path d={wave(32, 5)} fill="none" stroke={col} strokeWidth={8} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p2} opacity={0.9} />
      </svg>
    </div>
  );
};

// Bouncing pointing hand (animated Noto emoji) with a label — "tengok sini", the product, the beg kuning.
const Point: React.FC<ElProps> = ({ it, f, out, i, ink, accent, lottie }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = popS(f, fps, 280, 9);
  const bob = Math.sin((frame + i * 9) / 4) * 14;
  const char = Array.from(it.sub && /\p{Extended_Pictographic}/u.test(it.sub) ? it.sub : '👇').slice(0, 2).join('');
  const text = it.text ?? '';
  const col = ink === '#ffffff' ? '#FFD93B' : accent;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, opacity: Math.min(1, f / 2) * out,
      transform: `scale(${(0.3 + 0.7 * s) * (0.88 + 0.12 * out)})` }}>
      {text && <div style={{ fontFamily: F.marker, fontSize: 60, color: col, textShadow: '3px 4px 0 rgba(0,0,0,0.6)', whiteSpace: 'nowrap',
        transform: `rotate(${tilt(i, 3)}deg)` }}>{text}</div>}
      <div style={{ transform: `translateY(${bob}px)` }}><LottieEmoji char={char} size={130} lottie={lottie} /></div>
    </div>
  );
};

// Animated GIF / sticker (downloaded by the job; frame-accurate via AnimatedImage).
const Gif: React.FC<ElProps> = ({ it, f, out, i }) => {
  const { fps } = useVideoConfig();
  const s = popS(f, fps, 260, 10);
  if (!it.src) return null;
  return (
    <div style={{ width: 360, height: 360, opacity: Math.min(1, f / 2) * out,
      transform: `scale(${(0.3 + 0.7 * s) * (0.85 + 0.15 * out)}) rotate(${tilt(i, 4)}deg)` }}>
      <AnimatedImage src={it.src} width={360} height={360} fit="contain" />
    </div>
  );
};

// Confetti is a full-frame effect (effects.tsx ConfettiRain), not a sticker.
const Nothing: React.FC<ElProps> = () => null;

export const RENDER: Record<ItemType, React.FC<ElProps>> = {
  headline: Headline, note: Note, tag: Tag, stamp: Stamp, chip: Chip, tape: Tape, scribble: Scribble,
  price: Price, check: Check, emoji: Emoji, counter: Counter,
  bigword: BigWord, callout: Callout, arrow: Arrow, stars: Stars, cta: Cta, fact: Fact,
  circle: Circle, underline: Underline, point: Point, gif: Gif, confetti: Nothing,
};
