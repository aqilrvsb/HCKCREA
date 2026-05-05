"use client";

import { useEffect, useRef, useState } from "react";
import type { VideoHTMLAttributes } from "react";

// LazyVideo — first-frame poster + staggered metadata load.
//
// Goals (resolving the conflict between two previous iterations):
//   ✓ Each card shows a real first-frame preview (so the grid isn't
//     12 black tiles waiting for clicks).
//   ✓ The 12 cards on a page DON'T all fire metadata fetches at once
//     (the parallel burst was what made tab-switch feel heavy).
//   ✓ Zero full-video streaming until the user clicks play.
//
// How it achieves all three:
//   1. Mount with preload="none" (zero network).
//   2. IntersectionObserver flips a "queued" flag when the card enters
//      a 50px-from-viewport zone. Queued cards register with a
//      MODULE-LEVEL token bucket — only N cards may fetch metadata at
//      any one time (default 2). When a slot opens, the next queued
//      card gets a turn, fetches its small metadata range + first
//      I-frame (~30-60KB), and renders the frame as a static poster.
//   3. preload stays at "metadata" (NOT "auto"), so we never download
//      the full video unless the user actively plays.
//
// Result: tab-switch is smooth, every card shows its real first frame
// within a second or two of viewport entry, and only the videos the
// user clicks to play actually stream bytes.

type Props = VideoHTMLAttributes<HTMLVideoElement> & {
  /** Distance before the element enters the viewport at which to start
   *  loading. Smaller = more conservative; larger = more eager. */
  rootMargin?: string;
};

// ─── Module-level concurrency limiter ────────────────────────────
// Across the whole grid (12 cards), only N can be fetching metadata
// at once. Others wait in FIFO order. Tunable: 2 keeps tab-switch
// feeling fast; 4 fills the grid faster but stutters more.
const MAX_CONCURRENT_METADATA_FETCHES = 2;
let activeFetches = 0;
const queue: Array<() => void> = [];

function acquireSlot(callback: () => void) {
  if (activeFetches < MAX_CONCURRENT_METADATA_FETCHES) {
    activeFetches += 1;
    callback();
  } else {
    queue.push(callback);
  }
}

function releaseSlot() {
  activeFetches = Math.max(0, activeFetches - 1);
  const next = queue.shift();
  if (next) {
    activeFetches += 1;
    next();
  }
}

export default function LazyVideo({
  rootMargin = "50px",
  preload: _preloadOverride,
  src,
  ...rest
}: Props) {
  const ref = useRef<HTMLVideoElement | null>(null);
  // null = not in view yet; "queued" = entered viewport, waiting for
  // a fetch slot; "loading" = actively fetching; "ready" = first frame
  // painted, no more network until user clicks play.
  const [phase, setPhase] = useState<"idle" | "queued" | "loading" | "ready">(
    "idle"
  );

  // Append a #t=0.01 hash so the browser seeks to ~first frame after
  // metadata loads — that's what paints the static poster image
  // automatically. If src already has a hash, leave it alone.
  const srcStr = typeof src === "string" ? src : "";
  const srcWithSeek =
    srcStr && !srcStr.includes("#") ? `${srcStr}#t=0.01` : srcStr;

  useEffect(() => {
    if (phase !== "idle" || !ref.current) return;
    const el = ref.current;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPhase("queued");
          obs.disconnect();
        }
      },
      { rootMargin }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [phase, rootMargin]);

  useEffect(() => {
    if (phase !== "queued") return;
    let released = false;
    acquireSlot(() => {
      setPhase("loading");
      const v = ref.current;
      if (!v) {
        if (!released) {
          released = true;
          releaseSlot();
        }
        return;
      }
      // Once metadata loads (small range fetch), the browser paints the
      // first frame and `loadeddata` fires. Mark ready + free the slot
      // so the next queued card gets its turn.
      const onReady = () => {
        v.removeEventListener("loadeddata", onReady);
        v.removeEventListener("error", onError);
        setPhase("ready");
        if (!released) {
          released = true;
          releaseSlot();
        }
      };
      const onError = () => {
        v.removeEventListener("loadeddata", onReady);
        v.removeEventListener("error", onError);
        setPhase("ready"); // give up gracefully — show black tile
        if (!released) {
          released = true;
          releaseSlot();
        }
      };
      v.addEventListener("loadeddata", onReady);
      v.addEventListener("error", onError);
      // Hard timeout: if metadata never loads in 8s (fal/Crun slow),
      // free the slot so we don't deadlock the queue.
      const t = window.setTimeout(() => {
        if (!released) {
          released = true;
          v.removeEventListener("loadeddata", onReady);
          v.removeEventListener("error", onError);
          setPhase("ready");
          releaseSlot();
        }
      }, 8000);
      return () => {
        window.clearTimeout(t);
      };
    });
    return () => {
      // If the component unmounts while still queued/loading, release
      // the slot so we don't leak it. Idempotent-guarded.
      if (!released) {
        released = true;
        releaseSlot();
      }
    };
  }, [phase]);

  // Decide what `preload` value to send the browser based on phase:
  //   idle / queued → "none" (no network yet)
  //   loading / ready → "metadata" (small range + first frame; never full video)
  //   override → caller's explicit value wins
  const effectivePreload =
    _preloadOverride ??
    (phase === "loading" || phase === "ready" ? "metadata" : "none");

  return (
    <video
      ref={ref}
      preload={effectivePreload}
      src={phase === "idle" ? undefined : srcWithSeek}
      // Helps Safari / iOS keep things inline + decode lighter
      playsInline
      {...rest}
    />
  );
}
