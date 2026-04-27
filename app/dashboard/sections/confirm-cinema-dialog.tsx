"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Film } from "lucide-react";
import Portal from "./portal";

// Cinema confirmation — yes/no only. Agent already drafted the prompt;
// user just approves or cancels.

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prompt = payload.prompt || "";
  const imageMode = payload.image_mode || "text";
  const imageUrl = payload.image_url || "";
  const aspect = payload.aspect_ratio || "9:16";
  const duration = payload.duration || 8;

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
      <div className="w-full max-w-md rounded-2xl bg-[#1a1a1f] border border-purple-500/30 shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Film className="w-5 h-5" style={{ color: PURPLE }} />
            <h2 className="text-base font-semibold text-white">Generate cinema clip?</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-sm text-gray-300">
            Estimated cost:{" "}
            <span className="text-white font-semibold">
              RM {(payload.estimated_cost || 0).toFixed(2)}
            </span>
          </p>

          {imageMode === "image" && imageUrl && (
            <img src={imageUrl} alt="ref" className="max-h-28 rounded border border-gray-800" />
          )}

          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-800">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-5 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            No
          </button>
          <button
            onClick={fire}
            disabled={busy}
            className="px-6 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 inline-flex items-center justify-center gap-2"
            style={{ background: PURPLE }}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Yes"}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
