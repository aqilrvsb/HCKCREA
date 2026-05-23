"use client";

import { useEffect, useRef, useState } from "react";
import type { VideoHTMLAttributes } from "react";

// LazyVideo — poster-first viewer with IndexedDB cache.
//
// First time a card mounts: a hidden <video> loads metadata, the first
// frame paints, we draw it to a canvas, export as a JPG blob, and store
// it in IndexedDB keyed by the video URL.
//
// EVERY subsequent mount of the same URL (in this browser): we read
// the cached blob from IndexedDB and render <img src={objectURL}>
// instead of <video> — no metadata fetch, no decoder, ~5ms paint.
//
// CORS: capturing a frame to canvas requires the video to be loaded
// with crossOrigin="anonymous". Most signed URLs from fal/B2/Crun do
// allow CORS — if a host doesn't, we silently fall back to the plain
// <video> render (no cache for that source, but display still works).

type Props = VideoHTMLAttributes<HTMLVideoElement> & {
  rootMargin?: string;
  /** Server-side first-frame JPG on B2 (settle.ts generatePosterAsync
   *  stores this on metadata.poster_url for every newly-settled video).
   *  When provided, we short-circuit the IndexedDB capture flow and
   *  render <img src={posterUrl}> directly — instant load, no video
   *  element, no canvas capture, no CORS hassle. Browser caches the
   *  B2 image like any normal asset. Falls back to the legacy capture-
   *  on-mount path when posterUrl is null/missing (old videos). */
  posterUrl?: string | null;
  /** History row id. When provided AND posterUrl is null AND we
   *  successfully capture a first-frame locally, we POST the JPG to
   *  /api/extension/save-poster so the server can rehost it to B2 and
   *  stamp metadata.poster_url. Every subsequent viewer on any surface
   *  (dashboard or extension) then gets the cheap <img> fast path
   *  without having to re-capture. Self-healing backfill. */
  historyId?: string;
};

// Module-level guard so we only attempt one upload per row per page
// session (avoid hammering the endpoint if the same card re-mounts
// repeatedly from React re-renders).
const _uploadedThisSession = new Set<string>();

// ── IndexedDB ────────────────────────────────────────────────────────
const DB_NAME = "peninglab-posters";
const STORE = "posters";

let dbPromise: Promise<IDBDatabase> | null = null;
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function dbGet(key: string): Promise<Blob | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDB();
    return await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const v = req.result;
        resolve(v?.blob instanceof Blob ? v.blob : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function dbPut(key: string, blob: Blob): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ blob, ts: Date.now() }, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // quota / private-mode — ignore, capture will simply re-run next time
  }
}

const keyForSrc = (src: string) => src.split("#")[0];

// ── Module-level concurrency limiter ────────────────────────────
// Across the whole grid, only N cards may fetch metadata at once.
const MAX_CONCURRENT = 2;
let activeFetches = 0;
const fetchQueue: Array<() => void> = [];

function acquireSlot(cb: () => void) {
  if (activeFetches < MAX_CONCURRENT) {
    activeFetches += 1;
    cb();
  } else {
    fetchQueue.push(cb);
  }
}

function releaseSlot() {
  activeFetches = Math.max(0, activeFetches - 1);
  const next = fetchQueue.shift();
  if (next) {
    activeFetches += 1;
    next();
  }
}

