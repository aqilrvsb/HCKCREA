"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, Plus, Upload as UploadIcon, MessageCircle } from "lucide-react";
import Portal from "./portal";
import AttachmentPicker from "./attachment-picker";

// Extend dialog — opens from EXTEND on a video history card.
//
// Flow (refreshed per user feedback):
//  - User picks ONE start frame from the source clip (FIRST / MIDDLE / LAST)
//    OR an upload OR a history pick. Clicking FIRST/MIDDLE/LAST seeks the
//    source video preview to that timestamp so the user can SEE the frame
//    before committing.
//  - End Frame UI is hidden — defaults to "last" (last frame of the source
//    clip) so segment 2 lands seamlessly when concatenated. Backend extracts
//    the actual pixels at generate time.
//  - Continuation prompt is replaced by a 3-section DIALOG SCRIPT
//    (0-2s / 2-6s / 6-8s) matching the UGC-tab dialog UI. The original
//    first-video prompt is reused as the scene context — user only types
//    what's spoken in segment 2.
//  - Product text lock is auto-OCR'd server-side from parent.reference_url.
//
// Duration ladder:  8 → +8s = 16, 16 → +8s = 24, 24 → +6s = 30 (cap).

type FrameSource = "first" | "middle" | "last";

// When the user clicks First/Middle/Last we capture an HD PNG in the
// browser and upload to peninglab-content. The resolved URL flips
// `source` to "upload" so the backend uses our HD frame directly
// instead of running its own fal.ai extract.
type FrameSelection = {
  source: FrameSource | "upload";
  url?: string;
};

const FRAME_BUTTONS: { source: FrameSource; label: string; hint: string }[] = [
  { source: "first",   label: "First Frame",  hint: "Re-use the opening frame of this clip." },
  { source: "middle",  label: "Middle Frame", hint: "Pick up at the peak moment of this clip." },
  { source: "last",    label: "Last Frame",   hint: "Continue right where this clip ended." },
];

function extensionPlan(currentSec: number): { ext: number; total: number } | null {
  if (currentSec >= 30) return null;
  if (currentSec < 16) return { ext: 8, total: 16 };
  if (currentSec < 24) return { ext: 8, total: 24 };
  return { ext: 6, total: 30 };
}

