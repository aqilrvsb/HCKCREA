// "Check Guideline TikTok" — the digital version of what Malaysian sellers do
// with a roll of sellotape before filming: cover the medical / claim words
// printed on the product box so TikTok's on-screen-text review doesn't flag
// the video.
//
// TapeLayer — tracked strips over the client's video. Modal OCRs the
//   (jump-cut) video, an LLM picks the risky lines, and each line becomes a
//   track of keyframes [t, cx, cy, w, h, angle] in 1080x1920 px; we
//   interpolate between keyframes so the tape follows the box as it moves.
// TapeStrip — one opaque matte masking-tape strip with torn ends (also used
//   by the captions to cover a muted word).
import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { TapeTrack } from './types';

const TAPE = '#E9DFC6';
const TAPE_DARK = '#D9CCAA';

// Torn ends: a zig-zag polygon, deterministic per seed.
const tornClip = (seed: number) => {
  const pts: string[] = [];
  const n = 7;
  const r = (k: number) => {
    const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  for (let k = 0; k <= n; k++) pts.push(`${(r(k) * 2.4).toFixed(2)}% ${(k / n) * 100}%`);
  for (let k = n; k >= 0; k--) pts.push(`${(100 - r(k + 20) * 2.4).toFixed(2)}% ${(k / n) * 100}%`);
  return `polygon(${pts.join(',')})`;
};

export const TapeStrip: React.FC<{ w: number; h: number; seed?: number; style?: React.CSSProperties }> = ({ w, h, seed = 1, style }) => (
  // No CSS blur/drop-shadow (slow in software GL, and clip-path would cut it
  // anyway) — the darker lower edge gives the strip its thickness.
  <div style={{
    width: w, height: h, clipPath: tornClip(seed), backgroundColor: TAPE,
    backgroundImage: [
      'repeating-linear-gradient(90deg, rgba(120,100,60,0.07) 0 2px, transparent 2px 7px)',
      `linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 35%, rgba(0,0,0,0) 72%, ${TAPE_DARK} 100%)`,
    ].join(','),
    ...style,
  }} />
);

type Key = [number, number, number, number, number, number]; // t, cx, cy, w, h, angle(deg)

function sample(track: TapeTrack, t: number): Key | null {
  const k = track.k;
  if (!k.length) return null;
  const pre = track.pre ?? 0.3;
  const post = track.post ?? 0.3;
  if (t < k[0][0] - pre || t > k[k.length - 1][0] + post) return null;
  if (t <= k[0][0]) return k[0];
  if (t >= k[k.length - 1][0]) return k[k.length - 1];
  for (let j = 1; j < k.length; j++) {
    const a = k[j - 1];
    const b = k[j];
    if (t > b[0]) continue;
    const u = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
    let da = b[5] - a[5];
    if (da > 180) da -= 360;
    if (da < -180) da += 360;
    return [t, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u, a[4] + (b[4] - a[4]) * u, a[5] + da * u];
  }
  return null;
}

/** Tracked tape over the source video. Render it inside the same transform
 *  wrapper as the video so punch-in zooms move the tape with the box. */
export const TapeLayer: React.FC<{ tracks?: TapeTrack[] }> = ({ tracks }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!tracks || !tracks.length) return null;
  const t = frame / fps;
  return (
    <>
      {tracks.map((tr, n) => {
        const s = sample(tr, t);
        if (!s) return null;
        const [, cx, cy, w, h, a] = s;
        // pad: wider than the text line, a bit taller, never thinner than 22px
        const tw = w * 1.03 + Math.max(18, h * 0.7);
        const th = Math.max(22, h * 1.55 + 8);
        const jitter = ((n * 37) % 5) - 2; // crooked like real hand-taping
        return (
          <div key={n} style={{ position: 'absolute', left: cx - tw / 2, top: cy - th / 2, width: tw, height: th,
            transform: `rotate(${a + jitter * 0.6}deg)`, pointerEvents: 'none' }}>
            <TapeStrip w={tw} h={th} seed={n + 1} />
          </div>
        );
      })}
    </>
  );
};