export default function LazyVideo({
  rootMargin = "50px",
  preload: preloadOverride,
  src,
  className,
  style,
  onClick,
  posterUrl,
  historyId,
  ...rest
}: Props) {
  // Fast path — server already extracted + uploaded the first frame
  // to B2 (settle.ts). Render <img> directly, skip every IndexedDB +
  // canvas-capture step. The image is served from peninglab-content
  // with `cache-control: public, max-age=2592000, immutable` so the
  // browser caches it forever between grid loads.
  if (posterUrl) {
    return (
      <img
        src={posterUrl}
        alt=""
        className={className}
        style={style}
        onClick={onClick as any}
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    );
  }

  const ref = useRef<HTMLVideoElement | null>(null);
  // Phase progression:
  //   idle        — out of view, nothing mounted
  //   queued      — in view, waiting for a fetch slot
  //   loading     — actively loading metadata + about to capture frame
  //   video-ready — frame painted in <video>, capture failed (CORS) → keep video
  //   poster      — first frame in IndexedDB, rendering <img>
  const [phase, setPhase] = useState<
    "idle" | "queued" | "loading" | "video-ready" | "poster"
  >("idle");
  const [cachedPosterUrl, setCachedPosterUrl] = useState<string | null>(null);
  // crossOrigin="anonymous" lets canvas extract the frame, but if the
  // host doesn't return CORS headers the video errors out. On error we
  // flip this off and remount — display works, capture is skipped.
  const [useCors, setUseCors] = useState(true);

  const srcStr = typeof src === "string" ? src : "";
  const cacheKey = srcStr ? keyForSrc(srcStr) : "";
  const srcWithSeek =
    srcStr && !srcStr.includes("#") ? `${srcStr}#t=0.01` : srcStr;

  // Cache check on mount — if hit, skip <video> entirely.
  useEffect(() => {
    if (!cacheKey) return;
    let cancelled = false;
    (async () => {
      const blob = await dbGet(cacheKey);
      if (cancelled || !blob) return;
      const url = URL.createObjectURL(blob);
      setCachedPosterUrl(url);
      setPhase("poster");
    })();
    return () => {
      cancelled = true;
    };
  }, [cacheKey]);

  // Revoke poster URL on unmount.
  useEffect(() => {
    return () => {
      if (cachedPosterUrl) URL.revokeObjectURL(cachedPosterUrl);
    };
  }, [cachedPosterUrl]);

  // IntersectionObserver — only relevant if NOT cached (still idle).
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

  // Fetch slot + first-frame capture.
  useEffect(() => {
    if (phase !== "queued") return;
    let released = false;
    let timeoutId: number | undefined;
    let onReady: (() => void) | null = null;
    let onError: (() => void) | null = null;
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
      const finish = (next: "poster" | "video-ready") => {
        if (onReady) v.removeEventListener("loadeddata", onReady);
        if (onError) v.removeEventListener("error", onError);
        if (!released) {
          released = true;
          releaseSlot();
        }
        setPhase(next);
      };
      onReady = async () => {
        // Try to capture the first frame. Falls back to plain video
        // render if canvas is CORS-tainted or anything throws.
        try {
          const canvas = document.createElement("canvas");
          canvas.width = v.videoWidth || 360;
          canvas.height = v.videoHeight || 640;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise<Blob | null>((resolve) => {
              try {
                canvas.toBlob(resolve, "image/jpeg", 0.78);
              } catch {
                resolve(null);
              }
            });
            if (blob) {
              await dbPut(cacheKey, blob);
              setCachedPosterUrl(URL.createObjectURL(blob));
              // Self-healing backfill — if this row doesn't have a
              // server-side poster_url yet, upload our captured JPG
              // so every other viewer (any device, any surface) gets
              // the cheap <img> fast path on next load. Fire-and-
              // forget; never blocks the visible render.
              if (historyId && !_uploadedThisSession.has(historyId)) {
                _uploadedThisSession.add(historyId);
                const dataUrl = canvas.toDataURL("image/jpeg", 0.78);
                fetch("/api/extension/save-poster", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    history_id: historyId,
                    poster_data_url: dataUrl,
                  }),
                }).catch(() => {
                  // Silent — next view will try again from a fresh page session.
                  _uploadedThisSession.delete(historyId);
                });
              }
              finish("poster");
              return;
            }
          }
        } catch {
          // canvas tainted or no context — fall through
        }
        finish("video-ready");
      };
      onError = () => {
        // Likely a CORS rejection on the first attempt. Drop crossOrigin
        // and let the next render re-fetch without it — display will work
        // but capture is disabled for this source.
        if (useCors) {
          if (onReady) v.removeEventListener("loadeddata", onReady);
          if (onError) v.removeEventListener("error", onError);
          if (!released) {
            released = true;
            releaseSlot();
          }
          setUseCors(false);
          setPhase("idle"); // restart IntersectionObserver → queued → loading
          return;
        }
        finish("video-ready");
      };
      v.addEventListener("loadeddata", onReady);
      v.addEventListener("error", onError);
      // 8s hard timeout so the queue never deadlocks on a stalled load.
      timeoutId = window.setTimeout(() => {
        if (released) return;
        if (onReady) v.removeEventListener("loadeddata", onReady);
        if (onError) v.removeEventListener("error", onError);
        released = true;
        releaseSlot();
        setPhase("video-ready");
      }, 8000);
    });
    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      if (!released) {
        released = true;
        releaseSlot();
      }
    };
  }, [phase, cacheKey]);

  // ── Render ───────────────────────────────────────────────────────
  // Cached poster — fast path. Renders as <img>, same className/style/onClick
  // as the consumer expected on the <video>.
  if (phase === "poster" && cachedPosterUrl) {
    return (
      <img
        src={cachedPosterUrl}
        alt=""
        className={className}
        style={style}
        onClick={onClick as any}
        draggable={false}
      />
    );
  }

  // All other phases — render the <video> (idle/queued = preload=none,
  // loading/video-ready = preload=metadata so the first frame paints).
  const effectivePreload =
    preloadOverride ??
    (phase === "loading" || phase === "video-ready" ? "metadata" : "none");

  return (
    <video
      ref={ref}
      preload={effectivePreload}
      src={phase === "idle" ? undefined : srcWithSeek}
      playsInline
      // anonymous CORS lets canvas.toBlob extract a real blob; if the
      // host rejects it we flip useCors off and re-mount without the
      // attribute so the video still displays.
      crossOrigin={useCors ? "anonymous" : undefined}
      key={useCors ? "cors" : "nocors"}
      className={className}
      style={style}
      onClick={onClick as any}
      {...rest}
    />
  );
}
