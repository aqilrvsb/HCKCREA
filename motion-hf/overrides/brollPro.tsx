// Laju v2 "Pro" B-roll (HyperFrames only; the Remotion templates in motion/src
// stay as they are). Changes from motion/src/broll.tsx:
//   full: enters with a whip — a short directional blur + overshoot settle and a
//         soft flash — on top of the CSS transition, so the cut reads as a camera move.
//   pip:  sized to the free band ABOVE the speaker's face (from the face track),
//         so the card never covers the face; when that band is too small the
//         cutaway is shown full-screen instead (see fitPip).
import React from 'react';
import { AbsoluteFill, Easing, Img, OffthreadVideo, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { TransitionSeries, linearTiming, type TransitionPresentation } from '@remotion/transitions';
import { clockWipe } from '@remotion/transitions/clock-wipe';
import { iris } from '@remotion/transitions/iris';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { F, H, W, clamp, fitSize, popS } from '../../motion/src/lib';
import type { Face } from '../../motion/src/types';
import type { Look, Transition } from './look';

export type PlacedBRoll = {
  s: number; e: number; src: string; video?: string; blur?: string; layout: 'full' | 'pip'; label?: string; k: number;
  /** pip: card box chosen by fitPip (px of the 1080x1920 frame) */
  box?: { top: number; width: number; imgH: number };
};

// the CSS presentation under each look transition (in = entering, out = leaving)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PRESENT = (kind: Transition, n: number, dir: 'in' | 'out'): TransitionPresentation<any> => {
  const alt = n % 2 === 0;
  switch (kind) {
    case 'whip': return slide({ direction: (alt !== (dir === 'out')) ? 'from-right' : 'from-left' });
    case 'zoom': return iris({ width: W, height: H });
    case 'push': return slide({ direction: dir === 'in' ? 'from-bottom' : 'from-top' });
    case 'flash': return wipe({ direction: alt ? 'from-top-left' : 'from-top-right' });
    case 'glitch': return wipe({ direction: alt ? 'from-left' : 'from-right' });
    default: return n % 3 === 2 ? clockWipe({ width: W, height: H }) : iris({ width: W, height: H });
  }
};
const T_IN = 8;
const T_OUT = 7;
const PIP_TOP = 150; // below TikTok's top tabs
const PIP_MIN_IMG = 230; // a card smaller than this reads as clutter → full-screen cutaway

/** Highest face top (px) while a card is up; undefined when no face was tracked then. */
const faceTopDuring = (faces: Face[] | undefined, s: number, e: number): number | undefined => {
  let top: number | undefined;
  for (const fc of faces ?? []) {
    if (fc.t < s - 0.4 || fc.t > e + 0.4) continue;
    const y = fc.y * H;
    top = top === undefined ? y : Math.min(top, y);
  }
  return top;
};

/** Size a picture-in-picture card to the band above the face, or return null (show it full-screen). */
export const fitPip = (faces: Face[] | undefined, sSec: number, eSec: number, label?: string) => {
  const faceTop = faceTopDuring(faces, sSec, eSec) ?? 760;
  const labelH = label ? 74 : 0;
  const band = faceTop - 34 - PIP_TOP; // keep a little air above the head
  const imgH = Math.min(560, band - 28 - labelH);
  if (imgH < PIP_MIN_IMG) return null;
  const width = Math.min(820, Math.round(imgH * 1.33) + 28);
  return { top: PIP_TOP, width, imgH };
};

