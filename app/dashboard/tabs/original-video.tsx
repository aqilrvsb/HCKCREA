"use client";

import { useEffect, useState } from "react";
import { Loader2, X, Film } from "lucide-react";
import Portal from "../sections/portal";
import { uploadImage, dataUrlToFile } from "@/lib/upload-image";
import AttachmentPicker from "../sections/attachment-picker";

// Original Video tab — 3-provider raw video generator.
//
// Replaces the hidden "Normal Video" (was inside Viral) and exposes
// three providers in one place: Veo 3.1 Fast / Grok Imagine / Sora 2.
// Power-user tab — prompt is sent 100% verbatim to the provider, no
// auto-injected locks, no Dialogue:-block transforms, no ref-image
// preambles. Whatever the user types in the textarea is what reaches
// the model.
//
// Per-provider constraints:
//   • Veo 3.1     → 3 image modes (text / start-frame i2v / multi-ref r2v)
//                   fixed 8s duration, cinema_rate × 8 cost
//   • Grok        → 2 image modes (text / start-frame i2v)
//                   8-30s duration slider, cinema_rate × duration cost
//   • Sora 2      → 2 image modes (text / start-frame i2v)
//                   8 or 12s duration, sora2_rate × duration cost
//
// Backend: posts to /api/generate/cinema with model="veo"|"grok"|"sora2".
// Cascade dispatches via asset='video' | 'grok' | 'sora2' so each
// provider pulls from its own admin-configured slot pool.

type Status = "idle" | "submitting" | "failed";
type Provider = "veo" | "grok" | "sora2";
type ImageMode = "text" | "frame" | "ingredient";

const REF_SLOTS = 3; // max slots in the UI; per-provider cap clamps at submit time

// Per-provider theme — picker chips use these as the active gradient.
const PROVIDER_THEME: Record<
  Provider,
  { primary: string; soft: string; faint: string; gradient: string; emoji: string }
> = {
  veo: {
    primary: "#facc15",
    soft: "rgba(250,204,21,0.25)",
    faint: "rgba(250,204,21,0.08)",
    gradient: "linear-gradient(135deg, #facc15, #f59e0b)",
    emoji: "🎬",
  },
  grok: {
    primary: "#f97316",
    soft: "rgba(249,115,22,0.25)",
    faint: "rgba(249,115,22,0.08)",
    gradient: "linear-gradient(135deg, #fb923c, #f97316)",
    emoji: "⚡",
  },
  sora2: {
    primary: "#4ade80",
    soft: "rgba(74,222,128,0.25)",
    faint: "rgba(74,222,128,0.08)",
    gradient: "linear-gradient(135deg, #4ade80, #16a34a)",
    emoji: "✨",
  },
};

// Per-provider image-mode availability. Veo gets all 3, Grok + Sora 2
// drop the multi-ref "ingredient" mode since their APIs only accept
// a single first-frame image (Grok technically supports 1-7 but the
// raw tab keeps the UX uniform with Sora 2).
const PROVIDER_MODES: Record<Provider, ImageMode[]> = {
  veo: ["text", "frame", "ingredient"],
  grok: ["text", "frame"],
  sora2: ["text", "frame"],
};

// Per-provider image cap (frontend mirrors the backend cap in
// /api/generate/cinema). Sora 2 = 1 first frame, Veo = up to 3 refs.
const PROVIDER_REF_CAP: Record<Provider, number> = {
  veo: 3,
  grok: 1,
  sora2: 1,
};

const MODE_LABEL: Record<ImageMode, string> = {
  text: "📝 Text only",
  frame: "🖼️ Start frame",
  ingredient: "🧩 Product reference",
};

