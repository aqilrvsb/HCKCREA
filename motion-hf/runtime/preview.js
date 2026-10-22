// Browser entry of the CLIPPER Studio preview (public/clipper-preview/): the very composition a clip render draws
// (MotionEditPro through the Remotion shim, as in entry.js), but driven live by the clip's own <video> instead of
// the HyperFrames clock — so the client sees the caption look, hook, keyword colours and zooms on the real clip
// and changes them before paying for a render.
//
// The parent page (same origin) calls window.__clipPreview.load(cfg) with
//   { props, src, frame, segs: [{a, b, at, teaser?}], dur, flashAt, clipStart, watermark: {text?, image?}, track? }
// track: "face" on a wide source — the speaker's face centre x over the clip (clip seconds), for the camera.
// segs: what plays — clip seconds [a, b) at timeline second `at` (cold open first, long pauses cut).
import { h, render } from "preact";
import { FrameContext, setVideoConfig } from "remotion";
import { MotionEditPro } from "../overrides/MotionEditPro.tsx";
import { preloadLottie } from "./preload.js";

const KEY = "clip://preview";
const rootEl = document.getElementById("hf-root");
const stage = document.getElementById("hf-stage");
const park = document.getElementById("hf-park");

// ── the clip's media: one <video> (sound + clock) and the frame mode's layers, in one box the composition adopts ──
const media = document.createElement("div");
media.className = "hf-parked pv-media";
media.setAttribute("data-hf-src", KEY);
const video = document.createElement("video");
video.playsInline = true;
video.preload = "auto";
video.muted = true;
const bg = document.createElement("canvas"); // "fit": the whole frame over a blurred copy
const top = document.createElement("canvas"); // "split": left person on top …
const bottom = document.createElement("canvas"); // … right person below
const flash = document.createElement("div"); // the white flash after the cold open
bg.className = "pv-bg";
top.className = "pv-top";
bottom.className = "pv-bottom";
flash.className = "pv-flash";
for (const el of [bg, video, top, bottom, flash]) media.appendChild(el);
park.appendChild(media);

const wm = document.createElement("div"); // the @handle / logo, top right, burned in after the render
wm.className = "pv-wm";
rootEl.appendChild(wm);

let cfg = null;
let props = null;
let fps = 30;
let total = 1;
let lastFrame = -1;
let seg = 0;
let t = 0;
let playing = false;
let req = 0;
let listeners = [];
const emit = () => listeners.forEach((fn) => { try { fn(state()); } catch (e) { /* parent gone */ } });
const state = () => ({ t, dur: cfg ? cfg.dur : 0, playing, muted: video.muted, ready: !!props, waiting: video.readyState < 3 });

function draw(force) {
  if (!props) return;
  const frame = Math.min(total - 1, Math.max(0, Math.round(t * fps)));
  if (!force && frame === lastFrame) return;
  lastFrame = frame;
  render(h(FrameContext.Provider, { value: { frame, abs: 0, dur: Infinity } }, h(MotionEditPro, props)), stage);
}

// "face" on a wide source: the crop follows the speaker's face (camera.py: holds still, eases to a new centre)
let camX = null;
function follow() {
  const tr = cfg.track;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!tr || !tr.length || !vw || !vh) {
    video.style.objectPosition = "50% 50%";
    return;
  }
  const fr = (9 / 16) / (vw / vh); // the part of the width the 9:16 crop keeps
  if (fr >= 0.99) return;
  const ct = video.currentTime - cfg.clipStart;
  let lo = 0, hi = tr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tr[mid].t < ct) lo = mid + 1; else hi = mid;
  }
  const s = lo > 0 && Math.abs(tr[lo - 1].t - ct) < Math.abs(tr[lo].t - ct) ? tr[lo - 1] : tr[lo];
  const target = Math.min(1, Math.max(0, (s.cx - fr / 2) / (1 - fr)));
  if (camX === null || !playing) camX = target;
  else if (Math.abs(target - camX) > 0.04) camX += (target - camX) * 0.12;
  video.style.objectPosition = `${(camX * 100).toFixed(2)}% 50%`;
}