export default function ExtendDialog({
  historyId,
  videoUrl,
  duration,
  bucket,
  productImageUrl,
  productDescription,
  voice,
  aspectRatio,
  originalPrompt,
  onClose,
  onFired,
}: {
  historyId: string;
  videoUrl: string;
  duration: number;
  bucket: "ugc" | "cinema" | "auto";
  productImageUrl?: string;
  productDescription?: string;
  voice?: string;
  aspectRatio?: string;
  // Original first-video prompt — reused as scene context so the user
  // doesn't retype the setup. The dialog script below + new start frame
  // are what changes between segment 1 and segment 2.
  originalPrompt?: string;
  onClose: () => void;
  onFired: (seg2HistoryId: string) => void;
}) {
  const plan = extensionPlan(duration);
  // Default start frame = last (most common = pure continuation)
  const [startFrame, setStartFrame] = useState<FrameSelection>({ source: "last" });
  // Editable seg2 prompt textarea, pre-filled with seg1's prompt.
  // User edits the dialog (typically the quoted line) inline; everything
  // else (LOCK blocks, product info, negatives) is left intact. The full
  // textarea content is sent as the seg2 prompt with a continuation note
  // auto-prepended at submit time.
  const [editedPrompt, setEditedPrompt] = useState<string>(
    (originalPrompt || "").trim()
  );
  // Large fullscreen prompt-editor modal — the inline textarea is small
  // (hard to read at 11px); clicking Expand opens a near-fullscreen editor
  // with bigger font + more rows so the user can comfortably edit.
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  // Optional fresh product-reference upload. When the user attaches one,
  // it overrides productImageUrl from the source row — useful when the
  // original was a Tencent temp URL that's now expired or the user
  // simply has a cleaner shot of the package.
  const [overrideProductDataUrl, setOverrideProductDataUrl] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Attachment library picker — replaces the local file upload for the
  // product reference. Picked URL is a public S3 URL on peninglab-storage
  // so it bypasses the RunningHub re-upload entirely.
  const [attachmentOpen, setAttachmentOpen] = useState(false);

  // File-input ref for the new Product Reference upload section.
  const productUploadRef = useRef<HTMLInputElement | null>(null);
  // Source video player ref — clicking FIRST/MIDDLE/LAST seeks to that
  // timestamp so the user can see which frame they're picking.
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // If the fullscreen prompt editor is open, Escape closes just it
      // (not the whole dialog). Otherwise Escape closes the dialog.
      if (promptEditorOpen) {
        setPromptEditorOpen(false);
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, promptEditorOpen]);

  // Auto-capture the default frame (just-before-last) once the source
  // video has loaded its metadata. Mirrors the old "auto-extract Last
  // Frame" default so the seg-2 has a frame ready even if the user
  // doesn't touch the scrubber. Re-fires if the user closes + reopens.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let done = false;
    const tryCapture = () => {
      if (done) return;
      if (!v.videoWidth || !v.videoHeight) return;
      done = true;
      void handlePickTimestamp(pickedTime);
    };
    if (v.readyState >= 1 && v.videoWidth) {
      tryCapture();
      return;
    }
    v.addEventListener("loadedmetadata", tryCapture, { once: true });
    return () => v.removeEventListener("loadedmetadata", tryCapture);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  // Wait for the video to seek to a specific time. Resolves on the
  // first "seeked" event after assigning currentTime. Browsers may fire
  // multiple intermediate events while scrubbing — listening once is
  // enough because we set currentTime synchronously and pause first.
  function seekAndWait(v: HTMLVideoElement, target: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        v.removeEventListener("seeked", done);
        resolve();
      };
      v.addEventListener("seeked", done, { once: true });
      try {
        v.currentTime = target;
      } catch {
        resolve();
      }
      // Safety timeout — never block forever if seeked never fires.
      setTimeout(() => {
        v.removeEventListener("seeked", done);
        resolve();
      }, 2500);
    });
  }

  function seekToFrame(source: FrameSource) {
    const v = videoRef.current;
    if (!v) return;
    let target = 0;
    if (source === "first") target = 0;
    else if (source === "middle") target = Math.max(0, duration / 2);
    else if (source === "last") target = Math.max(0, duration - 0.1);
    try {
      v.currentTime = target;
      v.pause();
    } catch {}
  }

  // Capture the current video frame as a PNG blob at the video's native
  // resolution. videoWidth × videoHeight = source pixels (e.g. 1080×1920
  // for portrait Veo output). No compression beyond PNG losslessness.
  // Returns null if the canvas is tainted (CORS missing) or seek failed.
  async function captureFrameBlob(): Promise<Blob | null> {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return null;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    try {
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    } catch (e) {
      console.warn("[extend] canvas drawImage failed:", e);
      return null;
    }
    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob),
        "image/png" // lossless — pairs with the product-first ref order to keep label edges sharp in seg-2
      );
    });
  }

  // Upload the captured frame to peninglab-storage and return the
  // direct S3 URL. Used by the start-frame picker so we hand the
  // backend a pixel-clean URL and it skips the fal.ai extract entirely.
  async function uploadFrameBlob(blob: Blob): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", new File([blob], "extend-frame.png", { type: "image/png" }));
    try {
      const r = await fetch("/api/extend/upload-frame", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const d = await r.json();
      return r.ok && d?.ok ? (d.url as string) : null;
    } catch {
      return null;
    }
  }

  // Tracks the in-flight HD capture so we can show the user a spinner +
  // disable Generate until the upload finishes.
  const [capturingFrame, setCapturingFrame] = useState<true | null>(null);
  // The timestamp (in seconds) the user has scrubbed to. Defaults to
  // just-before-last so the seg-2 picks up where seg-1 ended — same as
  // the old "Last" button default.
  const [pickedTime, setPickedTime] = useState<number>(
    Math.max(0, duration - 0.1)
  );

  // Capture the HD frame at the chosen timestamp and upload it. Called
  // when the user releases the scrubber. Idempotent — repeated releases
  // at the same time still re-capture (cheap, useful if upload failed).
  async function handlePickTimestamp(t: number) {
    const v = videoRef.current;
    if (!v) return;
    setCapturingFrame(true);
    try {
      v.pause();
      await seekAndWait(v, t);
      const blob = await captureFrameBlob();
      if (!blob) {
        console.warn("[extend] HD capture failed at t=", t);
        return;
      }
      const url = await uploadFrameBlob(blob);
      if (!url) return;
      // Stamp the captured URL + source "upload" so the backend uses
      // our HD frame directly instead of running its own fal.ai extract.
      setStartFrame({ source: "upload", url });
    } finally {
      setCapturingFrame(null);
    }
  }

  // Optional fresh product upload — kicks the hidden file input + reads
  // the file as a data: URL for instant preview. The data URL is sent
  // to /api/extend/video which uploads it to RunningHub server-side.
  function handleProductUpload(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setOverrideProductDataUrl(String(reader.result || ""));
    };
    reader.readAsDataURL(file);
  }

  async function ensurePublicUrl(v: string): Promise<string> {
    if (!v) return "";
    if (!v.startsWith("data:")) return v;
    const blob = await (await fetch(v)).blob();
    const fd = new FormData();
    fd.append("file", blob, "extend-frame.png");
    const r = await fetch("/api/upload/image", { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok || !d?.url) throw new Error(d?.error || "Upload failed");
    return d.url;
  }

  // Build the segment-2 prompt: take the user's edited textarea content
  // (pre-filled with seg1's prompt; user edits the dialog inline) and
  // prepend a continuation note so Veo treats it as seg-2 not a fresh
  // seg-1. No regex / no parsing — what the user sees is what gets sent
  // (plus the prepended continuation note).
  // Send the user's edited textarea content verbatim. No continuation
  // preamble, no auto-prepended hints — the user already has LOCK blocks
  // + the start-frame ref tells Veo this is a continuation. Adding our
  // own preamble was bloating the prompt and pushing the actual dialog
  // out of focus.
  function buildSeg2Prompt(): string {
    return editedPrompt.trim();
  }

  async function fire() {
    if (!plan) return setError("This clip is already at the 30-second cap.");
    if (!editedPrompt.trim()) return setError("The seg-2 prompt cannot be empty — edit the textarea below.");
    // Product reference is REQUIRED for the Banana Pro refine step. The
    // refine rebuilds the product into the start frame pixel-perfectly
    // before Veo conditions on it, so seg-2 keeps the label crystal
    // clear. Without an attachment we can't run that refine and the
    // product will drift like before.
    if (!overrideProductDataUrl) {
      return setError("Pick a product image from Attachments — needed for the HD refine step.");
    }
    setError(null);
    setBusy(true);
    try {
      const seg2Prompt = buildSeg2Prompt();
      let resolvedProductUrl: string | undefined;
      try {
        resolvedProductUrl = await ensurePublicUrl(overrideProductDataUrl);
      } catch (e: any) {
        throw new Error(`Product image upload failed: ${e?.message || e}`);
      }

      const res = await fetch("/api/extend/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_history_id: historyId,
          source_video_url: videoUrl,
          source_duration: duration,
          bucket,
          // When source is "upload" we already captured the HD frame in
          // the browser + uploaded to peninglab-content. Backend uses
          // startFrame.url directly and skips its fal.ai extract. When
          // canvas capture fails (CORS tainting / seek error) source
          // stays first/middle/last and backend falls back to fal.ai.
          start_frame_source: startFrame.source,
          start_frame_url: startFrame.url,
          // End frame hardcoded to "last" — backend extracts the last
          // frame of the source clip so segment 2 lands seamlessly when
          // concatenated. UI for end frame removed by request.
          end_frame_source: "last",
          end_frame_url: undefined,
          seg2_prompt: seg2Prompt,
          product_image_url: resolvedProductUrl,
          product_description: productDescription,
          voice,
          aspect_ratio: aspectRatio || "9:16",
          extend_seconds: plan.ext,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      onFired(j.seg2_history_id);
    } catch (e: any) {
      setError(e?.message || "Extend failed");
      setBusy(false);
    }
  }

  const accent = bucket === "ugc" ? "#22c55e" : bucket === "cinema" ? "#7c4dff" : "#f59e0b";

  if (!plan) {
    return (
      <Portal>
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#1a1a1f] border border-white/10 p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-white">Already at max</h2>
              <button onClick={onClose} className="text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-300">
              This clip is {duration}s — already at the 30-second cap. Generate a fresh
              clip if you need more.
            </p>
          </div>
        </div>
      </Portal>
    );
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#1a1a1f] border border-white/10 shadow-2xl">
          <div className="sticky top-0 flex items-center justify-between p-5 border-b border-gray-800 bg-[#1a1a1f]">
            <div className="flex items-center gap-2">
              <Plus className="w-5 h-5" style={{ color: accent }} />
              <h2 className="text-base font-semibold text-white">Extend Video</h2>
              <span className="text-[10px] font-mono uppercase tracking-wider text-gray-500">
                {duration}s + {plan.ext}s = {plan.total}s
              </span>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-400">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 space-y-5">
            {/* Source video preview — videoRef wired so frame buttons can seek */}
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-1">
                Source clip ({duration}s)
              </div>
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                // crossOrigin="anonymous" so we can drawImage onto a canvas
                // without tainting it. Both peninglab-content and
                // peninglab-storage have CORS open for *.peninglab.com.
                crossOrigin="anonymous"
                className="w-full max-h-48 rounded-lg bg-black border border-gray-800"
              />
              <div className="text-[10px] text-gray-500 mt-1">
                Tip: drag the scrubber below to pick the exact frame where segment 2 should start. Release to capture in HD.
              </div>
            </div>

            {/* Start frame — draggable timeline scrubber.
                User drags through the source clip to pick the EXACT
                frame seg-2 should start from. While dragging the
                player just seeks (live preview); on release we run
                the HD canvas capture + upload to peninglab-content
                and stamp start_frame_url on the seg-2 row. */}
            <FrameScrubber
              duration={duration}
              pickedTime={pickedTime}
              capturing={!!capturingFrame}
              hasUrl={startFrame.source === "upload" && !!startFrame.url}
              onSeek={(t) => {
                setPickedTime(t);
                const v = videoRef.current;
                if (v) {
                  try {
                    v.currentTime = t;
                    v.pause();
                  } catch {}
                }
              }}
              onCommit={() => void handlePickTimestamp(pickedTime)}
              accent={accent}
            />

            {/* Product Reference — REQUIRED for the Banana Pro refine
                step. The HD start frame + product attachment go into
                Nano Banana Pro, which rebuilds the frame so the product
                in the user's hand exactly matches the attached image
                pixel-for-pixel (label, typography, colour). Veo r2v
                then conditions on the refined frame and seg-2 stays
                crystal clear from frame 1. */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: overrideProductDataUrl ? "var(--color-text-secondary, #aaa)" : "#fbbf24" }}>
                Product Reference (required) {!overrideProductDataUrl && "*"}
              </label>
              <div className="text-[10px] text-gray-500 mb-2 leading-relaxed">
                Banana Pro refines the start frame so the product matches this image pixel-for-pixel. Seg-2 then anchors on a crystal-clear product instead of a soft Veo redraw.
              </div>
              {overrideProductDataUrl ? (
                <div
                  className="flex items-center gap-2 p-2 rounded-md"
                  style={{ background: `${accent}10`, border: `1px solid ${accent}40` }}
                >
                  <img
                    src={overrideProductDataUrl}
                    alt=""
                    className="w-12 h-12 object-cover rounded"
                  />
                  <div className="flex-1 min-w-0 text-[10px] text-gray-300 leading-relaxed">
                    <div className="font-semibold uppercase tracking-wider" style={{ color: accent }}>
                      Custom product reference attached
                    </div>
                    <div className="text-gray-500">
                      Will override the original — sent directly to Veo (no re-upload).
                    </div>
                  </div>
                  <button
                    onClick={() => setOverrideProductDataUrl("")}
                    className="text-[10px] px-2 py-1 rounded text-gray-400 hover:text-white"
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAttachmentOpen(true)}
                  className="w-full px-3 py-2.5 rounded-md text-[11px] font-bold inline-flex items-center justify-center gap-2 transition-colors"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    color: "rgb(180,180,180)",
                    border: "1px dashed rgba(255,255,255,0.15)",
                  }}
                >
                  <UploadIcon className="w-3.5 h-3.5" />
                  Pick product image from Attachments
                </button>
              )}
            </div>

            {/* End Frame UI removed — backend defaults to last frame of
                source clip so segment 2 lands where segment 1 ended,
                making the concatenation seamless. No need to ask the
                user for input that's the same answer 95% of the time. */}

            {/* Edit prompt — pre-filled with seg1's prompt; user edits the
                quoted dialog (and anything else) inline. The full textarea
                content is sent to Veo with a continuation note auto-prepended. */}
            <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" style={{ color: accent }} />
                  <span className="text-xs font-bold uppercase tracking-wider text-white">Segment 2 Prompt</span>
                </div>
                <span
                  className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded"
                  style={{ background: `${accent}20`, color: accent, border: `1px solid ${accent}40` }}
                >
                  {plan.ext} seconds
                </span>
              </div>

              <div className="text-[10px] text-gray-400 mb-2 leading-relaxed">
                ⓘ Pre-filled with segment 1's prompt. <strong className="text-white">Find the quoted dialog</strong> (e.g. <code className="px-1 rounded bg-black/40 text-[10px]">'Gila pedas! ...'</code>) <strong className="text-white">and replace it with your new lines</strong>. Keep all the LOCK blocks, character description, and Negative list intact. The continuation hint is auto-prepended at submit time.
              </div>

              <div className="relative">
                <textarea
                  value={editedPrompt}
                  onChange={(e) => setEditedPrompt(e.target.value)}
                  rows={12}
                  spellCheck={false}
                  className="w-full px-3 py-2 rounded-md text-[11px] font-mono leading-relaxed text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 resize-y"
                  style={{
                    background: "rgba(0,0,0,0.4)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    fontFamily: "ui-monospace, Menlo, Consolas, monospace",
                  }}
                  placeholder="The full segment-1 prompt will appear here. Edit the quoted dialog line for segment 2."
                />
                <button
                  type="button"
                  onClick={() => setPromptEditorOpen(true)}
                  className="absolute top-2 right-2 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider text-white shadow-lg hover:opacity-90 transition-opacity"
                  style={{ background: accent }}
                  title="Open large fullscreen editor"
                >
                  ⛶ Expand to edit
                </button>
              </div>

              <div className="flex items-center justify-between mt-2 text-[10px] text-gray-500">
                <span>{editedPrompt.length.toLocaleString()} chars</span>
                {originalPrompt && originalPrompt.trim() && editedPrompt.trim() !== originalPrompt.trim() && (
                  <button
                    type="button"
                    onClick={() => setEditedPrompt(originalPrompt.trim())}
                    className="px-2 py-1 rounded text-gray-400 hover:text-white hover:bg-white/5"
                  >
                    Reset to segment 1
                  </button>
                )}
              </div>
            </div>

            {productImageUrl && (
              <div className="text-[10px] text-gray-500 leading-relaxed -mt-2">
                ⓘ Product label auto-locked dari product reference (Gemini scan). Character / setting / wardrobe lock dari prompt yang korang edit kat atas.
              </div>
            )}

            {error && <div className="text-xs text-red-400">{error}</div>}
          </div>

          <div className="sticky bottom-0 flex items-center justify-end gap-2 p-4 border-t border-gray-800 bg-[#1a1a1f]">
            <button
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={fire}
              disabled={
                busy ||
                !!capturingFrame ||
                !editedPrompt.trim() ||
                !overrideProductDataUrl
              }
              title={
                capturingFrame
                  ? "Capturing HD frame…"
                  : !overrideProductDataUrl
                    ? "Pick a product image from Attachments first — needed for the refine step"
                    : !editedPrompt.trim()
                      ? "Edit the seg-2 prompt first (cannot be empty)"
                      : ""
              }
              className="px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 inline-flex items-center gap-2"
              style={{ background: accent }}
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                <>Generate +{plan.ext}s</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Fullscreen prompt editor — opens when user clicks "Expand to edit"
          on the inline textarea. Larger font, more rows, near-fullscreen
          width so the seg1 prompt is comfortable to read and edit. */}
      {promptEditorOpen && (
        <Portal>
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.85)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setPromptEditorOpen(false);
          }}
        >
          <div
            className="w-full max-w-5xl h-[90vh] rounded-xl flex flex-col overflow-hidden"
            style={{ background: "#1a1a1f", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <div>
                <div className="text-base font-bold text-white">Edit Segment 2 Prompt</div>
                <div className="text-[11px] text-gray-400 mt-1">Find the quoted dialog and replace it with your new lines. Keep all LOCK blocks intact.</div>
              </div>
              <button
                onClick={() => setPromptEditorOpen(false)}
                className="p-2 rounded-lg hover:bg-white/5 text-gray-300"
                title="Close (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 p-4 overflow-hidden">
              <textarea
                value={editedPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
                spellCheck={false}
                autoFocus
                className="w-full h-full px-4 py-3 rounded-lg text-[14px] font-mono leading-relaxed text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 resize-none"
                style={{
                  background: "rgba(0,0,0,0.5)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  fontFamily: "ui-monospace, Menlo, Consolas, monospace",
                }}
                placeholder="The full segment-1 prompt — edit the quoted dialog inline."
              />
            </div>

            <div className="flex items-center justify-between gap-2 p-4 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <div className="text-[11px] text-gray-400">
                {editedPrompt.length.toLocaleString()} chars
                {originalPrompt && originalPrompt.trim() && editedPrompt.trim() !== originalPrompt.trim() && (
                  <button
                    type="button"
                    onClick={() => setEditedPrompt(originalPrompt.trim())}
                    className="ml-3 px-2 py-1 rounded text-gray-400 hover:text-white hover:bg-white/5"
                  >
                    Reset to segment 1
                  </button>
                )}
              </div>
              <button
                onClick={() => setPromptEditorOpen(false)}
                className="px-5 py-2 rounded-lg text-sm font-semibold text-white"
                style={{ background: accent }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      <AttachmentPicker
        open={attachmentOpen}
        onClose={() => setAttachmentOpen(false)}
        onPick={(a) => {
          // Use the public S3 URL directly — no data: URL conversion,
          // no RunningHub re-upload. ensurePublicUrl below sees this is
          // already public and passes it through unchanged.
          setOverrideProductDataUrl(a.public_url);
          setAttachmentOpen(false);
        }}
      />
    </Portal>
  );
}

// Draggable timeline scrubber — replaces the old First/Middle/Last
// buttons. While dragging, the video player seeks to the chosen time
// so the user can preview the exact frame. On release (pointer-up /
// touch-end / change event) we run captureFrameBlob + upload to
// peninglab-content and stamp start_frame_url on the seg-2 row.
function FrameScrubber({
  duration,
  pickedTime,
  capturing,
  hasUrl,
  onSeek,
  onCommit,
  accent,
}: {
  duration: number;
  pickedTime: number;
  capturing: boolean;
  hasUrl: boolean;
  onSeek: (t: number) => void;
  onCommit: () => void;
  accent: string;
}) {
  // mm:ss.s — keep one decimal so 8s clips can still resolve to ~24fps
  // worth of distinct frames in the label.
  const fmt = (t: number) => {
    const tt = Math.max(0, t);
    const m = Math.floor(tt / 60);
    const s = (tt - m * 60).toFixed(1);
    return `${m}:${s.padStart(4, "0")}`;
  };
  return (
    <div>
      <label
        className="block text-xs font-bold uppercase tracking-wider mb-1"
        style={{ color: accent }}
      >
        Start Frame
        <span className="ml-2 font-mono normal-case font-normal text-gray-400">
          @ {fmt(pickedTime)} / {fmt(duration)}
        </span>
      </label>
      <p className="text-[11px] text-gray-500 mb-2 leading-relaxed">
        Drag the slider to scrub the source clip. Release to capture the frame
        in HD (full source resolution, lossless PNG) and stamp it as the seg-2
        starting frame.
      </p>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={Math.max(0.1, duration)}
          step={0.05}
          value={pickedTime}
          onChange={(e) => onSeek(parseFloat(e.target.value))}
          onPointerUp={onCommit}
          onTouchEnd={onCommit}
          onKeyUp={(e) => {
            // Capture when keyboard nudges land on a value too
            if (e.key === "Enter" || e.key.startsWith("Arrow")) onCommit();
          }}
          className="flex-1 h-2 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, ${accent} 0%, ${accent} ${
              (pickedTime / Math.max(0.1, duration)) * 100
            }%, rgba(255,255,255,0.08) ${
              (pickedTime / Math.max(0.1, duration)) * 100
            }%, rgba(255,255,255,0.08) 100%)`,
          }}
        />
        <div
          className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded whitespace-nowrap"
          style={{
            background: capturing
              ? "rgba(245,158,11,0.15)"
              : hasUrl
                ? `${accent}20`
                : "rgba(255,255,255,0.04)",
            color: capturing ? "#fbbf24" : hasUrl ? accent : "rgb(180,180,180)",
            border: `1px solid ${capturing ? "rgba(245,158,11,0.4)" : hasUrl ? `${accent}50` : "rgba(255,255,255,0.08)"}`,
          }}
        >
          {capturing
            ? "capturing HD…"
            : hasUrl
              ? "HD frame ready ✓"
              : "waiting"}
        </div>
      </div>
    </div>
  );
}

// LEGACY — kept for type compatibility while we phase out external
// callers, but no longer rendered.
function FrameSlot({
  label,
  hint,
  selection,
  onPick,
  accent,
}: {
  label: string;
  hint: string;
  selection: FrameSelection | null;
  onPick: (source: FrameSource) => void;
  accent: string;
}) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">
        {label}
      </label>
      <div className="text-[10px] text-gray-500 mb-2 leading-relaxed">{hint}</div>

      <div className="grid grid-cols-3 gap-1.5">
        {FRAME_BUTTONS.map((btn) => {
          const isActive = selection?.source === btn.source;
          return (
            <button
              key={btn.source}
              onClick={() => onPick(btn.source)}
              title={btn.hint}
              className="px-2 py-2 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors"
              style={
                isActive
                  ? {
                      background: accent,
                      color: "white",
                      boxShadow: `0 2px 6px ${accent}55`,
                    }
                  : {
                      background: "rgba(255,255,255,0.04)",
                      color: "rgb(180,180,180)",
                      border: "1px solid rgba(255,255,255,0.06)",
                    }
              }
            >
              {btn.label.split(" ")[0]}
            </button>
          );
        })}
      </div>

      {selection && (
        <div
          className="mt-2 flex items-center gap-2 p-2 rounded-md"
          style={{
            background: `${accent}10`,
            border: `1px solid ${accent}40`,
          }}
        >
          <div
            className="w-12 h-12 rounded flex items-center justify-center text-[10px] font-bold"
            style={{ background: `${accent}25`, color: accent }}
          >
            auto
          </div>
          <div className="flex-1 min-w-0 text-[10px] text-gray-300 leading-relaxed">
            <div className="font-semibold uppercase tracking-wider" style={{ color: accent }}>
              {selection.source === "first" && "First frame"}
              {selection.source === "middle" && "Middle frame"}
              {selection.source === "last" && "Last frame"}
            </div>
            <div className="text-gray-500">
              Auto-extracted from source clip when generation fires.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

