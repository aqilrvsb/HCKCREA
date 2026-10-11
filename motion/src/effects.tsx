// "Gempak" effect primitives — all plain CSS/SVG (no blur filters, no WebGL)
// so they stay cheap on CPU renderers.
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { clamp } from './lib';

// deterministic pseudo-random in [0,1)
export const rnd = (i: number, k = 0) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Frames where something "hits" (hook, bigword, stamp, price, full B-roll, cta). */
export type Impact = { frame: number; power: number };

/** Screen-shake offset for the current frame from a list of impacts. */
export const shakeOffset = (frame: number, impacts: Impact[], amp = 16, len = 9) => {
  let x = 0;
  let y = 0;
  let r = 0;
  for (const im of impacts) {
    const d = frame - im.frame;
    if (d < 0 || d > len) continue;
    const k = (1 - d / len) * im.power;
    x += (rnd(frame, 1) - 0.5) * 2 * amp * k;
    y += (rnd(frame, 2) - 0.5) * 2 * amp * k;
    r += (rnd(frame, 3) - 0.5) * 1.2 * k;
  }
  return { x, y, r };
};

/** White flash over the frame at impacts (≤ 0.5 opacity, 5 frames). */
export const Flash: React.FC<{ impacts: Impact[]; color?: string }> = ({ impacts, color = '#ffffff' }) => {
  const frame = useCurrentFrame();
  let o = 0;
  for (const im of impacts) {
    const d = frame - im.frame;
    if (d < 0 || d > 5) continue;
    o = Math.max(o, interpolate(d, [0, 1, 5], [0.55, 0.42, 0], clamp) * im.power);
  }
  if (o <= 0.01) return null;
  return <AbsoluteFill style={{ background: color, opacity: o, pointerEvents: 'none' }} />;
};

/** Burst of confetti/sparks radiating from the centre of its parent. */
export const Burst: React.FC<{ f: number; colors: string[]; n?: number; radius?: number; seed?: number }> = ({ f, colors, n = 16, radius = 260, seed = 0 }) => {
  if (f < 0 || f > 26) return null;
  const p = interpolate(f, [0, 22], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const fade = interpolate(f, [12, 26], [1, 0], clamp);
  return (
    <div style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, pointerEvents: 'none' }}>
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + rnd(i, seed) * 0.6;
        const dist = radius * (0.55 + rnd(i, seed + 1) * 0.6) * p;
        const size = 10 + rnd(i, seed + 2) * 14;
        const x = Math.cos(a) * dist;
        const y = Math.sin(a) * dist + 60 * p * p; // a little gravity
        const isStar = i % 3 === 0;
        return (
          <div key={i} style={{
            position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: isStar ? size : size * 0.45,
            background: colors[i % colors.length], borderRadius: isStar ? 3 : 2, opacity: fade,
            transform: `rotate(${(rnd(i, seed + 3) * 360 + f * 18) % 360}deg)`,
          }} />
        );
      })}
    </div>
  );
};

/** Warm light-leak band sweeping across the frame (section breaks). */
export const LightSweep: React.FC<{ at: number[]; dur?: number }> = ({ at, dur = 16 }) => {
  const frame = useCurrentFrame();
  const start = at.find((s) => frame >= s && frame < s + dur);
  if (start === undefined) return null;
  const p = (frame - start) / dur;
  const x = interpolate(p, [0, 1], [-60, 160]);
  const o = interpolate(p, [0, 0.25, 0.75, 1], [0, 0.75, 0.75, 0]);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'screen', opacity: o,
      background: `linear-gradient(115deg, transparent ${x - 30}%, rgba(255,140,60,0.65) ${x - 12}%, rgba(255,90,140,0.55) ${x}%, rgba(255,220,120,0.5) ${x + 10}%, transparent ${x + 28}%)` }} />
  );
};

/** Thin progress bar along the top edge. */
export const ProgressBar: React.FC<{ color: string }> = ({ color }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const p = Math.min(1, frame / Math.max(1, durationInFrames - 1));
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, height: 12, width: '100%', background: 'rgba(0,0,0,0.35)' }}>
      <div style={{ height: '100%', width: `${p * 100}%`, background: color }} />
    </div>
  );
};
