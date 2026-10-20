// Browser entry of a Laju v2 page. The bundle draws the composition for any
// time HyperFrames seeks to; the page's inline script registers the timeline
// (so `hyperframes lint` sees the registration) once window.__laju.ready
// resolves. The bridge is one linear GSAP tween on a "clock" object whose
// setter calls window.__laju.draw(t): HyperFrames seeks GSAP with events
// suppressed, but tweened property values are always written, so every seek
// (forward, backward, random, repeated) draws its frame synchronously.
import { h, render } from "preact";
import { FrameContext, setVideoConfig } from "remotion";
import { COMPOSITIONS } from "./compositions.js";
import { preloadLottie } from "./preload.js";

// GSAP is loaded by its own <script> tag (hyperframes lint: missing_gsap_script)
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

// everything a frame needs must be in memory before the first frame is drawn
const ready = preloadLottie(data.props && data.props.lottie).then(() => {
  if (document.fonts && document.fonts.ready) return document.fonts.ready;
}).then(() => { draw(0); });

window.__laju = { draw, duration: total / fps, ready };