/** One full-screen cutaway; `f` = frames since it is fully in (negative while entering). */
const FullShot: React.FC<{ b: PlacedBRoll; lead: number; kind: Transition }> = ({ b, lead, kind }) => {
  const local = useCurrentFrame();
  const f = local - lead;
  const len = b.e - b.s;
  const kb = interpolate(f, [-lead, len], [1.0, 1.1], clamp);
  const pan = interpolate(f, [-lead, len], [b.k % 2 ? -18 : 18, b.k % 2 ? 18 : -18], clamp);
  // entry treatment: settled 3 frames after the cutaway is fully in
  const e = interpolate(f, [-lead, 3], [1, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
  const blur = kind === 'whip' ? 16 * e : kind === 'zoom' ? 12 * e : 0;
  const over = kind === 'zoom' ? 1 + 0.4 * e : kind === 'whip' ? 1 + 0.12 * e : kind === 'flash' ? 1 + 0.08 * e : 1 + 0.04 * e;
  const flashPeak = kind === 'flash' ? 0.6 : kind === 'zoom' ? 0.4 : 0.32;
  const glitch = kind === 'glitch' && f < 5 ? (5 - Math.max(0, f)) / 5 : 0;
  const media = (dx = 0, tint?: string) => (
    <AbsoluteFill style={{ transform: dx ? `translateX(${dx}px)` : undefined, mixBlendMode: tint ? 'screen' : undefined, opacity: tint ? 0.8 : 1 }}>
      {b.video ? (
        <AbsoluteFill style={{ transform: `scale(${kb})` }}>
          <OffthreadVideo src={b.video} muted toneMapped={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </AbsoluteFill>
      ) : (
        <>
          {b.blur && <Img src={b.blur} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
          <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', transform: `scale(${kb}) translateX(${pan}px)` }}>
            <Img src={b.src} style={{ maxWidth: '100%', maxHeight: '78%', objectFit: 'contain', boxShadow: '0 30px 80px rgba(0,0,0,0.45)' }} />
          </AbsoluteFill>
        </>
      )}
      {tint && <AbsoluteFill style={{ background: tint, mixBlendMode: 'multiply' }} />}
    </AbsoluteFill>
  );
  return (
    <AbsoluteFill style={{ background: '#000', filter: blur > 0.4 ? `blur(${blur.toFixed(1)}px)` : undefined, transform: `scale(${over})` }}>
      {media()}
      {glitch > 0 && media(-18 * glitch, '#ff2a55')}
      {glitch > 0 && media(18 * glitch, '#22d3ff')}
      {b.label && <Label text={b.label} f={Math.max(0, f + 4)} />}
      {/* a flash as it lands */}
      <AbsoluteFill style={{ background: '#fff', opacity: interpolate(f, [-2, 0, 4], [0, flashPeak, 0], clamp), pointerEvents: 'none' }} />
    </AbsoluteFill>
  );
};

/** All full-screen cutaways as one TransitionSeries over the speaker video (see motion/src/broll.tsx). */
export const BRollFullSeries: React.FC<{ items: PlacedBRoll[]; look: Look }> = ({ items, look }) => {
  const { durationInFrames } = useVideoConfig();
  const fulls = items.filter((x) => x.layout === 'full').sort((a, z) => a.s - z.s);
  if (!fulls.length) return null;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let prevOut = 0;
  fulls.forEach((b, n) => {
    const gap = b.s - cursor;
    let tin = T_IN;
    if (gap - prevOut < tin + 1) tin = Math.max(0, gap - prevOut - 1);
    nodes.push(<TransitionSeries.Sequence key={`g${n}`} durationInFrames={Math.max(1, gap)}><AbsoluteFill /></TransitionSeries.Sequence>);
    const kind = look.transitions[n % look.transitions.length];
    if (tin > 0) nodes.push(<TransitionSeries.Transition key={`ti${n}`} presentation={PRESENT(kind, n, 'in')} timing={linearTiming({ durationInFrames: tin, easing: Easing.out(Easing.cubic) })} />);
    const next = fulls[n + 1];
    const room = (next ? next.s : durationInFrames) - b.e;
    const tout = Math.max(0, Math.min(T_OUT, room - 2));
    const len = b.e - b.s + tin + tout;
    nodes.push(
      <TransitionSeries.Sequence key={`b${n}`} durationInFrames={Math.max(1, len)}>
        <FullShot b={b} lead={tin} kind={kind} />
      </TransitionSeries.Sequence>,
    );
    if (tout > 0) nodes.push(<TransitionSeries.Transition key={`to${n}`} presentation={PRESENT(kind, n + 1, 'out')} timing={linearTiming({ durationInFrames: tout, easing: Easing.in(Easing.cubic) })} />);
    cursor = b.e;
    prevOut = tout;
  });
  const tail = durationInFrames - cursor;
  nodes.push(<TransitionSeries.Sequence key="tail" durationInFrames={Math.max(1, tail)}><AbsoluteFill /></TransitionSeries.Sequence>);
  return <TransitionSeries>{nodes}</TransitionSeries>;
};

const Pip: React.FC<{ b: PlacedBRoll; frame: number }> = ({ b, frame }) => {
  const { fps } = useVideoConfig();
  const box = b.box ?? { top: PIP_TOP, width: 720, imgH: 420 };
  const f = frame - b.s;
  const len = b.e - b.s;
  const s = popS(f, fps, 230, 15);
  const outP = interpolate(f, [len - 6, len], [1, 0], clamp);
  const kb = interpolate(f, [0, len], [1.0, 1.08], clamp);
  const from = b.k % 2 ? 1 : -1;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: '50%', top: box.top, width: box.width,
        transform: `translateX(-50%) translateY(${(1 - s) * -60}px) scale(${0.6 + 0.4 * s}) rotate(${from * -2.5 + (1 - s) * from * 10}deg)`,
        opacity: outP * Math.min(1, s * 1.6), transformOrigin: '50% 0%' }}>
        <div style={{ background: '#fff', padding: 14, borderRadius: 30, boxShadow: '0 22px 50px rgba(0,0,0,0.45), 10px 12px 0 rgba(0,0,0,0.25)', overflow: 'hidden' }}>
          <div style={{ width: '100%', height: box.imgH, borderRadius: 18, overflow: 'hidden', background: '#111' }}>
            {b.video ? (
              <OffthreadVideo src={b.video} muted toneMapped={false} startFrom={0}
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${kb})` }} />
            ) : (
              <Img src={b.src} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${kb})` }} />
            )}
          </div>
          {b.label && (
            <div style={{ fontFamily: F.black, fontSize: fitSize(b.label, 46, box.width - 40, 1, 0.66), color: '#111', textAlign: 'center', padding: '12px 6px 2px' }}>{b.label}</div>
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

/** Picture-in-picture cards (call above the speaker, under the stickers). */
export const BRollPipLayer: React.FC<{ items: PlacedBRoll[] }> = ({ items }) => {
  const frame = useCurrentFrame();
  const b = items.find((x) => x.layout === 'pip' && frame >= x.s && frame < x.e);
  if (!b) return null;
  return <Pip b={b} frame={frame} />;
};
