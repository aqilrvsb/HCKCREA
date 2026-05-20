"use client";

import { useEffect, useState } from "react";
import { Loader2, X, Zap, Info } from "lucide-react";
import Portal from "../sections/portal";
import Sora2TipsModal from "../sections/sora2-tips-modal";
import { uploadImage, dataUrlToFile } from "@/lib/upload-image";
import AttachmentPicker from "../sections/attachment-picker";

// Sora 2 tab — dedicated home for OpenAI Sora 2 video generation via
// APIPod (model='sora-2-vip'). Took Grok's slot in the nav per user
// direction (Grok server unstable, Sora 2 is the replacement).
//
// API constraints (per APIPod sora-2-vip spec):
//   - durations: 4 / 8 / 12 ONLY (fixed enum, no slider)
//   - aspect_ratio: 9:16 OR 16:9 ONLY
//   - image_url: SINGLE first frame (not multi-ref like Grok)
//   - image dimensions MUST be 1280×720 (16:9) or 720×1280 (9:16)
//   - WARNING: real portrait photos likely cause failure (per docs)
//
// Posts to /api/generate/sora2 which inserts a tab='sora2' row +
// calls APIPod sora-2-vip via lib/p6.ts.

type Status = "idle" | "submitting" | "failed";
type ImageMode = "text" | "image";
// 4s removed per user direction (too short for useful UGC). Sora 2
// now supports 8s and 12s only on the client; APIPod still accepts
// 4 if someone hits the API directly.
type SoraDuration = 8 | 12;

// Light green theme for Sora 2 — per user direction. Distinct from
// UGC's darker green (#22c55e) by using a lighter, mint-leaning
// shade. Pops cleanly on the dashboard's dark theme via the soft/
// faint alphas for borders + inactive backgrounds.
const PURPLE = "#4ade80"; // light green (green-400) — kept const name for diff size
const PURPLE_SOFT = "rgba(74, 222, 128, 0.25)";
const PURPLE_FAINT = "rgba(74, 222, 128, 0.08)";

