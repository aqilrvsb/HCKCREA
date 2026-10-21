// A Remotion-compatible API on Preact, driven by the HyperFrames clock.
// Lets the Laju compositions in motion/src (written for Remotion) render
// unchanged inside a HyperFrames page: the same components, the same frame
// math, so every frame matches the Remotion renderer.
//
// Media is the one thing that works differently. HyperFrames must see every
// <video> / <audio> / animated image in the static HTML (it extracts frames and
// mixes audio from them), so the build step (build/page.mjs) emits those
// elements with data-start / data-duration, and the shim components below
// *adopt* the matching element into their spot in the tree instead of
// creating media. <Audio> renders nothing here: its sound is a static element.
import { h, createContext, Fragment } from "preact";
import { useContext } from "preact/hooks";
import * as lib from "../runtime/lib.js";
import { COLLECT, record } from "../runtime/collect.js";

// frame = the local frame; abs = the absolute frame where local 0 sits; dur = the
// enclosing Sequence's length (Infinity at the top level)
export const FrameContext = createContext({ frame: 0, abs: 0, dur: Infinity });

let VIDEO_CONFIG = { fps: 30, durationInFrames: 1, width: 1080, height: 1920, id: "main", defaultProps: {} };
export const setVideoConfig = (cfg) => { VIDEO_CONFIG = { ...VIDEO_CONFIG, ...cfg }; };

export const useCurrentFrame = () => useContext(FrameContext).frame;
export const useVideoConfig = () => VIDEO_CONFIG;

export const Easing = lib.Easing;

export function interpolate(x, input, output, opts = {}) {
  return lib.interpolate(x, input, output, {
    left: opts.extrapolateLeft ?? "extend",
    right: opts.extrapolateRight ?? "extend",
    easing: opts.easing,
  });
}

export function spring({ frame, fps, config = {}, from = 0, to = 1 }) {
  const v = lib.spring(frame, fps, config);
  return from + (to - from) * v;
}

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", display: "flex", flexDirection: "column" };
export const AbsoluteFill = ({ style, className, children }) => h("div", { className, style: { ...FILL, ...(style || {}) } }, children);

export const Sequence = ({ from = 0, durationInFrames = Infinity, layout, style, children }) => {
  const parent = useContext(FrameContext);
  const frame = parent.frame - from;
  if (frame < 0 || frame >= durationInFrames) return null;
  const inner = h(FrameContext.Provider, { value: { frame, abs: parent.abs + from, dur: durationInFrames } }, children);
  return layout === "none" ? inner : h("div", { style: { ...FILL, ...(style || {}) } }, inner);
};

export const Img = ({ src, style, className, alt }) => h("img", { src, style, className, alt: alt || "" });

// ── adopted static media ──────────────────────────────────────────────────────
// The build step tags each static media element with data-hf-src = the URL the
// composition asks for; the shim moves that element into its place (once) and
// applies the requested style. Preact keeps the wrapper across frames, so the
// element is moved only on first mount.
const adopt = (src, style) => (wrap) => {
  if (!wrap) return;
  const el = document.querySelector(`[data-hf-src="${CSS.escape(String(src))}"]`);
  if (!el) return;
  if (el.parentNode !== wrap) wrap.appendChild(el);
  Object.assign(el.style, { width: "100%", height: "100%", display: "block", ...(style ? cssObj(style) : {}) });
};
const cssObj = (style) => {
  const out = {};
  for (const [k, v] of Object.entries(style)) out[k] = typeof v === "number" && !/opacity|zIndex|flex|scale/i.test(k) ? `${v}px` : v;
  return out;
};
const MediaSlot = ({ src, style }) => h("div", { ref: adopt(src, style), style: { position: "relative", width: "100%", height: "100%" } });
const vol = (v) => (typeof v === "number" ? v : 1);

export const OffthreadVideo = ({ src, style, muted, volume }) => {
  const ctx = useContext(FrameContext);
  if (COLLECT.on) record("video", src, ctx, { muted: !!muted, volume: vol(volume) });
  return h(MediaSlot, { src, style });
};
export const Video = OffthreadVideo;
export const AnimatedImage = ({ src, style, width, height }) => {
  const ctx = useContext(FrameContext);
  // the job turns animated stickers into VP9-alpha WebM: played as muted video, frame by frame
  if (COLLECT.on) {
    if (/\.webm(\?|$)/i.test(String(src))) record("video", src, ctx, { muted: true, volume: 0 });
    else record("image", src, ctx);
  }
  return h(MediaSlot, { src, style: { ...(style || {}), ...(width ? { width } : {}), ...(height ? { height } : {}) } });
};
// sound is a static <audio> element emitted by the build step
export const Audio = ({ src, volume }) => {
  const ctx = useContext(FrameContext);
  if (COLLECT.on) record("audio", src, ctx, { volume: vol(volume) });
  return null;
};

// ── misc ──────────────────────────────────────────────────────────────────────
export const staticFile = (p) => String(p).replace(/^\/+/, "");
let handles = 0;
export const delayRender = () => ++handles;
export const continueRender = () => {};
export const cancelRender = (e) => { throw e instanceof Error ? e : new Error(String(e)); };
// Remotion's random(): mulberry32 over a string hash / scaled number (same values)
const mulberry32 = (a) => {
  let t = a + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hashCode = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) { hash = (hash << 5) - hash + str.charCodeAt(i); hash |= 0; }
  return hash;
};
export const random = (seed) => {
  if (seed === null) throw new Error("random(null) is not deterministic");
  if (typeof seed === "string") return mulberry32(hashCode(seed));
  return mulberry32(seed * 10000000000);
};
export const Composition = () => null;
export const registerRoot = () => {};
export { Fragment };