// the frame mode's layers (ffmpeg's _reframe / _normalise, approximated)
function paintLayers() {
  if (!cfg || video.readyState < 2) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const mode = cfg.frame;
  if (mode === "fit") {
    const c = bg.getContext("2d");
    const s = Math.max(bg.width / vw, bg.height / vh);
    c.drawImage(video, (bg.width - vw * s) / 2, (bg.height - vh * s) / 2, vw * s, vh * s);
  } else if (mode === "split") {
    // each half: a 9:8 box around one side of the frame (the render centres it on that person's face)
    for (const [cv, cx] of [[top, 0.27], [bottom, 0.73]]) {
      let hh = vh, ww = (hh * 9) / 8;
      if (ww > vw) { ww = vw; hh = (ww * 8) / 9; }
      const x = Math.min(vw - ww, Math.max(0, cx * vw - ww / 2));
      cv.getContext("2d").drawImage(video, x, (vh - hh) * 0.35, ww, hh, 0, 0, cv.width, cv.height);
    }
  }
}

function layout() {
  const mode = cfg ? cfg.frame : "face";
  media.dataset.frame = mode;
  bg.width = 270; bg.height = 480;
  top.width = 540; top.height = 480;
  bottom.width = 540; bottom.height = 480;
  // a vertical source fills the frame as it is
  video.style.objectFit = mode === "fit" ? "contain" : "cover";
}

function fit() {
  const s = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
  rootEl.style.transform = `translate(${(window.innerWidth - 1080 * s) / 2}px, ${(window.innerHeight - 1920 * s) / 2}px) scale(${s})`;
}
window.addEventListener("resize", fit);
fit();

const segAt = (tt) => {
  const ss = cfg.segs;
  for (let i = ss.length - 1; i >= 0; i--) if (tt >= ss[i].at - 1e-6) return i;
  return 0;
};
const srcOf = (i, tt) => cfg.clipStart + cfg.segs[i].a + Math.max(0, tt - cfg.segs[i].at);

function seekTo(tt) {
  if (!cfg) return;
  t = Math.max(0, Math.min(cfg.dur - 0.05, tt));
  seg = segAt(t);
  try { video.currentTime = srcOf(seg, t); } catch (e) { /* not loaded yet */ }
  draw(true);
  emit();
}

function tick() {
  requestAnimationFrame(tick);
  try {
    frameStep();
  } catch (e) {
    // one bad frame never stops the preview: the next frame tries again
  }
}
function frameStep() {
  if (cfg && props && cfg.segs.length) {
    if (seg >= cfg.segs.length) seg = 0;
    if (playing && !video.seeking && video.readyState >= 2) {
      const s = cfg.segs[seg];
      const ct = video.currentTime - cfg.clipStart;
      if (ct >= s.b - 0.03 || ct < s.a - 0.6) {
        // next kept piece (a jump cut / the cold open's end), back to the start after the last
        seg = ct < s.a - 0.6 ? seg : seg + 1;
        if (seg >= cfg.segs.length) seg = 0;
        t = cfg.segs[seg].at;
        video.currentTime = cfg.clipStart + cfg.segs[seg].a;
      } else {
        t = s.at + Math.max(0, ct - s.a);
      }
    }
    follow();
    const f = cfg.flashAt;
    flash.style.opacity = f == null ? "0" : t >= f - 0.1 && t < f ? String((t - (f - 0.1)) / 0.1) : t >= f && t < f + 0.15 ? String(1 - (t - f) / 0.15) : "0";
    paintLayers();
    draw(false);
    if (playing) emit();
  }
}
requestAnimationFrame(tick);

