// B-roll cutaways for Edit Video — images fetched from the web for what the
// speaker is saying.
//   full: covers the frame — blurred fill + the image contained, slow Ken Burns,
//         punch-in entry, quick zoom-out exit.
//   pip:  tilted, bordered card over the upper half that slides in.
import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { F, clamp, fitSize, popS } from './lib';

export type PlacedBRoll = { s: number; e: number; src: string; blur?: string; layout: 'full' | 'pip'; label?: string; k: number };

const Full: React.FC<{ b: PlacedBRoll; frame: number }> = ({ b, frame }) => {
  const f = frame - b.s;
  const len = b.e - b.s;
  const inP = interpolate(f, [0, 6], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const outP = interpolate(f, [len - 6, len], [1, 0], clamp);
  const kb = interpolate(f, [0, len], [1.0, 1.1], clamp);
  const pan = interpolate(f, [0, len], [b.k % 2 ? -18 : 18, b.k % 2 ? 18 : -18], clamp);
  return (
    <AbsoluteFill style={{ opacity: Math.min(inP * 1.4, 1) * outP, background: '#000' }}>
      {b.blur && <Img src={b.blur} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center',
        transform: `scale(${(1.25 - 0.25 * inP) * kb}) translateX(${pan}px)` }}>
        <Img src={b.src} style={{ maxWidth: '100%', maxHeight: '78%', objectFit: 'contain' }} />
      </AbsoluteFill>
      {b.label && <Label text={b.label} f={f} />}
    </AbsoluteFill>
  );
};

const Pip: React.FC<{ b: PlacedBRoll; frame: number }> = ({ b, frame }) => {
  const { fps } = useVideoConfig();
  const f = frame - b.s;
  const len = b.e - b.s;
  const s = popS(f, fps, 210, 14);
  const outP = interpolate(f, [len - 6, len], [1, 0], clamp);
  const kb = interpolate(f, [0, len], [1.0, 1.08], clamp);
  const from = b.k % 2 ? 1 : -1;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: '50%', top: 250, width: 800,
        transform: `translateX(-50%) translateX(${(1 - s) * from * 900}px) rotate(${from * -3 + (1 - s) * from * 8}deg)`, opacity: outP }}>
        <div style={{ background: '#fff', padding: 14, borderRadius: 30, boxShadow: '10px 12px 0 rgba(0,0,0,0.4)', overflow: 'hidden' }}>
          <div style={{ width: '100%', height: 640, borderRadius: 18, overflow: 'hidden', background: '#111' }}>
            <Img src={b.src} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${kb})` }} />
          </div>
          {b.label && (
            <div style={{ fontFamily: F.black, fontSize: fitSize(b.label, 46, 740, 1, 0.66), color: '#111', textAlign: 'center', padding: '12px 6px 2px' }}>{b.label}</div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Label: React.FC<{ text: string; f: number }> = ({ text, f }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, top: 230, display: 'flex', justifyContent: 'center',
    opacity: interpolate(f, [3, 8], [0, 1], clamp) }}>
    <div style={{ background: '#FFD93B', color: '#111', fontFamily: F.black, fontSize: fitSize(text, 64, 900, 1, 0.66), padding: '6px 26px',
      boxShadow: '8px 10px 0 rgba(0,0,0,0.4)', transform: 'rotate(-2deg)' }}>{text}</div>
  </div>
);

/** Renders the full-screen cutaways (call under overlays) — `layer="full"` —
 *  or the picture-in-picture cards — `layer="pip"`. */
export const BRollLayer: React.FC<{ items: PlacedBRoll[]; layer: 'full' | 'pip' }> = ({ items, layer }) => {
  const frame = useCurrentFrame();
  const b = items.find((x) => x.layout === layer && frame >= x.s && frame < x.e);
  if (!b) return null;
  return layer === 'full' ? <Full b={b} frame={frame} /> : <Pip b={b} frame={frame} />;
};
