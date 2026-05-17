"use client";

import { useEffect, useState } from "react";
import { Loader2, X, Zap } from "lucide-react";
import Portal from "../sections/portal";
import { uploadImage, dataUrlToFile } from "@/lib/upload-image";
import AttachmentPicker from "../sections/attachment-picker";

// Grok tab — dedicated home for Grok Imagine video generation.
// Replaces the "Normal Video" sub-feature that used to live inside the
// Viral (cinema) tab. Model is locked to Grok (no Veo option here —
// Veo lives in UGC / Auto Content). Posts to /api/generate/cinema with
// model=grok which routes through the p6 (APIPod) cascade.

type Status = "idle" | "submitting" | "failed";
type ImageMode = "text" | "image";

const ORANGE = "#f97316";
const ORANGE_SOFT = "rgba(249, 115, 22, 0.18)";
const ORANGE_FAINT = "rgba(249, 115, 22, 0.06)";

// Three fixed reference slots — user can fill 0-3. APIPod's grok-imagine-i2v
// supports 1-7 image_urls but per product decision we expose 3 to keep
// the UI clean and consistent with other tabs.
const GROK_REF_SLOTS = 3;

export default function GrokTab({ projectId }: { projectId?: string } = {}) {
  const [imageMode, setImageMode] = useState<ImageMode>("text");
  // Length-3 array of slot URLs ("" = empty slot). Stays length 3.
  const [refSlots, setRefSlots] = useState<string[]>(
    Array(GROK_REF_SLOTS).fill("")
  );
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("9:16");
  // Grok bills per-second, 6-30 range. Default 6 per APIPod docs.
  const [duration, setDuration] = useState<number>(6);
  const [ratePerSec, setRatePerSec] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  // Which slot index the attachment picker is currently filling.
  const [pickingSlot, setPickingSlot] = useState<number | null>(null);

  useEffect(() => {
    let cancel = false;
    fetch("/api/grok/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && typeof d?.rate === "number") setRatePerSec(d.rate);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  // Non-empty refs only — what gets sent to the API.
  const filledRefs = refSlots.filter((u) => !!u);
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
    if (imageMode === "image" && filledRefs.length === 0)
      return setError("Pick at least one reference image.");
    setError(null);
    setStatus("submitting");
    try {
      const sourceUrls = imageMode === "image" ? filledRefs : [];
      const pubUrls = await Promise.all(sourceUrls.map((u) => ensurePublicUrl(u)));
      const r = await fetch("/api/generate/cinema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          image_url: pubUrls[0] || "",
          image_urls: pubUrls,
          duration,
          resolution: "720p",
          aspect_ratio: aspect,
          image_mode: imageMode,
          model: "grok",
          // Tag so history-grid can route this row into the Grok tab
          // (separate from the legacy Cinema → Normal Video sub-tab).
          feature: "grok",
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
          background: `linear-gradient(135deg, ${ORANGE_FAINT}, transparent)`,
          borderColor: ORANGE_SOFT,
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <Zap className="w-5 h-5" style={{ color: ORANGE }} strokeWidth={2.4} />
          <h2 className="font-display font-extrabold text-lg text-[var(--color-text-primary)]">
            Grok Imagine
          </h2>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mb-4">
          Per-second billing · 6–30s · 720p. Text-to-video or image-to-video
          (1–7 reference images).
        </p>

        {/* Mode toggle */}
        <div className="flex gap-2 mb-4">
          {(["text", "image"] as const).map((m) => {
            const active = imageMode === m;
            return (
              <button
                key={m}
                onClick={() => setImageMode(m)}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-all"
                style={
                  active
                    ? {
                        background: ORANGE,
                        color: "#1a1a1a",
                        boxShadow: `0 4px 12px ${ORANGE_SOFT}`,
                      }
                    : {
                        background: "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                        color: "var(--color-text-primary)",
                      }
                }
              >
                {m === "text" ? "📝 Text only" : "🖼️ With reference image"}
              </button>
            );
          })}
        </div>

        {/* Reference image slots — 3 fixed boxes, fill any 0-3.
            Click empty box → opens picker, click X on filled → clears. */}
        {imageMode === "image" && (
          <div className="mb-4">
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
              Reference images (up to {GROK_REF_SLOTS})
            </label>
            <div className="grid grid-cols-3 gap-2">
              {refSlots.map((url, i) =>
                url ? (
                  <div
                    key={i}
                    className="relative aspect-square rounded-lg overflow-hidden"
                    style={{ border: "1px solid var(--color-border)" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={`Reference ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={() =>
                        setRefSlots(refSlots.map((u, j) => (j === i ? "" : u)))
                      }
                      title="Clear this reference"
                      className="absolute top-1 right-1 w-6 h-6 rounded-md flex items-center justify-center"
                      style={{ background: "rgba(0,0,0,0.7)", color: "white" }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    key={i}
                    onClick={() => setPickingSlot(i)}
                    className="aspect-square rounded-lg text-xs font-bold flex flex-col items-center justify-center gap-1 transition-colors"
                    style={{
                      background: "var(--color-bg)",
                      border: "1px dashed var(--color-border)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    <span className="text-lg">+</span>
                    <span>Image {i + 1}</span>
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {/* Prompt */}
        <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
          Prompt
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
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

        {/* Aspect + Duration */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
              Aspect ratio
            </label>
            <select
              value={aspect}
              onChange={(e) => setAspect(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            >
              <option value="9:16">9:16 (Vertical)</option>
              <option value="16:9">16:9 (Horizontal)</option>
              <option value="1:1">1:1 (Square)</option>
              <option value="2:3">2:3</option>
              <option value="3:2">3:2</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
              Duration ({duration}s)
            </label>
            <input
              type="range"
              min={6}
              max={30}
              step={1}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full"
              style={{ accentColor: ORANGE }}
            />
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="w-full py-3 rounded-xl font-extrabold text-sm transition-all disabled:opacity-60"
          style={{
            background: ORANGE,
            color: "#1a1a1a",
            boxShadow: `0 6px 18px ${ORANGE_SOFT}`,
          }}
        >
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Generating…
            </span>
          ) : (
            `⚡ Generate Grok Video${estCost ? ` · ~RM${estCost}` : ""}`
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

      {pickingSlot !== null && (
        <Portal>
          <AttachmentPicker
            open={true}
            onClose={() => setPickingSlot(null)}
            onPick={(a) => {
              setRefSlots(
                refSlots.map((u, j) => (j === pickingSlot ? a.public_url : u))
              );
              setPickingSlot(null);
            }}
          />
        </Portal>
      )}
    </div>
  );
}
