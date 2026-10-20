// Browser entry of a Laju v2 page: reads the props + composition id that the
// build step inlined, and draws the composition for whatever time HyperFrames
// seeks to. The bridge is one linear GSAP tween on a "clock" object whose
// setter draws the frame: HyperFrames seeks GSAP with events suppressed, but
// tweened property values are always written, so every seek (forward,
// backward, random, repeated) runs draw(t) synchronously before capture.
import { h, render } from "preact";
import gsap from "gsap";
import { FrameContext, setVideoConfig } from "remotion";
import { COMPOSITIONS } from "./compositions.js";

const data = JSON.parse(document.getElementById("hf-data").textContent);
const fps = data.fps || 30;
const total = Math.max(1, Math.round(data.durationInFrames));
const Comp = COMPOSITIONS[data.composition];
if (!Comp) throw new Error(`unknown composition ${data.composition}`);
setVideoConfig({ fps, durationInFrames: total, width: 1080, height: 1920, id: data.composition });

const root = document.getElementById("hf-stage");
let last = -1;
function draw(t) {
  const frame = Math.min(total - 1, Math.max(0, Math.round(t * fps)));
  if (frame === last) return;
  last = frame;
  render(h(FrameContext.Provider, { value: { frame } }, h(Comp, data.props)), root);
}

let now = 0;
const clock = {};
Object.defineProperty(clock, "t", { get: () => now, set: (v) => { now = v; draw(v); } });
const tl = gsap.timeline({ paused: true });
tl.to(clock, { t: total / fps, duration: total / fps, ease: "none", lazy: false }, 0);
window.__timelines = window.__timelines || {};
window.__timelines.main = tl;
draw(0);
