"use client";

import { useRef, useState } from "react";
import type { VideoHTMLAttributes } from "react";

// LazyVideo — Thumbnail-first video player.
//
// Old behaviour was to preload metadata/first-frame as soon as a card entered
// the viewport. With 12+ cards on the UGC / Auto Content grid that meant 12
// parallel video-metadata fetches the moment the tab loaded — saturating
// the network and freezing the main thread for a beat.
//
// New behaviour: render an IMG poster only, zero <video> requests on mount.
// The <video> element is mounted lazily ONLY after the user clicks the
// thumbnail's play button. Subsequent clicks pause/play normally because
// the video element stays mounted once activated.
//
// Result: tab-switch is instant regardless of how many cards are on the
// page. The only video that loads bytes is the one the user actually
// chose to watch.
//
// Drop-in replacement for <video> — accepts every native attr.

type Props = VideoHTMLAttributes<HTMLVideoElement> & {
  /** Poster image shown before the user clicks play. Falls back to the
   *  video's native poster attr if you also set one; with no poster at
   *  all, a black tile + play button is shown. */
  poster?: string;
  /** Optional className applied to the wrapping container. The <video>
   *  itself gets the className from the rest props (so existing styles
   *  on cards keep working unchanged). */
  wrapperClassName?: string;
  /** Legacy prop from the old eager-preload implementation — accepted
   *  but ignored so existing callsites don't break. */
  rootMargin?: string;
};

export default function LazyVideo({
  poster,
  wrapperClassName,
  rootMargin: _ignored,
  preload: _preloadOverride,
  className,
  src,
  controls,
  autoPlay,
  ...rest
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // activated stays false until the user clicks the play overlay. Once
  // true, the <video> element mounts and stays mounted (so subsequent
  // pause/play through native controls works normally).
  const [activated, setActivated] = useState(!!autoPlay);

  function handlePlayClick() {
    setActivated(true);
    // Defer to the next paint so the <video> element exists, then call
    // play(). Browsers count this as a user gesture so autoplay is OK.
    setTimeout(() => {
      const v = videoRef.current;
      if (v) v.play().catch(() => {});
    }, 0);
  }

  if (!activated) {
    // Poster-only stage. Zero network until the user clicks.
    return (
      <div
        className={wrapperClassName || className}
        style={{ position: "relative", background: "#000" }}
      >
        {poster ? (
          <img
            src={poster}
            alt=""
            className={className}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
          />
        ) : null}
        <button
          type="button"
          onClick={handlePlayClick}
          aria-label="Play video"
          className="absolute inset-0 flex items-center justify-center group cursor-pointer"
          style={{ background: poster ? "rgba(0,0,0,0)" : "#000" }}
        >
          <span
            className="flex items-center justify-center rounded-full transition-transform group-hover:scale-110"
            style={{
              width: 48,
              height: 48,
              background: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(4px)",
              border: "2px solid rgba(255,255,255,0.85)",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </button>
      </div>
    );
  }

  // User clicked — mount the real video element. preload="metadata" is
  // fine here because exactly ONE video is mounted per click; we never
  // saturate the network with parallel fetches.
  return (
    <video
      ref={videoRef}
      className={className}
      src={src}
      controls={controls ?? true}
      poster={poster}
      preload={_preloadOverride ?? "metadata"}
      playsInline
      {...rest}
    />
  );
}