export default function OriginalVideoTab({
  projectId,
}: { projectId?: string } = {}) {
  const [provider, setProvider] = useState<Provider>("veo");
  const [imageMode, setImageMode] = useState<ImageMode>("text");
  // Up to 3 ref slots. Per-provider cap applied at submit time so the
  // user doesn't lose picks when switching providers.
  const [refSlots, setRefSlots] = useState<string[]>(Array(REF_SLOTS).fill(""));
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("9:16");
  // Veo = fixed 8s. Grok = slider 8-30. Sora 2 = 8 or 12.
  const [duration, setDuration] = useState<number>(8);
  // Per-provider rates (cinema rate for Veo/Grok, sora2 rate for Sora 2).
  const [cinemaRatePerSec, setCinemaRatePerSec] = useState<number | null>(null);
  const [sora2RatePerSec, setSora2RatePerSec] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pickingSlot, setPickingSlot] = useState<number | null>(null);

  useEffect(() => {
    let cancel = false;
    fetch("/api/grok/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && typeof d?.rate === "number") setCinemaRatePerSec(d.rate);
      })
      .catch(() => {});
    fetch("/api/sora2/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && typeof d?.rate === "number") setSora2RatePerSec(d.rate);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  // Clamp image mode + duration when provider changes. Switching to a
  // provider that doesn't support the current mode falls back to "text"
  // so the user always lands in a valid state.
  useEffect(() => {
    if (!PROVIDER_MODES[provider].includes(imageMode)) {
      setImageMode("text");
    }
    if (provider === "veo" && duration !== 8) setDuration(8);
    if (provider === "sora2" && duration !== 8 && duration !== 12) {
      setDuration(8);
    }
    if (provider === "grok" && (duration < 8 || duration > 30)) {
      setDuration(Math.min(30, Math.max(8, duration)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const theme = PROVIDER_THEME[provider];
  const availableModes = PROVIDER_MODES[provider];
  const refCap = PROVIDER_REF_CAP[provider];
  const filledRefs = refSlots.filter((u) => !!u);

  // Live cost preview. Veo + Grok use cinema rate × duration; Sora 2
  // uses its own rate. Null when admin hasn't configured the rate yet.
  const effectiveRate = provider === "sora2" ? sora2RatePerSec : cinemaRatePerSec;
  const estCost = effectiveRate != null
    ? (effectiveRate * duration).toFixed(2)
    : null;

  async function ensurePublicUrl(v: string): Promise<string> {
    if (!v) return "";
    if (!v.startsWith("data:")) return v;
    const file = await dataUrlToFile(v, "ref.png");
    const { url } = await uploadImage(file);
    return url;
  }

  async function submit() {
    if (!prompt.trim()) return setError("Sila masukkan prompt.");
    if (imageMode !== "text" && filledRefs.length === 0) {
      return setError("Pick at least one reference image.");
    }
    setError(null);
    setStatus("submitting");
    try {
      const sourceUrls =
        imageMode === "text" ? [] : filledRefs.slice(0, refCap);
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
          // Cinema route uses "text" / "frame" / "ingredient" directly.
          image_mode: imageMode,
          model: provider, // "veo" | "grok" | "sora2"
          // Tag so history grid can route this row into the Original
          // Video tab (separate from legacy Cinema / Grok rows).
          feature: "original-video",
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
          background: `linear-gradient(135deg, ${theme.faint}, transparent)`,
          borderColor: theme.soft,
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <Film className="w-5 h-5" style={{ color: theme.primary }} strokeWidth={2.4} />
          <h2 className="font-display font-extrabold text-lg text-[var(--color-text-primary)]">
            Original Video
          </h2>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mb-4">
          Power-user raw video generator. Pick a provider — prompt sent
          100% verbatim, no auto-locks or templates. Cascade fallback +
          history + deduct-on-success all work like other tabs.
        </p>

        {/* Provider picker — 3 chips, each themed */}
        <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
          Provider
        </label>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {(["veo", "grok", "sora2"] as const).map((p) => {
            const active = provider === p;
            const t = PROVIDER_THEME[p];
            return (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className="px-3 py-2.5 rounded-xl text-xs font-extrabold transition-all"
                style={
                  active
                    ? {
                        background: t.gradient,
                        color: p === "veo" ? "#1a1a1a" : "white",
                        boxShadow: `0 4px 12px ${t.soft}`,
                        border: "1px solid transparent",
                      }
                    : {
                        background: "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                        color: "var(--color-text-primary)",
                      }
                }
              >
                {t.emoji}{" "}
                {p === "veo" ? "Veo 3.1" : p === "grok" ? "Grok" : "Sora 2"}
              </button>
            );
          })}
        </div>

        {/* Image mode — conditional per provider */}
        <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
          Image mode
        </label>
        <div
          className="grid gap-2 mb-4"
          style={{
            gridTemplateColumns: `repeat(${availableModes.length}, minmax(0, 1fr))`,
          }}
        >
          {availableModes.map((m) => {
            const active = imageMode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setImageMode(m)}
                className="px-3 py-2 rounded-lg text-xs font-bold transition-all"
                style={
                  active
                    ? {
                        background: theme.gradient,
                        color: provider === "veo" ? "#1a1a1a" : "white",
                        boxShadow: `0 4px 12px ${theme.soft}`,
                      }
                    : {
                        background: "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                        color: "var(--color-text-primary)",
                      }
                }
              >
                {MODE_LABEL[m]}
              </button>
            );
          })}
        </div>

        {/* Ref image slots */}
        {imageMode !== "text" && (
          <div className="mb-4">
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
              Reference image{refCap === 1 ? "" : "s"} (up to {refCap})
            </label>
            <div
              className="grid gap-2"
              style={{
                gridTemplateColumns: `repeat(${Math.min(refCap, REF_SLOTS)}, minmax(0, 1fr))`,
              }}
            >
              {refSlots.slice(0, refCap).map((url, i) =>
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
            {imageMode === "frame" && provider === "sora2" && (
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5">
                ⚠️ Sora 2 needs 720×1280 (9:16) or 1280×720 (16:9). Real
                portrait photos often fail — use AI-gen images.
              </p>
            )}
          </div>
        )}

        {/* Prompt */}
        <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
          Prompt (sent verbatim — no auto-locks)
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={5000}
          rows={5}
          placeholder="Describe the video — characters, action, mood, camera style, dialogue if any…"
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
              {provider === "veo" || provider === "grok" ? (
                <>
                  <option value="1:1">1:1 (Square)</option>
                  <option value="2:3">2:3</option>
                  <option value="3:2">3:2</option>
                </>
              ) : null}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
              Duration{provider === "veo" ? "" : ` (${duration}s)`}
            </label>
            {provider === "veo" && (
              <div
                className="px-3 py-2 rounded-lg text-sm font-bold text-center"
                style={{
                  background: theme.faint,
                  border: `1px solid ${theme.soft}`,
                  color: theme.primary,
                }}
              >
                Fixed 8s
              </div>
            )}
            {provider === "grok" && (
              <input
                type="range"
                min={8}
                max={30}
                step={1}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full"
                style={{ accentColor: theme.primary }}
              />
            )}
            {provider === "sora2" && (
              <div className="grid grid-cols-2 gap-2">
                {([8, 12] as const).map((d) => {
                  const active = duration === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDuration(d)}
                      className="px-2 py-2 rounded-lg text-xs font-extrabold transition-all"
                      style={
                        active
                          ? {
                              background: theme.gradient,
                              color: "white",
                              boxShadow: `0 4px 12px ${theme.soft}`,
                            }
                          : {
                              background: "var(--color-bg)",
                              border: "1px solid var(--color-border)",
                              color: "var(--color-text-primary)",
                            }
                      }
                    >
                      {d}s
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="w-full py-3 rounded-xl font-extrabold text-sm transition-all disabled:opacity-60"
          style={{
            background: theme.gradient,
            color: provider === "veo" ? "#1a1a1a" : "white",
            boxShadow: `0 6px 18px ${theme.soft}`,
          }}
        >
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Generating…
            </span>
          ) : (
            `${theme.emoji} Generate ${provider === "veo" ? "Veo" : provider === "grok" ? "Grok" : "Sora 2"} Video${estCost ? ` · ~RM${estCost}` : ""}`
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
