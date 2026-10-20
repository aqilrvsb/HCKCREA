// Architecture probe: a component written against the Remotion API (exactly
// like motion/src), rendered by HyperFrames through the Preact shim.
// Checks: the clock drives every frame, an adopted static <video> follows a
// transformed parent, <Img> stays decoded across frames, springs/interpolate
// match, and audio comes from static elements.
import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from "remotion";

export const Probe: React.FC<{ video: string; image: string }> = ({ video, image }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const zoom = 1 + 0.15 * interpolate(frame, [0, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const pop = spring({ frame: frame - 15, fps, config: { damping: 12, stiffness: 180, mass: 0.7 } });
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ transform: `scale(${zoom}) rotate(${frame * 0.2}deg)` }}>
        <OffthreadVideo src={video} style={{ objectFit: "cover" }} />
      </AbsoluteFill>
      <div style={{ position: "absolute", top: 260, left: 0, right: 0, textAlign: "center", fontFamily: "'Archivo Black', sans-serif",
        fontSize: 120, color: "#FFD93B", WebkitTextStroke: "10px #000", paintOrder: "stroke fill", transform: `scale(${0.3 + 0.7 * pop})` }}>
        FRAME {frame}
      </div>
      <Img src={image} style={{ position: "absolute", left: 290, top: 1150, width: 500, borderRadius: 24,
        transform: `translateY(${(1 - pop) * 200}px)`, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }} />
    </AbsoluteFill>
  );
};
