// Turn a Laju job folder (what modal_motion.py prepares for Remotion: props.json
// + the assets it points at) into a HyperFrames project in the same folder.
//
//   node build/laju-page.mjs <jobDir> <MotionEdit|MotionAd> <publicDir>
//
// publicDir = motion/public (sfx/, sfx-lib/): the SFX files the composition
// picks are copied next to the page. Asset URLs served by the Remotion job's
// local server (http://127.0.0.1:8765/<file>) become plain relative paths.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writePage } from "./page.mjs";
import { planMedia } from "../dist/planner.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [jobDir, composition, publicDir] = process.argv.slice(2);
if (!jobDir || !composition) {
  console.error("usage: node build/laju-page.mjs <jobDir> <MotionEdit|MotionAd> <publicDir>");
  process.exit(2);
}

const LOCAL = /^https?:\/\/127\.0\.0\.1:\d+\//;
const relink = (v) => {
  if (typeof v === "string") return LOCAL.test(v) ? v.replace(LOCAL, "") : v;
  if (Array.isArray(v)) return v.map(relink);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, relink(x)]));
  return v;
};

const t0 = Date.now();
const props = relink(JSON.parse(fs.readFileSync(path.join(jobDir, "props.json"), "utf8")));
const fps = props.fps || 30;
const total = Math.max(30, Math.round(props.durationInFrames || 300));
const media = planMedia(composition, props, fps, total);
const tPlan = Date.now() - t0;

// SFX / static files the composition references (sfx-lib/…, sfx/…) → copy in
let copied = 0;
for (const m of media) {
  const dest = path.join(jobDir, m.src);
  if (fs.existsSync(dest)) continue;
  const src = publicDir ? path.join(publicDir, m.src) : null;
  if (src && fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied++;
  } else {
    console.warn(`missing media: ${m.src}`);
  }
}
fs.copyFileSync(path.join(here, "..", "dist", "runtime.js"), path.join(jobDir, "runtime.js"));
writePage({ outDir: jobDir, composition, props, fps, durationInFrames: total, media });
console.log(JSON.stringify({
  ok: true, composition, frames: total, media: media.length,
  video: media.filter((m) => m.kind === "video").length, audio: media.filter((m) => m.kind === "audio").length,
  images: media.filter((m) => m.kind === "image").length, copied, plan_ms: tPlan,
}));
