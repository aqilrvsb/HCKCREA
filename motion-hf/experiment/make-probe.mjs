// Build the architecture-probe page: test footage (with sound), a product
// image, and a beep SFX at 1.0 s, then the Probe composition over them.
// usage: node experiment/make-probe.mjs <outDir> <imagePath>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { writePage } from "../build/page.mjs";

const [outDir, image] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
// 4 s 1080x1920 test pattern + 440 Hz tone (H.264/AAC like client footage)
ff(["-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(outDir, "footage.mp4")]);
ff(["-f", "lavfi", "-i", "sine=frequency=1500:duration=0.25", path.join(outDir, "beep.wav")]);
fs.copyFileSync(image, path.join(outDir, "product" + path.extname(image)));
fs.copyFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "dist", "runtime.js"),
  path.join(outDir, "runtime.js"));
writePage({
  outDir, composition: "Probe", fps: 30, durationInFrames: 120,
  props: { video: "footage.mp4", image: "product" + path.extname(image) },
  media: [
    { kind: "video", src: "footage.mp4", start: 0, duration: 4, hasAudio: true, volume: 0.4 },
    { kind: "audio", src: "beep.wav", start: 1.0, duration: 0.25, volume: 0.9 },
  ],
});
console.log("probe page written to", outDir);
