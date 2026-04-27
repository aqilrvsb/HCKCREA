"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Film } from "lucide-react";
import Portal from "./portal";

// Cinema confirmation dialog — single-clip review before fire.
// Payload from agent: { prompt, image_url, image_mode, aspect_ratio, duration, mood/director/camera_skill_id }

type CinemaPayload = {
  prompt: string;
  image_url?: string;
  image_mode?: "text" | "image";
  aspect_ratio?: string;
  duration?: number;
  mood_skill_id?: string;
  director_skill_id?: string;
  camera_skill_id?: string;
};

const PURPLE = "#7c4dff";

export default function ConfirmCinemaDialog({
  payload,
  conversationId,
  projectId,
  onClose,
  onFired,
}: {
  payload: CinemaPayload & { estimated_cost?: number };
  conversationId: string;
  projectId: string | null;
  onClose: () => void;
  onFired: (historyId: string, cost: number) => void;
}) {
  const [prompt, setPrompt] = useState(payload.prompt || "");
  const [imageMode, setImageMode] = useState<"text" | "image">(payload.image_mode || "text");
  const [imageUrl, setImageUrl] = useState(payload.image_url || "");
  const [aspect, setAspect] = useState(payload.aspect_ratio || "9:16");
  const [duration, setDuration] = useState(payload.duration || 8);
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
    if (!prompt.trim()) return setError("Prompt required.");
    if (imageMode === "image" && !imageUrl) return setError("Reference image required for i2v mode.");
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/agent/cinema/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          conversation_id: conversationId,
          prompt,
          image_url: imageUrl,
          image_mode: imageMode,
          aspect_ratio: aspect,
          duration,
          mood_skill_id: payload.mood_skill_id,
          director_skill_id: payload.director_skill_id,
          camera_skill_id: payload.camera_skill_id,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      onFired(j.history_id, j.cost || 0);
    } catch (e: any) {
      setError(e?.message || "Fire failed");
      setBusy(false);
    }
  }

  return (
    <Portal>
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#1a1a1f] border border-purple-500/30 shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between p-5 border-b border-gray-800 bg-[#1a1a1f]">
          <div className="flex items-center gap-2">
            <Film className="w-5 h-5" style={{ color: PURPLE }} />
            <h2 className="text-base font-semibold text-white">Confirm Cinema Generation</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Prompt (Grok Imagine)</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
              className="w-full rounded-lg bg-gray-900 border border-gray-700 text-sm text-white p-3 font-mono"
              placeholder="Natural language paragraph, 50-200 words..."
            />
            <div className="mt-1 text-xs text-gray-500">{prompt.length} chars · {prompt.split(/\s+/).filter(Boolean).length} words</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Mode</label>
              <select
                value={imageMode}
                onChange={(e) => setImageMode(e.target.value as any)}
                className="w-full rounded-lg bg-gray-900 border border-gray-700 text-sm text-white p-2"
              >
                <option value="text">Text-to-Video</option>
                <option value="image">Image-to-Video</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Aspect Ratio</label>
              <select
                value={aspect}
                onChange={(e) => setAspect(e.target.value)}
                className="w-full rounded-lg bg-gray-900 border border-gray-700 text-sm text-white p-2"
              >
                <option value="9:16">9:16 (vertical)</option>
                <option value="16:9">16:9 (horizontal)</option>
                <option value="1:1">1:1 (square)</option>
                <option value="4:3">4:3</option>
                <option value="3:4">3:4</option>
              </select>
            </div>
          </div>

          {imageMode === "image" && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Reference image URL</label>
              <input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="w-full rounded-lg bg-gray-900 border border-gray-700 text-sm text-white p-2"
                placeholder="https://..."
              />
              {imageUrl && (
                <img src={imageUrl} alt="ref" className="mt-2 max-h-32 rounded border border-gray-800" />
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              Duration: {duration}s
            </label>
            <input
              type="range"
              min={6}
              max={30}
              step={1}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full"
            />
          </div>

          {(payload.mood_skill_id || payload.director_skill_id || payload.camera_skill_id) && (
            <div className="text-xs text-gray-500">
              Built from:{" "}
              {[payload.mood_skill_id, payload.director_skill_id, payload.camera_skill_id]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}

          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 p-4 border-t border-gray-800 bg-[#1a1a1f]">
          <div className="text-xs text-gray-400">
            Estimated cost:{" "}
            <span className="text-white font-medium">
              RM {(payload.estimated_cost || 0).toFixed(2)}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={fire}
              disabled={busy}
              className="px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: PURPLE }}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Generate"}
            </button>
          </div>
        </div>
      </div>
    </div>
    </Portal>
  );
}
