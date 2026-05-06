"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, Plus, Upload as UploadIcon, MessageCircle } from "lucide-react";
import Portal from "./portal";

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

type FrameSelection = {
  source: FrameSource;
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
  // Three-section dialog script. Same time bands as the UGC tab so the
  // mental model is identical. Start empty — user types what's said.
  const [dialogBegin, setDialogBegin] = useState("");
  const [dialogMiddle, setDialogMiddle] = useState("");
  const [dialogClose, setDialogClose] = useState("");
  // Optional fresh product-reference upload. When the user attaches one,
  // it overrides productImageUrl from the source row — useful when the
  // original was a Tencent temp URL that's now expired or the user
  // simply has a cleaner shot of the package.
  const [overrideProductDataUrl, setOverrideProductDataUrl] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // File-input ref for the new Product Reference upload section.
  const productUploadRef = useRef<HTMLInputElement | null>(null);
  // Source video player ref — clicking FIRST/MIDDLE/LAST seeks to that
  // timestamp so the user can see which frame they're picking.
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

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

  function handlePickSource(source: FrameSource) {
    // first/middle/last → seek the preview AND store the choice; backend
    // auto-extracts the actual pixels at generate time.
    seekToFrame(source);
    setStartFrame({ source });
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

  // Replace seg1's spoken dialog INSIDE the original prompt with the
  // user's new dialog. Keeps the entire seg1 prompt verbatim — character
  // description, scene framing, all the LOCK blocks, the negative list
  // — and surgically swaps ONLY the quoted dialog string.
  //
  // Detection order (high → low confidence):
  //   1. "Character says: '...'" / "Voiceover: '...'" / "She says: '...'"
  //   2. The longest standalone quoted block (≥40 chars) — the seg1
  //      prompt's spoken line is always the longest single-quoted text
  //      (locks like "beg kuning" are short phrases under 40 chars).
  //   3. Fallback: append "SPOKEN DIALOG: '...'" at the end if nothing
  //      detectable.
  function replaceSeg1Dialog(prompt: string, newDialog: string): string {
    if (!prompt) return prompt;
    if (!newDialog) return prompt;

    // Strip user-typed quotes so we don't end up with nested quotes
    const safeDialog = newDialog.replace(/['"""]/g, "").trim();
    if (!safeDialog) return prompt;

    // Pattern 1 — "Character says: '...'" and friends.
    const speechPatterns: RegExp[] = [
      /(Character\s+says\s*:\s*)['"""']([^'""""]+?)['"""']/i,
      /(Voiceover\s*(?:\([^)]*\))?\s*:\s*)['"""']([^'""""]+?)['"""']/i,
      /((?:She|He|They)\s+says?\s*:\s*)['"""']([^'""""]+?)['"""']/i,
    ];
    for (const pat of speechPatterns) {
      if (pat.test(prompt)) {
        return prompt.replace(pat, `$1'${safeDialog}'`);
      }
    }

    // Pattern 2 — find longest standalone quoted block (single OR double
    // quotes) at least 40 chars long. Matches the user's example where
    // dialog is just a quoted block in the middle of a paragraph.
    const candidates: { start: number; full: string; text: string }[] = [];
    const singleQuoted = /'([^']{40,}?)'/g;
    const doubleQuoted = /"([^"]{40,}?)"/g;
    let m: RegExpExecArray | null;
    while ((m = singleQuoted.exec(prompt)) !== null) {
      candidates.push({ start: m.index, full: m[0], text: m[1] });
    }
    while ((m = doubleQuoted.exec(prompt)) !== null) {
      candidates.push({ start: m.index, full: m[0], text: m[1] });
    }

    if (candidates.length > 0) {
      // Pick the longest — most likely to be the actual dialog
      candidates.sort((a, b) => b.text.length - a.text.length);
      const target = candidates[0];
      return (
        prompt.slice(0, target.start) +
        `'${safeDialog}'` +
        prompt.slice(target.start + target.full.length)
      );
    }

    // Pattern 3 — no detectable dialog, append cleanly
    return `${prompt.trim()}\n\nSPOKEN DIALOG: '${safeDialog}'`;
  }

  // Build the segment-2 prompt that gets POSTed to the backend. Send the
  // EXACT seg1 prompt (character + scene + all locks + negatives) with
  // ONLY the spoken dialog string swapped for the user's new lines. A
  // small continuation note prepended so Veo knows this is seg2 (not a
  // fresh seg1).
  function buildSeg2Prompt(): string {
    const newDialog = [dialogBegin.trim(), dialogMiddle.trim(), dialogClose.trim()]
      .filter(Boolean)
      .join(" ");
    if (!newDialog) return "";

    const continuationNote = `SEGMENT 2 CONTINUATION: This is segment 2 — pick up exactly where segment 1 ended (start frame is the bridge). Same character, same product, same setting, same wardrobe, same lighting, same voice, same tone, same energy. Speak the dialog as quoted in the prompt below.`;

    const swapped = originalPrompt && originalPrompt.trim()
      ? replaceSeg1Dialog(originalPrompt.trim(), newDialog)
      : `Continue the scene from the start frame. The character speaks: '${newDialog.replace(/['"""]/g, "")}'`;

    return `${continuationNote}\n\n${swapped}`;
  }

  async function fire() {
    if (!plan) return setError("This clip is already at the 30-second cap.");
    const hasDialog = !!(dialogBegin.trim() || dialogMiddle.trim() || dialogClose.trim());
    if (!hasDialog) return setError("Add at least one dialog line for segment 2.");
    if (!overrideProductDataUrl) {
      return setError("Product reference image is required — upload the product photo above before generating.");
    }
    setError(null);
    setBusy(true);
    try {
      const seg2Prompt = buildSeg2Prompt();
      // User must attach a fresh product image — uploaded to
      // RunningHub server-side via /api/upload/image so Crun gets a
      // permanent download_url instead of a stale Tencent signature.
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
          start_frame_source: startFrame.source,
          start_frame_url: undefined, // first/middle/last only — backend extracts
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
                className="w-full max-h-48 rounded-lg bg-black border border-gray-800"
              />
              <div className="text-[10px] text-gray-500 mt-1">
                Tip: click First / Middle / Last below — the player jumps to that frame so you can preview your pick.
              </div>
            </div>

            {/* Start frame — required */}
            <FrameSlot
              label="Start Frame (required)"
              hint="The frame segment 2 starts from. Click First / Middle / Last to preview."
              selection={startFrame}
              onPick={handlePickSource}
              accent={accent}
            />

            {/* Product Reference upload — REQUIRED at extend time.
                Even though the backend rehosts the source row's product
                URL automatically, requiring a fresh upload guarantees
                Veo gets a pixel-clean reference for seg-2 (no expired
                signatures, no compression artifacts). User attaches the
                actual product photo they want locked across both clips. */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: overrideProductDataUrl ? "var(--color-text-secondary, #aaa)" : "#fbbf24" }}>
                Product Reference (required) {!overrideProductDataUrl && "*"}
              </label>
              <div className="text-[10px] text-gray-500 mb-2 leading-relaxed">
                Upload the product photo Veo should lock onto for segment 2 (PNG / JPG). Required for every extend so we always have a fresh pixel reference.
              </div>
              <input
                ref={productUploadRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => handleProductUpload(e.target.files?.[0] || null)}
              />
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
                      Will override the original — uploaded to RunningHub when you Generate.
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
                  onClick={() => productUploadRef.current?.click()}
                  className="w-full px-3 py-2.5 rounded-md text-[11px] font-bold inline-flex items-center justify-center gap-2 transition-colors"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    color: "rgb(180,180,180)",
                    border: "1px dashed rgba(255,255,255,0.15)",
                  }}
                >
                  <UploadIcon className="w-3.5 h-3.5" />
                  Click to upload product image (PNG / JPG)
                </button>
              )}
            </div>

            {/* End Frame UI removed — backend defaults to last frame of
                source clip so segment 2 lands where segment 1 ended,
                making the concatenation seamless. No need to ask the
                user for input that's the same answer 95% of the time. */}

            {/* Dialog Script — 3-section structure matching UGC tab */}
            <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" style={{ color: accent }} />
                  <span className="text-xs font-bold uppercase tracking-wider text-white">Dialog Script</span>
                </div>
                <span
                  className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded"
                  style={{ background: `${accent}20`, color: accent, border: `1px solid ${accent}40` }}
                >
                  {plan.ext} seconds
                </span>
              </div>

              <DialogSection
                label="0–2s · Beginning"
                color="#22c55e"
                value={dialogBegin}
                onChange={setDialogBegin}
                placeholder='e.g. "Tu, masa kau guna baru terasa..."'
              />
              <DialogSection
                label="2–6s · Middle"
                color="#facc15"
                value={dialogMiddle}
                onChange={setDialogMiddle}
                placeholder='e.g. "Yang aku suka, tahan lama, tak terbalik macam dulu..."'
              />
              <DialogSection
                label="6–8s · Closing"
                color="#ef4444"
                value={dialogClose}
                onChange={setDialogClose}
                placeholder='e.g. "Korang try sendiri — tak rugi punya."'
              />
            </div>

            {productImageUrl && (
              <div className="text-[10px] text-gray-500 leading-relaxed -mt-2">
                ⓘ Product label akan auto-locked dari product reference (Gemini scan) — character / setting / wardrobe juga di-lock dari segment 1's prompt. Korang cuma perlu type dialog je.
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
                !overrideProductDataUrl ||
                !(dialogBegin.trim() || dialogMiddle.trim() || dialogClose.trim())
              }
              title={
                !overrideProductDataUrl
                  ? "Upload the product reference image first"
                  : !(dialogBegin.trim() || dialogMiddle.trim() || dialogClose.trim())
                    ? "Add at least one dialog line"
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
    </Portal>
  );
}

// One frame slot — 3 buttons (first / middle / last) + a small preview
// area showing the current pick. Upload + From-History buttons were
// removed: extending always anchors on a frame from the source clip
// itself, so external uploads don't make sense in this flow.
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

// Compact textarea row used inside the Dialog Script block. Color-coded
// label (green / yellow / red for begin / mid / close) mirrors the UGC tab.
function DialogSection({
  label,
  color,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  color: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color }}>
        {label}
      </div>
      <textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full p-2 rounded-md text-[11px] font-mono leading-relaxed resize-y outline-none bg-gray-900 border border-gray-700 text-white"
      />
    </div>
  );
}

