// @remotion/transitions for the Laju v2 shim: <TransitionSeries> with
// linearTiming and the five presentations the B-roll layer uses (wipe, clock
// wipe, iris, slide, flip), with the same geometry as Remotion's.
//
// Semantics (as Remotion): sequences play back to back; a <Transition>
// between two sequences pulls the next one earlier by the transition's length,
// and during that overlap the outgoing sequence is drawn through the
// presentation as "exiting" and the incoming one as "entering", both at the
// transition's progress. Each sequence's children see their own local frame.
import { h, toChildArray } from "preact";
import { useContext } from "preact/hooks";
import { FrameContext, interpolate, useVideoConfig } from "remotion";

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", display: "flex", flexDirection: "column" };
const Fill = ({ style, children }) => h("div", { style: { ...FILL, ...(style || {}) } }, children);

export const linearTiming = ({ durationInFrames, easing }) => ({
  getDurationInFrames: () => durationInFrames,
  getProgress: ({ frame }) => interpolate(frame, [0, durationInFrames], [0, 1], { easing, extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
});

const SeriesSequence = () => null;
const SeriesTransition = () => null;

function flatten(children) {
  const out = [];
  for (const c of toChildArray(children)) {
    if (c && c.type === SeriesSequence) out.push({ kind: "seq", props: c.props, key: c.key });
    else if (c && c.type === SeriesTransition) out.push({ kind: "tr", props: c.props });
    else if (c && Array.isArray(c)) out.push(...flatten(c));
  }
  return out;
}

export const TransitionSeries = ({ children }) => {
  const parent = useContext(FrameContext);
  const frame = parent.frame;
  const { fps } = useVideoConfig();
  const items = flatten(children);
  const seqs = [];
  let start = 0;
  let pending = null;
  for (const it of items) {
    if (it.kind === "seq") {
      const dur = Math.max(1, it.props.durationInFrames | 0);
      seqs.push({ start, dur, children: it.props.children, enter: pending, exit: null, key: it.key });
      pending = null;
      start += dur;
    } else {
      const d = it.props.timing.getDurationInFrames({ fps });
      start -= d;
      const tr = { pres: it.props.presentation, timing: it.props.timing, d, at: start };
      if (seqs.length) seqs[seqs.length - 1].exit = tr;
      pending = tr;
    }
  }
  const nodes = [];
  seqs.forEach((s, i) => {
    if (frame < s.start || frame >= s.start + s.dur) return;
    let node = h(Fill, null, h(FrameContext.Provider, { value: { frame: frame - s.start, abs: parent.abs + s.start, dur: s.dur } }, s.children));
    if (s.exit && frame >= s.exit.at && frame < s.exit.at + s.exit.d) {
      const p = s.exit.timing.getProgress({ frame: frame - s.exit.at, fps });
      node = h(s.exit.pres.component, { presentationDirection: "exiting", presentationProgress: p, presentationDurationInFrames: s.exit.d, passedProps: s.exit.pres.props }, node);
    }
    if (s.enter && frame >= s.enter.at && frame < s.enter.at + s.enter.d) {
      const p = s.enter.timing.getProgress({ frame: frame - s.enter.at, fps });
      node = h(s.enter.pres.component, { presentationDirection: "entering", presentationProgress: p, presentationDurationInFrames: s.enter.d, passedProps: s.enter.pres.props }, node);
    }
    nodes.push(h("div", { key: s.key ?? `s${i}`, style: FILL }, node));
  });
  return h(Fill, null, nodes);
};
TransitionSeries.Sequence = SeriesSequence;
TransitionSeries.Transition = SeriesTransition;

// ── presentations ─────────────────────────────────────────────────────────────
const pick = (dir, a, b) => (dir === "entering" ? a : b);

const wipeIn = (p, d) => {
  switch (d) {
    case "from-left": return `polygon(0% 0%, ${p}% 0%, ${p}% 100%, 0% 100%)`;
    case "from-top-left": return `polygon(0% 0%, ${p * 2}% 0%, 0% ${p * 2}%)`;
    case "from-top": return `polygon(0% 0%, 100% 0%, 100% ${p}%, 0% ${p}%)`;
    case "from-top-right": return `polygon(100% 0%, ${100 - p * 2}% 0%, 100% ${p * 2}%)`;
    case "from-right": return `polygon(100% 0%, 100% 100%, ${100 - p}% 100%, ${100 - p}% 0%)`;
    case "from-bottom-right": return `polygon(100% 100%, ${100 - p * 2}% 100%, 100% ${100 - p * 2}%)`;
    case "from-bottom": return `polygon(0% 100%, 100% 100%, 100% ${100 - p}%, 0% ${100 - p}%)`;
    default: return `polygon(0% 100%, 0% ${100 - p * 2}%, ${p * 2}% 100%)`;
  }
};
const wipeOut = (p, d) => {
  switch (d) {
    case "from-left": return `polygon(100% 100%, ${100 - p}% 100%, ${100 - p}% 0%, 100% 0%)`;
    case "from-top-left": return `polygon(100% 100%, ${100 - p * 2}% 100%, 100% ${100 - p * 2}%)`;
    case "from-top": return `polygon(100% 100%, 0% 100%, 0% ${100 - p}%, 100% ${100 - p}%)`;
    case "from-top-right": return `polygon(0% 100%, ${p * 2}% 100%, 0% ${100 - p * 2}%)`;
    case "from-right": return `polygon(0% 0%, ${p}% 0%, ${p}% 100%, 0% 100%)`;
    case "from-bottom-right": return `polygon(0% 0%, ${p * 2}% 0%, 0% ${p * 2}%)`;
    case "from-bottom": return `polygon(100% 0%, 0% 0%, 0% ${p}%, 100% ${p}%)`;
    default: return `polygon(100% 0%, ${100 - p * 2}% 0%, 100% ${p * 2}%)`;
  }
};
const Wipe = ({ children, presentationProgress, presentationDirection, passedProps: { direction = "from-left" } }) => {
  const prog = (presentationDirection === "entering" ? presentationProgress : 1 - presentationProgress) * 100;
  const clipPath = presentationDirection === "entering" ? wipeIn(prog, direction) : wipeOut(prog, direction);
  return h(Fill, null, h(Fill, { style: { justifyContent: "center", alignItems: "center", clipPath } }, children));
};
export const wipe = (props = {}) => ({ component: Wipe, props });

const Slide = ({ children, presentationProgress: p, presentationDirection, passedProps: { direction = "from-left" } }) => {
  const pe = p === 1 ? p * 100 : p * 100 - 0.01;
  let transform;
  if (presentationDirection === "exiting") {
    transform = direction === "from-left" ? `translateX(${pe}%)` : direction === "from-right" ? `translateX(${-p * 100}%)`
      : direction === "from-top" ? `translateY(${pe}%)` : `translateY(${-p * 100}%)`;
  } else {
    transform = direction === "from-left" ? `translateX(${-100 + p * 100}%)` : direction === "from-right" ? `translateX(${100 - pe}%)`
      : direction === "from-top" ? `translateY(${-100 + p * 100}%)` : `translateY(${100 - pe}%)`;
  }
  return h(Fill, { style: { justifyContent: "center", alignItems: "center", transform } }, children);
};
export const slide = (props = {}) => ({ component: Slide, props });

const Flip = ({ children, presentationProgress: p, presentationDirection, passedProps: { direction = "from-left", perspective = 1000 } }) => {
  const startIn = direction === "from-right" || direction === "from-top" ? 180 : -180;
  const endOut = direction === "from-right" || direction === "from-top" ? -180 : 180;
  const rotation = presentationDirection === "entering" ? interpolate(p, [0, 1], [startIn, 0]) : interpolate(p, [0, 1], [0, endOut]);
  const prop = direction === "from-top" || direction === "from-bottom" ? "rotateX" : "rotateY";
  return h(Fill, { style: { perspective, transformStyle: "preserve-3d" } },
    h(Fill, { style: { transform: `${prop}(${rotation}deg)`, backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" } }, children));
};
export const flip = (props = {}) => ({ component: Flip, props });

// pie / circle clip paths (same geometry as @remotion/shapes makePie / makeCircle, translated in place)
const r5 = (v) => Math.round(v * 100000) / 100000;
const pieCoord = (p, R, axis) => r5(Math[axis === "x" ? "cos" : "sin"](p * Math.PI * 2 + Math.PI * 1.5) * R + R);
function piePath(progress, R, dx, dy) {
  const p = Math.min(Math.max(progress, 0), 1);
  const P = (x, y) => `${r5(x + dx)} ${r5(y + dy)}`;
  let d = `M ${P(pieCoord(0, R, "x"), pieCoord(0, R, "y"))}`;
  const mid = p <= 0.5 ? [pieCoord(p, R, "x"), pieCoord(p, R, "y")] : [pieCoord(0.5, R, "x"), pieCoord(0.5, R, "y")];
  d += ` A ${R} ${R} 0 0 1 ${P(mid[0], mid[1])}`;
  if (p > 0.5) d += ` A ${R} ${R} 0 0 1 ${P(pieCoord(p, R, "x"), pieCoord(p, R, "y"))}`;
  if (p > 0 && p < 1) d += ` L ${P(R, R)}`;
  return d + " Z";
}
const ClockWipe = ({ children, presentationDirection, presentationProgress, passedProps }) => {
  const R = Math.sqrt(passedProps.width ** 2 + passedProps.height ** 2) / 2;
  const clip = presentationDirection === "exiting" ? undefined
    : `path("${piePath(presentationProgress, R, -(R * 2 - passedProps.width) / 2, -(R * 2 - passedProps.height) / 2)}")`;
  return h(Fill, null, h(Fill, { style: { clipPath: clip } }, children));
};
export const clockWipe = (props = {}) => ({ component: ClockWipe, props });

const Iris = ({ children, presentationDirection, presentationProgress, passedProps }) => {
  const maxR = Math.sqrt(passedProps.width ** 2 + passedProps.height ** 2) / 2;
  const r = presentationDirection === "entering" ? maxR * presentationProgress : maxR - maxR * presentationProgress;
  const cx = passedProps.width / 2, cy = passedProps.height / 2;
  const clip = presentationDirection === "exiting" ? undefined
    : `path("M ${r5(cx)} ${r5(cy - r)} a ${r} ${r} 0 1 1 0 ${r * 2} a ${r} ${r} 0 1 1 0 ${-r * 2} Z")`;
  return h(Fill, null, h(Fill, { style: { clipPath: clip } }, children));
};
export const iris = (props = {}) => ({ component: Iris, props });
