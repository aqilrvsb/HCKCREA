"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Sparkles } from "lucide-react";
import Portal from "./portal";

// UGC confirmation — yes/no only. Agent already built the variants;
// user just approves the batch or cancels.

type Variant = {
  scene: string;
  persona: string;
  hook: string;
  structure: string;
  cta: string;
  voice: string;
  gender: string;
  hijab?: string;
  age?: string;
  prompt: string;
  caption?: string;
  seg2_prompt?: string;
  character_lock?: string;
  frame_anchor?: "first" | "middle" | "last";
};

type ConfirmPayload = {
  type: "confirm_generation";
  bucket: "ugc";
  params: {
    product_image_url: string;
    product_description: string;
    duration: string;
    aspect_ratio: string;
    variants: Variant[];
  };
  estimated_cost: number;
};

export default function ConfirmUgcDialog({
  payload,
  conversationId,
  projectId,
  onClose,
  onFired,
}: {
  payload: ConfirmPayload;
  conversationId: string | null;
  projectId: string | null;
  onClose: () => void;
  onFired: (historyIds: string[], totalCost: number) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const variants = payload.params.variants;
  const productImageUrl = payload.params.product_image_url;
  const duration = payload.params.duration || "8";
  const aspectRatio = payload.params.aspect_ratio || "9:16";
  const totalCost = payload.estimated_cost;

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
    setSubmitting(true);
    setErrorMessage("");
    try {
      const r = await fetch("/api/agent/ugc/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          conversation_id: conversationId,
          product_image_url: productImageUrl,
          product_description: payload.params.product_description,
          duration,
          aspect_ratio: aspectRatio,
          variants,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) {
        setErrorMessage(j?.error || `HTTP ${r.status}`);
        return;
      }
      onFired(j.history_ids || [], j.total_cost || 0);
    } catch (e: any) {
      setErrorMessage(e?.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Portal>
    <div
      className="fixed inset-0 lg:left-[280px] z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl max-w-md w-full"
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
              style={{
                background:
                  "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
              }}
            >
              <Sparkles className="w-4 h-4" />
            </div>
            <h2 className="font-display font-extrabold text-base text-[var(--color-text-primary)]">
              Generate {variants.length} UGC video{variants.length > 1 ? "s" : ""}?
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-secondary)",
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-secondary)]">Total cost</span>
            <span className="font-display font-extrabold text-[var(--color-text-primary)]">
              RM {totalCost.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)]">
            <span>{duration}s · {aspectRatio}</span>
            <span>{variants.length} × RM {(totalCost / Math.max(variants.length, 1)).toFixed(2)}</span>
          </div>
          {productImageUrl && (
            <img
              src={productImageUrl}
              alt=""
              className="mt-2 max-h-24 rounded border border-[var(--color-border)]"
            />
          )}
        </div>

        {errorMessage && (
          <div
            className="px-5 py-2 text-xs"
            style={{
              background: "rgba(239,68,68,0.1)",
              borderTop: "1px solid rgba(239,68,68,0.3)",
              color: "#ef4444",
            }}
          >
            {errorMessage}
          </div>
        )}

        <div
          className="px-5 py-4 border-t flex items-center justify-end gap-2"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg)",
          }}
        >
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-5 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-secondary)",
            }}
          >
            No
          </button>
          <button
            onClick={fire}
            disabled={submitting || variants.length === 0}
            className="px-6 py-2 rounded-lg text-xs font-extrabold uppercase tracking-wider text-white disabled:opacity-50 inline-flex items-center gap-2"
            style={{
              background:
                "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
              boxShadow: "0 4px 14px rgba(34,197,94,0.3)",
            }}
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Firing…
              </>
            ) : (
              "Yes"
            )}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
