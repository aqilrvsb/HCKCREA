"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Image as ImageIcon } from "lucide-react";
import Portal from "./portal";

// Image confirmation dialog — 1-4 image batch review before fire.

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
  const [prompt, setPrompt] = useState(payload.prompt || "");
  const [model, setModel] = useState<"nano-banana-pro" | "gpt-image-2">(
    payload.model || "nano-banana-pro"
  );
  const [refs, setRefs] = useState<string[]>(payload.reference_urls || []);
  const [aspect, setAspect] = useState(payload.aspect_ratio || "1:1");
  const [count, setCount] = useState(payload.count || 1);
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
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#1a1a1f] border border-orange-500/30 shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between p-5 border-b border-gray-800 bg-[#1a1a1f]">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5" style={{ color: ORANGE }} />
            <h2 className="text-base font-semibold text-white">Confirm Image Generation</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
              className="w-full rounded-lg bg-gray-900 border border-gray-700 text-sm text-white p-3 font-mono"
              placeholder="Descriptive paragraph, 80-200 words..."
            />
            <div className="mt-1 text-xs text-gray-500">{prompt.length} chars · {prompt.split(/\s+/).filter(Boolean).length} words</div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as any)}
                className="w-full rounded-lg bg-gray-900 border border-gray-700 text-sm text-white p-2"
              >
                <option value="nano-banana-pro">Banana Pro</option>
                <option value="gpt-image-2">GPT Image 2</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Aspect</label>
              <select
                value={aspect}
                onChange={(e) => setAspect(e.target.value)}
                className="w-full rounded-lg bg-gray-900 border border-gray-700 text-sm text-white p-2"
              >
                <option value="1:1">1:1</option>
                <option value="9:16">9:16</option>
                <option value="16:9">16:9</option>
                <option value="4:3">4:3</option>
                <option value="3:4">3:4</option>
                <option value="3:2">3:2</option>
                <option value="2:3">2:3</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Count</label>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="w-full rounded-lg bg-gray-900 border border-gray-700 text-sm text-white p-2"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </div>
          </div>

          {refs.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-400 mb-1">References ({refs.length})</div>
              <div className="flex gap-2 flex-wrap">
                {refs.map((url, i) => (
                  <div key={i} className="relative">
                    <img src={url} alt="" className="h-16 rounded border border-gray-800" />
                    <button
                      onClick={() => setRefs(refs.filter((_, j) => j !== i))}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(payload.photographer_skill_id || payload.brand_skill_id || payload.composite_skill_id) && (
            <div className="text-xs text-gray-500">
              Built from:{" "}
              {[payload.photographer_skill_id, payload.brand_skill_id, payload.composite_skill_id]
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
              style={{ background: ORANGE }}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : `Generate ${count}`}
            </button>
          </div>
        </div>
      </div>
    </div>
    </Portal>
  );
}
