// Laju v2 "Pro" frame effects, chosen by the video's look:
//   section breaks: sweep (warm band), leak (drifting light-leak blobs), burn (film burn from an edge)
//   progress:       bar · thick (rounded, glowing) · dots (segments) · none
//   grain:          a static noise tile shifted every 2 frames (no per-frame filter work)
// Plain CSS gradients only — no blur filters — so a CPU renderer stays fast.
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { LightSweep } from '../../motion/src/effects';
import type { BreakFx, ProgressStyle } from './look';

export const BreakFxLayer: React.FC<{ at: number[]; kind: BreakFx }> = ({ at, kind }) => {
  const frame = useCurrentFrame();
  if (kind === 'sweep') return <LightSweep at={at} />;
  const dur = kind === 'leak' ? 22 : 18;
  const start = at.find((s) => frame >= s && frame < s + dur);
  if (start === undefined) return null;
  const p = (frame - start) / dur;
  const o = interpolate(p, [0, 0.3, 0.7, 1], [0, 0.85, 0.7, 0]);
  if (kind === 'leak') {
    const x1 = interpolate(p, [0, 1], [-10, 70]);
    const x2 = interpolate(p, [0, 1], [110, 30]);
    return (
      <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'screen', opacity: o,
        background: [
          `radial-gradient(ellipse 60% 45% at ${x1}% 30%, rgba(255,150,60,0.75) 0%, rgba(255,120,60,0) 70%)`,
          `radial-gradient(ellipse 50% 40% at ${x2}% 65%, rgba(255,70,120,0.6) 0%, rgba(255,70,120,0) 70%)`,
          `radial-gradient(ellipse 40% 30% at ${(x1 + x2) / 2}% 48%, rgba(255,230,150,0.55) 0%, rgba(255,230,150,0) 70%)`,
        ].join(',') }} />
    );
  }
  // burn: a hot edge eating in from one side and back out
  const side = start % 2 ? 'left' : 'right';
  const w = interpolate(p, [0, 0.45, 1], [0, 62, 0]);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'screen', opacity: Math.min(1, o * 1.1),
      background: `linear-gradient(${side === 'left' ? 90 : 270}deg, rgba(255,250,230,0.95) 0%, rgba(255,190,90,0.85) ${w * 0.35}%, rgba(255,90,40,0.55) ${w * 0.7}%, rgba(120,20,0,0) ${w}%)` }} />
  );
};

export const ProgressPro: React.FC<{ kind: ProgressStyle; color: string }> = ({ kind, color }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  if (kind === 'none') return null;
  const p = Math.min(1, frame / Math.max(1, durationInFrames - 1));
  if (kind === 'dots') {
    const n = 12;
    return (
      <div style={{ position: 'absolute', left: 40, right: 40, top: 22, display: 'flex', gap: 8 }}>
        {Array.from({ length: n }, (_, i) => {
          const fill = Math.min(1, Math.max(0, p * n - i));
          return (
            <div key={i} style={{ flex: 1, height: 10, borderRadius: 99, background: 'rgba(255,255,255,0.28)', overflow: 'hidden' }}>
              <div style={{ width: `${fill * 100}%`, height: '100%', background: color }} />
            </div>
          );
        })}
      </div>
    );
  }
  if (kind === 'thick') {
    return (
      <div style={{ position: 'absolute', left: 24, right: 24, top: 18, height: 16, borderRadius: 99, background: 'rgba(0,0,0,0.38)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${p * 100}%`, borderRadius: 99, background: color, boxShadow: `0 0 18px ${color}` }} />
      </div>
    );
  }
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, height: 12, width: '100%', background: 'rgba(0,0,0,0.35)' }}>
      <div style={{ height: '100%', width: `${p * 100}%`, background: color }} />
    </div>
  );
};

// fractal noise as an SVG tile (rasterised once by the browser)
const NOISE = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="256" height="256" filter="url(#n)"/></svg>',
)}`;

export const Grain: React.FC<{ amount: number }> = ({ amount }) => {
  const frame = useCurrentFrame();
  if (amount <= 0) return null;
  const k = Math.floor(frame / 2);
  const x = (k * 73) % 256;
  const y = (k * 151) % 256;
  return <AbsoluteFill style={{ pointerEvents: 'none', backgroundImage: `url("${NOISE}")`, backgroundPosition: `${x}px ${y}px`, opacity: amount }} />;
};
