// Laju v2 "Pro" end cards — the "beg kuning" call to action, three layouts
// (the video's look picks one). All press like a button being tapped (down
// ~10 % in 0.15 s, spring back with overshoot, every 1.4 s), sit above the
// speaker's face, and send the eye down the left edge toward the shop basket
// TikTok shows bottom-left. Only the client's own CTA words are shown.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useVideoConfig } from 'remotion';
import { clamp, fitSize } from '../../motion/src/lib';
import type { Look } from './look';

const BagIcon: React.FC<{ size: number; color?: string }> = ({ size, color = '#111' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block', flexShrink: 0 }}>
    <path d="M5.2 7.5h13.6l1.1 13.5H4.1L5.2 7.5z" fill={color} />
    <path d="M8.7 9.5V6.6a3.3 3.3 0 0 1 6.6 0v2.9" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
  </svg>
);

const press = (f: number, fps: number) => {
  const len = Math.round(fps * 1.4);
  const tf = (f + len - Math.round(fps * 0.5)) % len;
  return tf < 5 ? interpolate(tf, [0, 5], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) })
    : interpolate(tf, [5, 20], [1, 0], { ...clamp, easing: Easing.out(Easing.back(2)) });
};

const Chevrons: React.FC<{ f: number; fps: number; color: string }> = ({ f, fps, color }) => (
  <div style={{ position: 'absolute', left: 54, top: 980, display: 'flex', flexDirection: 'column', gap: 10, opacity: interpolate(f, [8, 14], [0, 1], clamp) }}>
    {[0, 1, 2].map((i) => {
      const ph = (((f / fps) * 2.2 - i * 0.22) % 1 + 1) % 1;
      return (
        <svg key={i} width={84} height={58} viewBox="0 0 84 58" style={{ opacity: 0.35 + 0.65 * Math.sin(ph * Math.PI), transform: `translateY(${Math.sin(ph * Math.PI) * 10}px)` }}>
          <path d="M8 10 L42 44 L76 10" fill="none" stroke="#000" strokeWidth={20} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 10 L42 44 L76 10" fill="none" stroke={color} strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    })}
  </div>
);

export const EndCardPro: React.FC<{ text: string; sub?: string; start: number; frame: number; faceTop: number; look: Look }> = ({ text, sub, start, frame, faceTop, look }) => {
  const { fps } = useVideoConfig();
  const f = frame - start;
  if (f < 0) return null;
  const s = spring({ frame: f, fps, config: { damping: 12, stiffness: 240, mass: 0.7 } });
  const label = text.toUpperCase();
  const fam = look.display.family;
  const charW = look.display.charW;
  const p = press(f, fps);
  const top = Math.max(250, Math.min(440, faceTop - 330));
  const yellow = '#FFD93B';
  const shineP = ((f % Math.round(fps * 1.3)) / (fps * 1.3)) * 1.6 - 0.3;
  const shine = (
    <span style={{ position: 'absolute', top: -60, bottom: -60, width: 90, left: `${shineP * 100}%`, transform: 'skewX(-20deg)',
      background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0) 100%)' }} />
  );
  const subEl = sub ? (
    <div style={{ fontFamily: fam, fontWeight: look.display.weight, fontSize: fitSize(sub, 50, 860, 1, charW), color: '#fff', WebkitTextStroke: '8px #000',
      paintOrder: 'stroke fill', opacity: interpolate(f, [6, 12], [0, 1], clamp), textAlign: 'center' } as React.CSSProperties}>{sub}</div>
  ) : null;

  let card: React.ReactNode;
  if (look.endcard === 'badge') {
    const size = fitSize(label, 64, 760, 2, charW, 38);
    const bob = Math.sin((f / fps) * Math.PI * 2 * 0.9) * 8;
    card = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        <div style={{ position: 'relative', width: 230, height: 230, borderRadius: 999, background: yellow, border: '8px solid #111', display: 'flex',
          alignItems: 'center', justifyContent: 'center', boxShadow: '0 14px 0 #111, 0 30px 60px rgba(0,0,0,0.4)', transform: `translateY(${bob}px) scale(${1 - 0.1 * p}) rotate(${-6 + 6 * s}deg)`, overflow: 'hidden' }}>
          <BagIcon size={130} />
          {shine}
        </div>
        <div style={{ background: '#111', color: yellow, fontFamily: fam, fontWeight: look.display.weight, fontSize: size, lineHeight: 1.05, padding: '14px 34px',
          borderRadius: 18, textAlign: 'center', maxWidth: 860, transform: 'rotate(-2deg)', boxShadow: '0 10px 0 rgba(0,0,0,0.35)' }}>{label}</div>
        {subEl}
      </div>
    );
  } else if (look.endcard === 'banner') {
    const size = fitSize(label, 76, 820, 2, charW, 40);
    card = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, width: '100%' }}>
        <div style={{ position: 'relative', overflow: 'hidden', width: 1240, marginLeft: -80, background: look.hi, transform: `rotate(-5deg) scaleY(${1 - 0.08 * p})`,
          padding: '26px 0', boxShadow: '0 16px 0 rgba(0,0,0,0.35)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 22, borderTop: '6px solid #111', borderBottom: '6px solid #111' }}>
          <BagIcon size={size * 1.1} />
          <span style={{ fontFamily: fam, fontWeight: look.display.weight, fontSize: size, lineHeight: 1.04, color: '#111', textAlign: 'center', maxWidth: 820 }}>{label}</span>
          {shine}
        </div>
        {subEl}
      </div>
    );
  } else {
    const size = fitSize(label, 66, 700, 2, charW, 40);
    card = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 22, background: yellow, color: '#111',
          padding: '26px 46px', borderRadius: 999, border: '6px solid #111', boxShadow: '0 14px 0 #111, 0 30px 60px rgba(0,0,0,0.45)', transform: `scale(${1 - 0.1 * p})` }}>
          <BagIcon size={size * 1.15} />
          <span style={{ fontFamily: fam, fontWeight: look.display.weight, fontSize: size, lineHeight: 1.05, textAlign: 'center', maxWidth: 700 }}>{label}</span>
          {shine}
        </div>
        {subEl}
      </div>
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 42%)', opacity: interpolate(f, [0, 8], [0, 1], clamp) }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top, display: 'flex', justifyContent: 'center',
        transform: `translateY(${(1 - s) * -120}px) scale(${0.7 + 0.3 * s})`, opacity: Math.min(1, s * 1.5) }}>
        {card}
      </div>
      <Chevrons f={f} fps={fps} color={look.endcard === 'banner' ? look.hi : yellow} />
    </AbsoluteFill>
  );
};
