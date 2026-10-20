// Write one Laju v2 HyperFrames page (index.html) for a composition + props.
// Media the composition plays (the footage, B-roll clips, GIF stickers, music,
// SFX) is listed by the caller and emitted as static elements with their
// timing, because HyperFrames reads media from the HTML before any script
// runs. The runtime's shim adopts each element into its place by data-hf-src.
//
// usage (from code): writePage({ outDir, composition, props, fps, durationInFrames, media, runtime })
//   media: [{ kind: "video"|"audio"|"image", src, start, duration?, volume?, hasAudio?, mediaStart? }]
import fs from "node:fs";
import path from "node:path";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const num = (n) => Number(n).toFixed(3).replace(/\.?0+$/, "");

// Families the Laju compositions use. The CSS declarations alone let the HyperFrames
// compiler fetch them and inject deterministic @font-face rules.
const FONT_FACES = [
  // not in HyperFrames' auto-resolved Google list: shipped with the page (fonts/, OFL / Apache-2.0)
  "@font-face{font-family:'Permanent Marker';font-style:normal;font-weight:400;font-display:block;src:url(fonts/PermanentMarker-latin.woff2) format('woff2')}",
  "@font-face{font-family:'Patrick Hand';font-style:normal;font-weight:400;font-display:block;src:url(fonts/PatrickHand-latin.woff2) format('woff2')}",
].join("\n");
const FONT_RULES = [
  ".hf-f1{font-family:'Permanent Marker',cursive}",
  ".hf-f2{font-family:'Patrick Hand',cursive}",
  ".hf-f3{font-family:'Archivo Black',sans-serif}",
  ".hf-f4{font-family:'Inter',sans-serif;font-weight:700}",
  ".hf-f5{font-family:'Inter',sans-serif;font-weight:800}",
  ".hf-f6{font-family:'Inter',sans-serif;font-weight:900}",
  ".hf-f7{font-family:'Montserrat',sans-serif;font-weight:800}",
  ".hf-f8{font-family:'Montserrat',sans-serif;font-weight:900}",
].join("\n");

export function writePage({ outDir, composition, props, fps = 30, durationInFrames, media = [], runtime = "runtime.js" }) {
  const dur = durationInFrames / fps;
  const items = media.map((m, i) => {
    const id = `hf-m${i}`;
    const timing = `data-start="${num(m.start || 0)}"${m.duration ? ` data-duration="${num(m.duration)}"` : ""}`
      + (m.mediaStart ? ` data-media-start="${num(m.mediaStart)}"` : "");
    if (m.kind === "audio") {
      return `<audio id="${id}" src="${esc(m.src)}" ${timing} data-volume="${num(m.volume ?? 1)}"></audio>`;
    }
    if (m.kind === "image") {
      return `<img id="${id}" class="hf-parked" data-hf-src="${esc(m.src)}" src="${esc(m.src)}" ${timing} alt="" />`;
    }
    const sound = m.hasAudio ? `data-has-audio="true" data-volume="${num(m.volume ?? 1)}"` : "muted";
    return `<video id="${id}" class="hf-parked" data-hf-src="${esc(m.src)}" src="${esc(m.src)}" ${timing} ${sound} playsinline></video>`;
  });
  const data = JSON.stringify({ composition, fps, durationInFrames, props }).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html lang="ms">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1080, height=1920" />
<style>
html,body{margin:0;padding:0;background:#000}
#hf-root{position:relative;width:1080px;height:1920px;overflow:hidden;background:#000}
#hf-stage{position:absolute;inset:0}
#hf-park{position:absolute;inset:0;visibility:hidden;pointer-events:none}
.hf-parked{position:absolute;inset:0;width:100%;height:100%}
${FONT_FACES}
${FONT_RULES}
</style>
</head>
<body>
<div id="hf-root" data-composition-id="main" data-start="0" data-duration="${num(dur)}" data-width="1080" data-height="1920">
<div id="hf-stage"></div>
<div id="hf-park">
${items.join("\n")}
</div>

</div>
<script id="hf-data" type="application/json">${data}</script>
<script src="gsap.min.js"></script>
<script src="${esc(runtime)}"></script>
<script>
  // HyperFrames clock: one linear tween whose setter draws the seeked frame (see runtime/entry.js)
  window.__timelines = window.__timelines || {};
  window.__laju.ready.then(function () {
    var now = 0, clock = {};
    Object.defineProperty(clock, "t", { get: function () { return now; }, set: function (v) { now = v; window.__laju.draw(v); } });
    var tl = gsap.timeline({ paused: true });
    tl.to(clock, { t: window.__laju.duration, duration: window.__laju.duration, ease: "none", lazy: false }, 0);
    window.__timelines["main"] = tl;
  });
</script>
</body>
</html>
`;
  fs.mkdirSync(path.join(outDir, "fonts"), { recursive: true });
  const fontsSrc = new URL("../fonts/", import.meta.url);
  for (const f of ["PermanentMarker-latin.woff2", "PatrickHand-latin.woff2"]) {
    fs.copyFileSync(new URL(f, fontsSrc), path.join(outDir, "fonts", f));
  }
  fs.copyFileSync(new URL("../node_modules/gsap/dist/gsap.min.js", import.meta.url), path.join(outDir, "gsap.min.js"));
  fs.writeFileSync(path.join(outDir, "index.html"), html);
  // same shape `hyperframes init` writes, registry pinned to the tag we run
  fs.writeFileSync(path.join(outDir, "hyperframes.json"), JSON.stringify({
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/ae02e5aceff4742e5d72c20f0859eb3e6b449035/registry",
    paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
    media: { autoProxy: true },
  }, null, 2));
  fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify({ id: "laju-v2", name: "laju-v2" }, null, 2));
}