// every face the composition may use is loaded before the first draw: the plan measures text with the real fonts
const FACES = ["800 40px Montserrat", "900 40px Montserrat", "40px 'Archivo Black'", "40px Anton", "40px 'Bebas Neue'", "700 40px Inter", "800 40px Inter",
  "900 40px Inter", "800 40px Poppins", "900 40px Poppins", "40px 'Permanent Marker'", "40px 'Patrick Hand'", "800 40px 'Playfair Display'",
  "800 40px 'JetBrains Mono'", "40px 'Press Start 2P'", "40px Bangers", "700 40px Fredoka", "700 40px 'Noto Sans'"];
let fontsReady = null;
const loadFonts = () => (fontsReady ||= Promise.race([
  Promise.all(FACES.map((f) => document.fonts.load(f, "AaBb1!").catch(() => null))),
  new Promise((r) => setTimeout(r, 8000)),
]));

async function load(next) {
  const my = ++req;
  if (!next || !next.segs || !next.segs.length) return;
  const prev = cfg;
  const srcChanged = !prev || prev.src !== next.src;
  // the same clip with another look: keep its place in the source (the same moment, in the new timeline);
  // another clip (or video): from its start
  const ps = prev && !srcChanged && prev.clipStart === next.clipStart ? prev.segs[Math.min(seg, prev.segs.length - 1)] : null;
  const keepSrc = ps ? prev.clipStart + ps.a + Math.max(0, t - ps.at) : null;
  await Promise.all([loadFonts(), preloadLottie(next.props && next.props.lottie)]);
  if (my !== req) return;
  // the adopted media goes back to the park before the composition is replaced (its plan is made on mount)
  park.appendChild(media);
  render(null, stage);
  cfg = next;
  props = next.props;
  fps = props.fps || 30;
  total = Math.max(1, Math.round(props.durationInFrames));
  setVideoConfig({ fps, durationInFrames: total, width: 1080, height: 1920, id: "MotionEdit" });
  layout();
  wm.innerHTML = "";
  if (next.watermark && next.watermark.image) {
    const im = document.createElement("img");
    im.src = next.watermark.image;
    im.className = "pv-wm-logo";
    wm.appendChild(im);
  } else if (next.watermark && next.watermark.text) {
    const sp = document.createElement("span");
    sp.textContent = next.watermark.text;
    sp.className = "pv-wm-text";
    wm.appendChild(sp);
  }
  if (keepSrc == null) {
    camX = null;
    if (srcChanged) video.src = next.src;
    t = 0;
    seg = 0;
    video.currentTime = next.clipStart + next.segs[0].a;
  } else {
    const ct = keepSrc - next.clipStart;
    let i = next.segs.findIndex((s) => ct >= s.a - 0.05 && ct < s.b);
    if (i < 0) i = Math.max(0, next.segs.findIndex((s) => s.a > ct));
    seg = i;
    t = next.segs[i].at + Math.max(0, ct - next.segs[i].a);
    if (Math.abs(video.currentTime - keepSrc) > 0.3) video.currentTime = next.clipStart + next.segs[i].a + Math.max(0, ct - next.segs[i].a);
  }
  lastFrame = -1;
  draw(true);
  if (next.autoplay && !playing) play();
  emit();
}

function play() {
  if (!cfg) return;
  playing = true;
  const p = video.play();
  if (p && p.catch) p.catch(() => { video.muted = true; video.play().catch(() => { playing = false; emit(); }); });
  emit();
}
function pause() {
  playing = false;
  video.pause();
  emit();
}

video.addEventListener("waiting", emit);
video.addEventListener("playing", emit);
video.addEventListener("canplay", () => { paintLayers(); emit(); });
// a click on the video plays / pauses it
rootEl.addEventListener("click", () => (playing ? pause() : play()));

window.__clipPreview = {
  load,
  play,
  pause,
  seek: seekTo,
  restart: () => seekTo(0),
  mute: (m) => { video.muted = !!m; emit(); },
  state,
  on: (fn) => { listeners.push(fn); return () => { listeners = listeners.filter((x) => x !== fn); }; },
};
window.dispatchEvent(new Event("clip-preview-ready"));
