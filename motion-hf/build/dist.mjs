// Distributed render of a Laju v2 page (HyperFrames Plan v2), one role per call:
//
//   node build/dist.mjs plan <projectDir> <planDir> <chunkFrames>
//   node build/dist.mjs chunk <planDir> <index> <out.mp4>
//   node build/dist.mjs assemble <planDir> <out.mp4> <chunk0.mp4> <chunk1.mp4> ...
//
// The orchestrator (modal_motion.py) plans, fans the chunks out to containers
// and assembles. Each call prints one JSON line.
//
// chunkFrames must be a multiple of the fps (whole seconds): HyperFrames 0.8.181
// extracts the source video one frame early in a chunk that starts at a
// fractional second (measured: 41-frame chunks lag the in-process render by one
// frame from frame 41 on; 30/60/81/162/324-frame chunks match it exactly).
import fs from "node:fs";
import path from "node:path";
import { planV2, renderChunkV2, assembleV2 } from "@hyperframes/producer/distributed";

// the Chrome `hyperframes browser ensure` installed (the same binary in every container)
if (!process.env.PRODUCER_HEADLESS_SHELL_PATH) {
  const find = (d) => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        const r = find(p);
        if (r) return r;
      } else if (e.name === "chrome-headless-shell") return p;
    }
    return null;
  };
  const bin = find(path.join(process.env.HOME || "/root", ".cache", "hyperframes"));
  if (bin) process.env.PRODUCER_HEADLESS_SHELL_PATH = bin;
}

const FPS = 30;
const [cmd, ...a] = process.argv.slice(2);
const t0 = Date.now();
try {
  if (cmd === "plan") {
    const [projectDir, planDir, chunkFrames] = a;
    const size = Number(chunkFrames);
    if (!(size > 0) || size % FPS) throw new Error(`chunkFrames must be a whole number of seconds (got ${chunkFrames})`);
    const r = await planV2(projectDir, {
      fps: FPS, width: 1080, height: 1920, format: "mp4", quality: "standard", chunkSize: size, maxParallelChunks: 64,
    }, planDir);
    console.log(JSON.stringify({ ok: true, chunkCount: r.chunkCount, totalFrames: r.totalFrames, ms: Date.now() - t0 }));
  } else if (cmd === "chunk") {
    const [planDir, idx, out] = a;
    const r = await renderChunkV2(planDir, Number(idx), out);
    console.log(JSON.stringify({ ok: true, frames: r.framesEncoded, range: r.frameRange, mode: r.captureMode, workers: r.workers,
      boot: r.sessionBootMs, capture: r.captureStageMs, encode: r.encodeStageMs, ms: Date.now() - t0 }));
  } else if (cmd === "assemble") {
    const [planDir, out, ...chunks] = a;
    const r = await assembleV2(planDir, chunks, out);
    console.log(JSON.stringify({ ok: true, frames: r.framesEncoded, bytes: r.fileSize, ms: Date.now() - t0 }));
  } else {
    throw new Error("usage: plan | chunk | assemble");
  }
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e && e.stack || e).slice(0, 1500) }));
  process.exit(1);
}
