"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Image as ImageIcon } from "lucide-react";
import Portal from "./portal";

// Image confirmation — yes/no only. Agent already drafted the prompt;
// user just approves or cancels. Editing happens upstream via chat.

type ImagePayload = {
  prompt: string;
  model?: "nano-banana-pro" | "gpt-image-2";
  reference_urls?: string[];
  aspect_ratio?: string;
  count?: number;
  photographer_skill_id?: string;
  brand_skill_id?: string;
  composite_skill_id?: string;
};

const ORANGE = "#ff6a1a";

export default function ConfirmImageDialog({
  payload,
  conversationId,
  projectId,
  onClose,
  onFired,
}: {
  payload: ImagePayload & { estimated_cost?: number };
  conversationId: string;
  projectId: string | null;
  onClose: () => void;
  onFired: (historyIds: string[], totalCost: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prompt = payload.prompt || "";
  const model = payload.model || "nano-banana-pro";
  const refs = payload.reference_urls || [];
  const aspect = payload.aspect_ratio || "1:1";
  const count = payload.count || 1;

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
      const res = await fetch("/api/agent/image/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          conversation_id: conversationId,
          prompt,
          model,
          reference_urls: refs,
          aspect_ratio: aspect,
          count,
          photographer_skill_id: payload.photographer_skill_id,
          brand_skill_id: payload.brand_skill_id,
          composite_skill_id: payload.composite_skill_id,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      onFired(j.history_ids || [], j.total_cost || 0);
    } catch (e: any) {
      setError(e?.message || "Fire failed");
      setBusy(false);
    }
  }

  return (
    <Portal>
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#1a1a1f] border border-orange-500/30 shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5" style={{ color: ORANGE }} />
            <h2 className="text-base font-semibold text-white">Generate image?</h2>
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

          {refs.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {refs.slice(0, 4).map((url, i) => (
                <img key={i} src={url} alt="" className="h-14 rounded border border-gray-800" />
              ))}
            </div>
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
            style={{ background: ORANGE }}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Yes"}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
