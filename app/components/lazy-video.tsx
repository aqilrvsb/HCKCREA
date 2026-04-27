"use client";

import { useEffect, useRef, useState } from "react";
import type { VideoHTMLAttributes } from "react";

// LazyVideo — renders a <video> that only fetches metadata/first-frame once
// the element enters the viewport. Solves "black rectangle" cards that
// preload="none" creates on poster-less video grids.
//
// Until in view: preload="none" (zero network).
// Once in view: preload="metadata" (browser fetches the small metadata range
//   AND paints the first frame as the natural poster — instantly visible).
//
// Drop-in replacement for <video> — accepts every native attr.

type Props = VideoHTMLAttributes<HTMLVideoElement> & {
  /** Distance before the element enters the viewport at which to start
   *  loading. "200px" = start preloading when card is 200px from being on
   *  screen. Tune higher if you want even more eager loading. */
  rootMargin?: string;
};

export default function LazyVideo({
  rootMargin = "200px",
  preload: _preloadOverride,
  ...rest
}: Props) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView || !ref.current) return;
    const el = ref.current;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          obs.disconnect();
        }
      },
      { rootMargin }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView, rootMargin]);

  return (
    <video
      ref={ref}
      // preload swaps from "none" → "metadata" exactly once when in view.
      // Caller can force a value via the prop — useful for the hero/featured
      // video which autoplays and must preload eagerly.
      preload={_preloadOverride ?? (inView ? "metadata" : "none")}
      {...rest}
    />
  );
}
