// Laju v2 build of motion/src/emoji.tsx: the same component, but the Lottie
// JSON comes from the page's preload (runtime/preload.js) synchronously, so
// no captured frame ever shows the fallback glyph while a file is loading.
import React from "react";
import { Lottie } from "@remotion/lottie";
import { LOTTIE_DATA } from "../runtime/preload.js";
import type { LottieMap } from "../../motion/src/types";

export const LottieEmoji: React.FC<{ char: string; size: number; lottie?: LottieMap }> = ({ char, size, lottie }) => {
  const url = lottie?.[char];
  const data = url ? LOTTIE_DATA.get(url) : null;
  if (!data) {
    return <span style={{ fontSize: size * 0.88, lineHeight: 1, display: "inline-block" }}>{char}</span>;
  }
  return (
    <div style={{ width: size, height: size, display: "inline-block" }}>
      <Lottie animationData={data} loop style={{ width: size, height: size }} />
    </div>
  );
};
