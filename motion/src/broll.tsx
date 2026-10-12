// B-roll cutaways for Edit Video — photos from the product's own sales site /
// the web, or short stock video clips, for what the speaker is saying.
//   full: covers the frame — blurred fill + the photo contained (or the clip
//         cropped to fill), slow Ken Burns. Enters and leaves through
//         @remotion/transitions (wipe, clock wipe, iris, slide, flip — the CSS
//         presentations, cheap on a CPU renderer), a different one each time.
//   pip:  tilted, bordered card over the upper half that slides in.
import React from 'react';
import { AbsoluteFill, Easing, Img, OffthreadVideo, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { TransitionSeries, linearTiming, type TransitionPresentation } from '@remotion/transitions';
import { clockWipe } from '@remotion/transitions/clock-wipe';
import { flip } from '@remotion/transitions/flip';
import { iris } from '@remotion/transitions/iris';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { F, H, W, clamp, fitSize, popS } from './lib';

export type PlacedBRoll = { s: number; e: number; src: string; video?: string; blur?: string; layout: 'full' | 'pip'; label?: string; k: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PRESENTATIONS: TransitionPresentation<any>[] = [
  wipe({ direction: 'from-left' }),
  clockWipe({ width: W, height: H }),
  iris({ width: W, height: H }),
  slide({ direction: 'from-bottom' }),
  flip({ direction: 'from-right' }),
  wipe({ direction: 'from-top-right' }),
];
const T_IN = 9;
const T_OUT = 7;

/** One full-screen cutaway; `f` = frames since it is fully in (negative while entering). */
const FullShot: React.FC<{ b: PlacedBRoll; lead: number }> = ({ b, lead }) => {
  const local = useCurrentFrame();
  const f = local - lead;
  const len = b.e - b.s;
  const kb = interpolate(f, [-lead, len], [1.0, 1.1], clamp);
  const pan = interpolate(f, [-lead, len], [b.k % 2 ? -18 : 18, b.k % 2 ? 18 : -18], clamp);
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {b.video ? (
        <AbsoluteFill style={{ transform: `scale(${kb})` }}>
          <OffthreadVideo src={b.video} muted toneMapped={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </AbsoluteFill>
      ) : (
        <>
          {b.blur && <Img src={b.blur} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
          <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', transform: `scale(${kb}) translateX(${pan}px)` }}>
            <Img src={b.src} style={{ maxWidth: '100%', maxHeight: '78%', objectFit: 'contain' }} />
          </AbsoluteFill>
        </>
      )}
      {b.label && <Label text={b.label} f={Math.max(0, f + 4)} />}
    </AbsoluteFill>
  );
};

/**
 * All full-screen cutaways as one TransitionSeries over the speaker video:
 * transparent gaps ↔ cutaways, each change through a transition. A cutaway is
 * fully in at its start frame and starts leaving at its end frame.
 */
export const BRollFullSeries: React.FC<{ items: PlacedBRoll[] }> = ({ items }) => {
  const { durationInFrames } = useVideoConfig();
  const fulls = items.filter((x) => x.layout === 'full').sort((a, z) => a.s - z.s);
  if (!fulls.length) return null;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let prevOut = 0;
  fulls.forEach((b, n) => {
    const gap = b.s - cursor;
    // The gap before this cutaway overlaps the previous exit and this entry.
    let tin = T_IN;
    if (gap - prevOut < tin + 1) tin = Math.max(0, gap - prevOut - 1);
    // The gap sequence ends exactly when the cutaway is fully in (b.s); the
    // entry transition plays over its last `tin` frames.
    nodes.push(<TransitionSeries.Sequence key={`g${n}`} durationInFrames={Math.max(1, gap)}><AbsoluteFill /></TransitionSeries.Sequence>);
    if (tin > 0) nodes.push(<TransitionSeries.Transition key={`ti${n}`} presentation={PRESENTATIONS[b.k % PRESENTATIONS.length]} timing={linearTiming({ durationInFrames: tin, easing: Easing.out(Easing.cubic) })} />);
    const next = fulls[n + 1];
    const room = (next ? next.s : durationInFrames) - b.e;
    const tout = Math.max(0, Math.min(T_OUT, room - 2));
    const len = b.e - b.s + tin + tout;
    nodes.push(
      <TransitionSeries.Sequence key={`b${n}`} durationInFrames={Math.max(1, len)}>
        <FullShot b={b} lead={tin} />
      </TransitionSeries.Sequence>,
    );
    if (tout > 0) nodes.push(<TransitionSeries.Transition key={`to${n}`} presentation={PRESENTATIONS[(b.k + 3) % PRESENTATIONS.length]} timing={linearTiming({ durationInFrames: tout, easing: Easing.in(Easing.cubic) })} />);
    cursor = b.e;
    prevOut = tout;
  });
  const tail = durationInFrames - cursor; // starts at the last exit (overlaps it by prevOut)
  nodes.push(<TransitionSeries.Sequence key="tail" durationInFrames={Math.max(1, tail)}><AbsoluteFill /></TransitionSeries.Sequence>);
  return <TransitionSeries>{nodes}</TransitionSeries>;
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
      <div style={{ position: 'absolute', left: '50%', top: 210, width: 720,
        transform: `translateX(-50%) translateX(${(1 - s) * from * 900}px) rotate(${from * -3 + (1 - s) * from * 8}deg)`, opacity: outP }}>
        <div style={{ background: '#fff', padding: 14, borderRadius: 30, boxShadow: '10px 12px 0 rgba(0,0,0,0.4)', overflow: 'hidden' }}>
          <div style={{ width: '100%', height: 540, borderRadius: 18, overflow: 'hidden', background: '#111' }}>
            {b.video ? (
              <OffthreadVideo src={b.video} muted toneMapped={false} startFrom={0}
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${kb})` }} />
            ) : (
              <Img src={b.src} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${kb})` }} />
            )}
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

/** Picture-in-picture cards (call above the speaker, under the stickers). */
export const BRollPipLayer: React.FC<{ items: PlacedBRoll[] }> = ({ items }) => {
  const frame = useCurrentFrame();
  const b = items.find((x) => x.layout === 'pip' && frame >= x.s && frame < x.e);
  if (!b) return null;
  return <Pip b={b} frame={frame} />;
};
