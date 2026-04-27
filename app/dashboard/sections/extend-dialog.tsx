"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Plus } from "lucide-react";
import Portal from "./portal";

// Extend dialog — opens from the EXTEND button on a video history card.
// User picks frame anchor (Alt Take / Mid-Beat / Continue) and writes the
// continuation prompt. Submit → /api/extend/video kicks off seg-2 generation.
//
// Available on UGC tab + Auto Content tab + Cinema tab. The same backend
// route handles all three; fal frame extract + p2 r2v + merge are model-
// agnostic.

type FrameAnchor = "first" | "middle" | "last";

const ANCHOR_OPTIONS: { id: FrameAnchor; label: string; hint: string }[] = [
  {
    id: "last",
    label: "Continue",
    hint: "Pure narrative continuation — seg 2 picks up where seg 1 ended (most common).",
  },
  {
    id: "middle",
    label: "Mid-Beat",
    hint: "Pick up at the peak moment — best for mukbang reactions, unboxing reveals.",
  },
  {
    id: "first",
    label: "Alt Take",
    hint: "Parallel variation, NOT continuation — produces a different version of seg 1's opening.",
  },
];

export default function ExtendDialog({
  historyId,
  videoUrl,
  duration,
  bucket,
  productImageUrl,
  productDescription,
  characterLock,
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
  characterLock?: string; // optional — for UGC continuity
  voice?: string;
  aspectRatio?: string;
  onClose: () => void;
  onFired: (seg2HistoryId: string) => void;
}) {
  const [frameAnchor, setFrameAnchor] = useState<FrameAnchor>("last");
  const [seg2Prompt, setSeg2Prompt] = useState("");
  const [extraCharacterLock, setExtraCharacterLock] = useState(characterLock || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function fire() {
    if (!seg2Prompt.trim()) return setError("Continuation prompt required.");
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/extend/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_history_id: historyId,
          source_video_url: videoUrl,
          source_duration: duration,
          bucket,
          frame_anchor: frameAnchor,
          seg2_prompt: seg2Prompt,
          character_lock: extraCharacterLock,
          product_image_url: productImageUrl,
          product_description: productDescription,
          voice,
          aspect_ratio: aspectRatio || "9:16",
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

  return (
    <Portal>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#1a1a1f] border border-white/10 shadow-2xl">
          <div
            className="sticky top-0 flex items-center justify-between p-5 border-b border-gray-800 bg-[#1a1a1f]"
          >
            <div className="flex items-center gap-2">
              <Plus className="w-5 h-5" style={{ color: accent }} />
              <h2 className="text-base font-semibold text-white">Extend Video</h2>
              <span className="text-[10px] font-mono uppercase tracking-wider text-gray-500">
                +{duration}s
              </span>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-400">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            {/* Source video preview */}
            <div className="text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-1">
              Source clip
            </div>
            <video
              src={videoUrl}
              controls
              className="w-full max-h-48 rounded-lg bg-black border border-gray-800"
            />

            {/* Frame anchor picker — most important decision */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
                Frame Anchor — which moment from this clip starts seg 2?
              </label>
              <div className="grid grid-cols-1 gap-2">
                {ANCHOR_OPTIONS.map((opt) => (
                  <label
                    key={opt.id}
                    className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                    style={{
                      background:
                        frameAnchor === opt.id
                          ? `${accent}15`
                          : "rgba(255,255,255,0.02)",
                      border:
                        frameAnchor === opt.id
                          ? `1px solid ${accent}`
                          : "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <input
                      type="radio"
                      name="frame_anchor"
                      checked={frameAnchor === opt.id}
                      onChange={() => setFrameAnchor(opt.id)}
                      className="mt-0.5"
                      style={{ accentColor: accent }}
                    />
                    <div>
                      <div className="text-sm font-semibold text-white">{opt.label}</div>
                      <div className="text-[10px] text-gray-500 leading-relaxed mt-0.5">
                        {opt.hint}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Continuation prompt */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">
                Continuation Prompt (seg 2 — what happens after the anchor)
              </label>
              <textarea
                rows={5}
                value={seg2Prompt}
                onChange={(e) => setSeg2Prompt(e.target.value)}
                placeholder={
                  frameAnchor === "first"
                    ? "An alternate version of the opening — different camera angle, different first line, same character/setting..."
                    : frameAnchor === "middle"
                      ? "The reaction continues. Camera holds on her face. She says the next line and lifts the product..."
                      : "Camera follows as she sets the product down and turns toward camera. She says: 'Confirm korang akan repeat order.'..."
                }
                className="w-full p-2 rounded-lg text-[11px] font-mono leading-relaxed resize-y outline-none bg-gray-900 border border-gray-700 text-white"
              />
            </div>

            {/* UGC-only: character lock */}
            {bucket === "ugc" && (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">
                  Character Lock (optional — preserves identity across the cut)
                </label>
                <textarea
                  rows={2}
                  value={extraCharacterLock}
                  onChange={(e) => setExtraCharacterLock(e.target.value)}
                  placeholder="A 26-year-old Malay woman in soft pastel hijab, warm medium-brown skin, dewy minimal-makeup..."
                  className="w-full p-2 rounded-lg text-[11px] font-mono leading-relaxed resize-y outline-none bg-gray-900 border border-gray-700 text-white"
                />
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
              disabled={busy || !seg2Prompt.trim()}
              className="px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: accent }}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Generate Continuation"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
