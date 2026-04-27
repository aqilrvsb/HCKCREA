"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, Plus, Upload as UploadIcon, History as HistoryIcon } from "lucide-react";
import Portal from "./portal";
import { createClient } from "@/lib/supabase/client";

// Extend dialog — opens from EXTEND on a video history card.
//
// New flow (vs previous radio-only Continue/Mid-Beat/Alt Take):
//  - Start frame is REQUIRED. User picks source from 5 options:
//      first/middle/last frame of source video (auto-extract on backend)
//      upload custom image (any reference)
//      pick from past history (user's previous done generations)
//  - End frame is OPTIONAL — same 5 options.
//  - Continuation prompt is required.
//  - Product Text Lock UI is GONE. Backend auto-runs OCR on the source
//    clip's product image (parent.reference_url) and injects the lock
//    block into the seg-2 prompt automatically — zero user effort.
//
// Duration ladder:  8 → +8s = 16, 16 → +8s = 24, 24 → +6s = 30 (cap).
// Source already at 30s → can't extend further.

type FrameSource = "first" | "middle" | "last" | "upload" | "history";

type FrameSelection = {
  source: FrameSource;
  url?: string; // for upload/history modes — the picked image URL
};

const FRAME_BUTTONS: { source: FrameSource; label: string; hint: string }[] = [
  { source: "first",   label: "First Frame",  hint: "Re-use the opening frame of this clip." },
  { source: "middle",  label: "Middle Frame", hint: "Pick up at the peak moment of this clip." },
  { source: "last",    label: "Last Frame",   hint: "Continue right where this clip ended." },
  { source: "upload",  label: "Upload",       hint: "Upload your own start/end frame." },
  { source: "history", label: "From History", hint: "Pick a past generation as the frame." },
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
  onClose: () => void;
  onFired: (seg2HistoryId: string) => void;
}) {
  const plan = extensionPlan(duration);
  // Default start frame = last (most common = pure continuation)
  const [startFrame, setStartFrame] = useState<FrameSelection>({ source: "last" });
  const [endFrame, setEndFrame] = useState<FrameSelection | null>(null);
  const [seg2Prompt, setSeg2Prompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyPickerSlot, setHistoryPickerSlot] = useState<"start" | "end" | null>(null);

  const startUploadRef = useRef<HTMLInputElement | null>(null);
  const endUploadRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !historyPickerSlot && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, historyPickerSlot]);

  function handlePickSource(slot: "start" | "end", source: FrameSource) {
    if (source === "upload") {
      (slot === "start" ? startUploadRef : endUploadRef).current?.click();
      return;
    }
    if (source === "history") {
      setHistoryPickerSlot(slot);
      return;
    }
    // first/middle/last → backend auto-extracts; we just store the choice
    const sel: FrameSelection = { source };
    if (slot === "start") setStartFrame(sel);
    else setEndFrame(sel);
  }

  async function handleUpload(slot: "start" | "end", file: File | null) {
    if (!file) return;
    // Read as data URL for preview, server uploads to storage at submit time
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const sel: FrameSelection = { source: "upload", url: dataUrl };
      if (slot === "start") setStartFrame(sel);
      else setEndFrame(sel);
    };
    reader.readAsDataURL(file);
  }

  function handleHistoryPick(url: string) {
    if (!historyPickerSlot) return;
    const sel: FrameSelection = { source: "history", url };
    if (historyPickerSlot === "start") setStartFrame(sel);
    else setEndFrame(sel);
    setHistoryPickerSlot(null);
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

  async function fire() {
    if (!plan) return setError("This clip is already at the 30-second cap.");
    if (!seg2Prompt.trim()) return setError("Continuation prompt required.");
    setError(null);
    setBusy(true);
    try {
      // Resolve any data: URLs to public URLs before posting
      const startUrl = startFrame.url ? await ensurePublicUrl(startFrame.url) : undefined;
      const endUrl = endFrame?.url ? await ensurePublicUrl(endFrame.url) : undefined;

      const res = await fetch("/api/extend/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_history_id: historyId,
          source_video_url: videoUrl,
          source_duration: duration,
          bucket,
          // Frame picker (replaces frame_anchor)
          start_frame_source: startFrame.source,
          start_frame_url: startUrl,
          end_frame_source: endFrame?.source || null,
          end_frame_url: endUrl,
          seg2_prompt: seg2Prompt,
          // Product text lock is now AUTO via backend OCR — no UI input
          product_image_url: productImageUrl,
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
            {/* Source video preview */}
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-1">
                Source clip ({duration}s)
              </div>
              <video
                src={videoUrl}
                controls
                className="w-full max-h-48 rounded-lg bg-black border border-gray-800"
              />
            </div>

            {/* Start frame — required */}
            <FrameSlot
              label="Start Frame (required)"
              hint="The frame the new segment starts from."
              selection={startFrame}
              onPick={(src) => handlePickSource("start", src)}
              onClear={() => setStartFrame({ source: "last" })}
              accent={accent}
              required
            />
            <input
              ref={startUploadRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => handleUpload("start", e.target.files?.[0] || null)}
            />

            {/* End frame — optional */}
            <FrameSlot
              label="End Frame (optional)"
              hint="Where the new segment lands. Leave empty to let the model decide."
              selection={endFrame}
              onPick={(src) => handlePickSource("end", src)}
              onClear={() => setEndFrame(null)}
              accent={accent}
            />
            <input
              ref={endUploadRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => handleUpload("end", e.target.files?.[0] || null)}
            />

            {/* Continuation prompt */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">
                Continuation Prompt (what happens in the new segment)
              </label>
              <textarea
                rows={5}
                value={seg2Prompt}
                onChange={(e) => setSeg2Prompt(e.target.value)}
                placeholder="The reaction continues. Camera holds on her face. She says the next line and lifts the product..."
                className="w-full p-2 rounded-lg text-[11px] font-mono leading-relaxed resize-y outline-none bg-gray-900 border border-gray-700 text-white"
              />
              {productImageUrl && (
                <div className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                  Product label akan auto-locked dari product reference — tak perlu type tulisan.
                </div>
              )}
            </div>

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
              disabled={busy || !seg2Prompt.trim()}
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

        {historyPickerSlot && (
          <HistoryPicker
            onPick={handleHistoryPick}
            onClose={() => setHistoryPickerSlot(null)}
          />
        )}
      </div>
    </Portal>
  );
}

// One frame slot — 5 buttons + a small preview area showing the current pick.
function FrameSlot({
  label,
  hint,
  selection,
  onPick,
  onClear,
  accent,
  required,
}: {
  label: string;
  hint: string;
  selection: FrameSelection | null;
  onPick: (source: FrameSource) => void;
  onClear: () => void;
  accent: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">
        {label}
      </label>
      <div className="text-[10px] text-gray-500 mb-2 leading-relaxed">{hint}</div>

      <div className="grid grid-cols-5 gap-1.5">
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
              {btn.source === "upload" ? (
                <UploadIcon className="w-3.5 h-3.5 inline" />
              ) : btn.source === "history" ? (
                <HistoryIcon className="w-3.5 h-3.5 inline" />
              ) : (
                btn.label.split(" ")[0]
              )}
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
          {selection.url ? (
            <img
              src={selection.url}
              alt=""
              className="w-12 h-12 object-cover rounded"
            />
          ) : (
            <div
              className="w-12 h-12 rounded flex items-center justify-center text-[10px] font-bold"
              style={{ background: `${accent}25`, color: accent }}
            >
              auto
            </div>
          )}
          <div className="flex-1 min-w-0 text-[10px] text-gray-300 leading-relaxed">
            <div className="font-semibold uppercase tracking-wider" style={{ color: accent }}>
              {selection.source === "first" && "First frame"}
              {selection.source === "middle" && "Middle frame"}
              {selection.source === "last" && "Last frame"}
              {selection.source === "upload" && "Custom upload"}
              {selection.source === "history" && "From history"}
            </div>
            <div className="text-gray-500">
              {selection.source === "first" || selection.source === "middle" || selection.source === "last"
                ? "Auto-extracted from source clip when generation fires."
                : "Public URL ready."}
            </div>
          </div>
          {!required && (
            <button
              onClick={onClear}
              className="text-[10px] px-2 py-1 rounded text-gray-400 hover:text-white"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Picker modal for "From History" — shows recent done video rows. Click to
// pick that row's output_url as the frame source. (Veo will use whatever the
// first frame of that video is, since URL-based references aren't pre-
// extracted client-side here.)
function HistoryPicker({
  onPick,
  onClose,
}: {
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Array<{ id: string; output_url: string; thumbnail_url: string | null; prompt: string | null }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const sb = createClient();
      const { data } = await sb
        .from("history")
        .select("id, output_url, thumbnail_url, prompt")
        .in("type", ["video", "image"])
        .eq("status", "done")
        .not("output_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(40);
      setItems((data as any) || []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[80vh] overflow-y-auto rounded-2xl bg-[#1a1a1f] border border-white/10 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-white">Pick a frame from history</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        {loading ? (
          <div className="py-12 text-center text-xs text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-xs text-gray-500">
            Belum ada history.
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {items.map((it) => (
              <button
                key={it.id}
                onClick={() => onPick(it.output_url)}
                className="aspect-square rounded-lg overflow-hidden bg-black border border-white/10 hover:border-white/40 transition"
              >
                {it.thumbnail_url || it.output_url ? (
                  <img
                    src={it.thumbnail_url || it.output_url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