export default function Sora2Tab({ projectId }: { projectId?: string } = {}) {
  const [imageMode, setImageMode] = useState<ImageMode>("text");
  // SINGLE image only — Sora 2 accepts only one first-frame ref.
  const [refUrl, setRefUrl] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<"9:16" | "16:9">("9:16");
  const [duration, setDuration] = useState<SoraDuration>(8);
  const [ratePerSec, setRatePerSec] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pickingSlot, setPickingSlot] = useState<boolean>(false);
  // Tips modal — exposes Sora 2's required dialog format + other
  // important knowledge (image dims, real-portrait failure, etc.).
  // Default closed; user opens via the "Tip Sora 2" header button.
  const [tipsOpen, setTipsOpen] = useState<boolean>(false);

  useEffect(() => {
    let cancel = false;
    // Reuse Grok's rate endpoint as a placeholder until admin wires
    // a dedicated sora2 rate setting. Backend will use the actual
    // admin-configured Sora 2 rate when one exists.
    fetch("/api/sora2/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && typeof d?.rate === "number") setRatePerSec(d.rate);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  const estCost = ratePerSec ? (ratePerSec * duration).toFixed(2) : null;

  async function ensurePublicUrl(v: string): Promise<string> {
    if (!v) return "";
    if (!v.startsWith("data:")) return v;
    const file = await dataUrlToFile(v, "ref.png");
    const { url } = await uploadImage(file);
    return url;
  }

  async function submit() {
    if (!prompt.trim()) return setError("Sila masukkan prompt.");
    if (imageMode === "image" && !refUrl)
      return setError("Pick a reference image (or switch to Text only mode).");
    setError(null);
    setStatus("submitting");
    try {
      const pubUrl =
        imageMode === "image" && refUrl ? await ensurePublicUrl(refUrl) : "";
      const r = await fetch("/api/generate/sora2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          image_url: pubUrl,
          duration,
          aspect_ratio: aspect,
          image_mode: imageMode,
          project_id: projectId,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        setError(d?.error || "Generation failed");
        setStatus("failed");
        return;
      }
      window.dispatchEvent(new CustomEvent("history:refresh"));
      setStatus("idle");
    } catch (e: any) {
      setError(e?.message || "Network error");
      setStatus("failed");
    }
  }

  const busy = status === "submitting";

  return (
    <div className="space-y-5">
      <div
        className="rounded-2xl p-5 border"
        style={{
          background: `linear-gradient(135deg, ${PURPLE_FAINT}, transparent)`,
          borderColor: PURPLE_SOFT,
        }}
      >
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5" style={{ color: PURPLE }} strokeWidth={2.4} />
            <h2 className="font-display font-extrabold text-lg text-[var(--color-text-primary)]">
              Sora 2
            </h2>
          </div>
          {/* Tip Sora 2 — opens a modal explaining the dialog format
              gotcha (Veo's `Spoken dialog: '...'` doesn't fire audio
              in Sora 2; needs `Dialogue:` block) + other important
              Sora 2 specifics (image dims, real-portrait failure,
              duration limits). */}
          <button
            type="button"
            onClick={() => setTipsOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:-translate-y-0.5"
            style={{
              background: PURPLE_FAINT,
              border: `1px solid ${PURPLE_SOFT}`,
              color: PURPLE,
            }}
            title="Sora 2 prompting tips + dialog format"
          >
            <Info className="w-3.5 h-3.5" />
            Tip Sora 2
          </button>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mb-4">
          OpenAI Sora 2 · 8 / 12s · 9:16 or 16:9. Text-to-video or
          image-to-video (single first frame). Native dialog + ambient
          audio. Higher per-clip cost than Veo.
        </p>

        {/* Mode toggle — white card with purple accent on active so
            inactive state doesn't render as harsh black on the
            dashboard's dark theme (was using var(--color-bg) which is
            near-black on most user themes). */}
        <div className="flex gap-2 mb-4">
          {(["text", "image"] as const).map((m) => {
            const active = imageMode === m;
            return (
              <button
                key={m}
                onClick={() => setImageMode(m)}
                className="flex-1 px-3 py-2 rounded-xl text-xs font-bold transition-all"
                style={
                  active
                    ? {
                        background: `linear-gradient(135deg, ${PURPLE}, #16a34a)`,
                        color: "white",
                        boxShadow: `0 4px 12px ${PURPLE_SOFT}`,
                        border: "1px solid transparent",
                      }
                    : {
                        background: PURPLE_FAINT,
                        border: `1px solid ${PURPLE_SOFT}`,
                        color: "var(--color-text-primary)",
                      }
                }
              >
                {m === "text" ? "📝 Text only" : "🖼️ First frame image"}
              </button>
            );
          })}
        </div>

        {/* Single reference slot — Sora 2 only accepts ONE first-frame image */}
        {imageMode === "image" && (
          <div className="mb-4">
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
              First frame (single image)
            </label>
            <div className="grid grid-cols-3 gap-2">
              {refUrl ? (
                <div
                  className="relative aspect-square rounded-lg overflow-hidden col-span-1"
                  style={{ border: "1px solid var(--color-border)" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={refUrl}
                    alt="First frame reference"
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => setRefUrl("")}
                    title="Clear this reference"
                    className="absolute top-1 right-1 w-6 h-6 rounded-md flex items-center justify-center"
                    style={{ background: "rgba(0,0,0,0.7)", color: "white" }}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setPickingSlot(true)}
                  className="aspect-square rounded-lg text-xs font-bold flex flex-col items-center justify-center gap-1 transition-colors col-span-1"
                  style={{
                    background: "var(--color-bg)",
                    border: "1px dashed var(--color-border)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  <span className="text-lg">+</span>
                  <span>First frame</span>
                </button>
              )}
            </div>
            {/* Sora 2-specific image constraints — surface upfront so
                users don't waste a generation on an incompatible image. */}
            <div
              className="mt-2 flex items-start gap-2 px-3 py-2 rounded-lg text-[10px]"
              style={{
                background: "rgba(168,85,247,0.08)",
                border: "1px solid rgba(168,85,247,0.25)",
                color: "var(--color-text-secondary)",
              }}
            >
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: PURPLE }} />
              <div>
                <div className="font-bold mb-0.5" style={{ color: PURPLE }}>
                  Sora 2 image rules
                </div>
                Image must be {aspect === "9:16" ? "720×1280 (9:16 portrait)" : "1280×720 (16:9 landscape)"}.
                Avoid real portrait photos — Sora 2 will likely fail on
                real-person faces.
              </div>
            </div>
          </div>
        )}

        {/* Prompt */}
        <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
          Prompt
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, 4000))}
          maxLength={4000}
          rows={4}
          placeholder="Describe the video — characters, action, mood, camera style…"
          className="w-full px-3 py-2 rounded-lg text-sm mb-4"
          style={{
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
        <div className="text-[10px] text-gray-400 mt-1 text-right -mt-3 mb-3">
          {prompt.length}/4000
        </div>

        {/* Aspect + Duration — Sora 2 has strict enums for both */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
              Aspect ratio
            </label>
            <div className="flex gap-2">
              {(["9:16", "16:9"] as const).map((a) => {
                const active = aspect === a;
                return (
                  <button
                    key={a}
                    onClick={() => setAspect(a)}
                    className="flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-all"
                    style={
                      active
                        ? {
                            background: `linear-gradient(135deg, ${PURPLE}, #16a34a)`,
                            color: "white",
                            border: "1px solid transparent",
                            boxShadow: `0 4px 12px ${PURPLE_SOFT}`,
                          }
                        : {
                            background: PURPLE_FAINT,
                            border: `1px solid ${PURPLE_SOFT}`,
                            color: "var(--color-text-primary)",
                          }
                    }
                  >
                    {a}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
              Duration
            </label>
            <div className="flex gap-2">
              {([8, 12] as const).map((d) => {
                const active = duration === d;
                return (
                  <button
                    key={d}
                    onClick={() => setDuration(d)}
                    className="flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-all"
                    style={
                      active
                        ? {
                            background: `linear-gradient(135deg, ${PURPLE}, #16a34a)`,
                            color: "white",
                            border: "1px solid transparent",
                            boxShadow: `0 4px 12px ${PURPLE_SOFT}`,
                          }
                        : {
                            background: PURPLE_FAINT,
                            border: `1px solid ${PURPLE_SOFT}`,
                            color: "var(--color-text-primary)",
                          }
                    }
                  >
                    {d}s
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="w-full py-3 rounded-xl font-extrabold text-sm transition-all disabled:opacity-60 text-white"
          style={{
            background: PURPLE,
            boxShadow: `0 6px 18px ${PURPLE_SOFT}`,
          }}
        >
          {busy ? (
            <span className="inline-flex items-center gap-2 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Generating…
            </span>
          ) : (
            `⚡ Generate Sora 2 Video${estCost ? ` · ~RM${estCost}` : ""}`
          )}
        </button>

        {error && (
          <div
            className="mt-3 px-3 py-2 rounded-lg text-xs"
            style={{
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.35)",
              color: "rgb(239,68,68)",
            }}
          >
            {error}
          </div>
        )}
      </div>

      {pickingSlot && (
        <Portal>
          <AttachmentPicker
            open={true}
            onClose={() => setPickingSlot(false)}
            onPick={(a) => {
              setRefUrl(a.public_url);
              setPickingSlot(false);
            }}
          />
        </Portal>
      )}

      {tipsOpen && (
        <Portal>
          <Sora2TipsModal onClose={() => setTipsOpen(false)} />
        </Portal>
      )}
    </div>
  );
}
