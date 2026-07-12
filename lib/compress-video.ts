// Client-side video compression for reference-video uploads.
//
// Why: the APIPod (P6 gemini-omni-extend) backend caps the *reference*
// video at 8 MB. Our own upload route happily accepts up to 60 MB, so a
// 10 s 1080p clip uploads fine but then fails ~16 min later at render
// time with "video reference too large: …, maximum is 8.0MB". Since the
// reference video is only a motion/framing guide (we swap the presenter +
// product and replace the dialog), visual fidelity on it is irrelevant —
// so we re-encode oversized clips down to fit before upload.
//
// Behaviour:
//   - File ≤ MAX_PASSTHROUGH_BYTES → return the original File untouched.
//   - Otherwise: draw each frame to a downscaled <canvas> (short edge
//     capped at MAX_SHORT_EDGE), record via MediaRecorder at a bitrate
//     sized so the whole clip lands under TARGET_BYTES, audio dropped
//     (not needed for a motion guide). Output mp4/h264 when the browser
//     supports it, else webm. Recording runs at real playback speed so
//     motion timing is preserved 1:1.
//
// Browsers without MediaRecorder / captureStream throw — the caller
// surfaces the error so the user can trim the clip manually.

const MAX_PASSTHROUGH_BYTES = 7.5 * 1024 * 1024; // under APIPod's 8 MB cap
const TARGET_BYTES = 7.0 * 1024 * 1024; // aim below the cap with headroom
const MAX_SHORT_EDGE = 720; // px — downscale portrait width / landscape height
const MIN_BITRATE = 1_500_000; // 1.5 Mbps floor so quality doesn't collapse
const MAX_BITRATE = 8_000_000; // 8 Mbps ceiling for short clips

export type VideoCompressResult = {
  file: File;
  compressed: boolean;
  originalBytes: number;
  outputBytes: number;
};

// Pick the best recorder mime the browser supports — mp4/h264 first (widest
// downstream compatibility with APIPod), then webm variants.
function pickMime(): { mime: string; ext: string } | null {
  const rec =
    typeof MediaRecorder !== "undefined" &&
    typeof MediaRecorder.isTypeSupported === "function"
      ? MediaRecorder
      : null;
  if (!rec) return null;
  const candidates: Array<{ mime: string; ext: string }> = [
    { mime: "video/mp4;codecs=avc1", ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" },
    { mime: "video/webm;codecs=vp9", ext: "webm" },
    { mime: "video/webm;codecs=vp8", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
  ];
  for (const c of candidates) {
    if (rec.isTypeSupported(c.mime)) return c;
  }
  return null;
}

export async function compressVideoIfNeeded(input: File): Promise<VideoCompressResult> {
  const originalBytes = input.size;
  if (originalBytes <= MAX_PASSTHROUGH_BYTES) {
    return { file: input, compressed: false, originalBytes, outputBytes: originalBytes };
  }

  const chosen = pickMime();
  if (!chosen || typeof HTMLCanvasElement === "undefined") {
    throw new Error("Browser tak support pemampatan video. Cuba trim video ke bawah 8MB dulu.");
  }

  const url = URL.createObjectURL(input);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  // Attach offscreen — some browsers won't decode/advance frames for a
  // detached <video>, which would leave the canvas blank.
  video.style.position = "fixed";
  video.style.left = "-10000px";
  video.style.top = "0";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";
  document.body.appendChild(video);

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Video decode gagal"));
    });

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 10;
    const vw = video.videoWidth || 720;
    const vh = video.videoHeight || 1280;
    const shortEdge = Math.min(vw, vh);
    const scale = shortEdge > MAX_SHORT_EDGE ? MAX_SHORT_EDGE / shortEdge : 1;
    // Keep even dimensions — h264 encoders reject odd width/height.
    const targetW = Math.max(2, Math.round((vw * scale) / 2) * 2);
    const targetH = Math.max(2, Math.round((vh * scale) / 2) * 2);

    // bitrate so total ≈ TARGET_BYTES over the clip's duration, clamped.
    const rawBitrate = (TARGET_BYTES * 8) / duration;
    const bitrate = Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, rawBitrate)));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas tak tersedia untuk pemampatan.");

    const stream = (canvas as any).captureStream ? (canvas as HTMLCanvasElement).captureStream(30) : null;
    if (!stream) throw new Error("captureStream tak disokong oleh browser ini.");

    const recorder = new MediaRecorder(stream, {
      mimeType: chosen.mime,
      videoBitsPerSecond: bitrate,
    });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    const done = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
    recorder.start(250);

    // Draw frames in lock-step with playback so motion timing is preserved.
    let raf = 0;
    const draw = () => {
      ctx.drawImage(video, 0, 0, targetW, targetH);
      raf = requestAnimationFrame(draw);
    };
    await video.play();
    draw();

    await new Promise<void>((resolve) => {
      video.onended = () => resolve();
    });
    cancelAnimationFrame(raf);
    // Flush the final frame, then stop.
    ctx.drawImage(video, 0, 0, targetW, targetH);
    recorder.stop();
    await done;

    const blob = new Blob(chunks, { type: chosen.mime.split(";")[0] });
    const baseName = (input.name || "video").replace(/\.[^.]+$/, "");
    const outFile = new File([blob], `${baseName}.${chosen.ext}`, { type: chosen.mime.split(";")[0] });

    return {
      file: outFile,
      compressed: true,
      originalBytes,
      outputBytes: outFile.size,
    };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    try { video.load(); } catch {}
    try { video.remove(); } catch {}
  }
}
