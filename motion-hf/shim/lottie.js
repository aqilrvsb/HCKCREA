// @remotion/lottie for the Laju v2 shim: a lottie-web player drawn
// synchronously at the composition's frame (like Remotion's <Lottie>, which
// seeks to the current frame), so every captured frame is exact.
import { h } from "preact";
import { useRef } from "preact/hooks";
import lottie from "lottie-web/build/player/lottie_svg";
import { useCurrentFrame, useVideoConfig } from "remotion";

export const Lottie = ({ animationData, loop = true, playbackRate = 1, style, className }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const anim = useRef(null);
  const box = useRef(null);
  const seek = () => {
    const a = anim.current;
    if (!a) return;
    const total = a.getDuration(true); // in animation frames
    let f = (frame / fps) * playbackRate * a.frameRate;
    f = loop ? ((f % total) + total) % total : Math.min(f, total - 1);
    a.goToAndStop(f, true);
  };
  const mount = (el) => {
    if (!el || box.current === el) return;
    box.current = el;
    if (anim.current) anim.current.destroy();
    anim.current = lottie.loadAnimation({ container: el, renderer: "svg", loop, autoplay: false, animationData });
    seek();
  };
  seek();
  return h("div", { ref: mount, className, style });
};
