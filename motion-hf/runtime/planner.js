// Node-side media planner: render the real composition at every frame with the
// collector on, and return the static media list the page must declare.
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { FrameContext, setVideoConfig } from "remotion";
import { COMPOSITIONS } from "./compositions.js";
import { COLLECT, collected } from "./collect.js";

export function planMedia(composition, props, fps, totalFrames) {
  const Comp = COMPOSITIONS[composition];
  if (!Comp) throw new Error(`unknown composition ${composition}`);
  setVideoConfig({ fps, durationInFrames: totalFrames, width: 1080, height: 1920, id: composition });
  COLLECT.on = true;
  COLLECT.seen.clear();
  try {
    for (let f = 0; f < totalFrames; f++) {
      COLLECT.frame = f;
      renderToString(h(FrameContext.Provider, { value: { frame: f, abs: 0, dur: Infinity } }, h(Comp, props)));
    }
  } finally {
    COLLECT.on = false;
  }
  return collected(fps, totalFrames);
}
