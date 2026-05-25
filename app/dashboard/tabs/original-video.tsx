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
type Provider = "veo" | "grok" | "sora2" | "gemini";
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
    // Light red per user direction (was green, then briefly blue).
    // Red-400 → Red-500 gradient — distinct from Veo's gold and Grok's
    // orange so the 3 provider chips read as 3 visibly different
    // colors at a glance.
    primary: "#f87171",
    soft: "rgba(248,113,113,0.25)",
    faint: "rgba(248,113,113,0.08)",
    gradient: "linear-gradient(135deg, #f87171, #ef4444)",
    emoji: "✨",
  },
  gemini: {
    // GeminiOmni — blue/cyan gradient (#3b82f6 → #06b6d4). Distinct
    // from Veo's gold, Grok's orange, Sora 2's red so the 4-chip row
    // reads as four visibly different providers at a glance.
    primary: "#06b6d4",
    soft: "rgba(6,182,212,0.25)",
    faint: "rgba(6,182,212,0.08)",
    gradient: "linear-gradient(135deg, #3b82f6, #06b6d4)",
    emoji: "🔷",
  },
};

// Per-provider image-mode availability. Per user direction every
// provider should expose its full set of meaningful modes so the user
// always picks explicitly:
//   • Veo  → all 3 modes (text-to-video, start-frame i2v, multi-ref r2v)
//   • Grok → text + multi-ref (Grok's API takes image_urls as a single
//            array — start-frame is just "ref with 1 image", so we
//            collapse to text + ingredient)
//   • Sora 2 → text + start-frame (single first frame, API-mandated)
const PROVIDER_MODES: Record<Provider, ImageMode[]> = {
  veo: ["text", "frame", "ingredient"],
  grok: ["text", "ingredient"],
  sora2: ["text", "frame"],
  // GeminiOmni: text + ingredient (multi-ref up to 3). API has no
  // first-frame concept (just generic img_urls) — frame mode would
  // be UX duplication of single-image ingredient mode.
  gemini: ["text", "ingredient"],
};

// Per-(provider, mode) slot count. text=0 by definition; frame is 1
// (Sora 2) or 2 (Veo start+end frame); ingredient is 3 (Veo + Grok
// multi-ref). API caps in /api/generate/cinema mirror these.
function getRefCap(provider: Provider, mode: ImageMode): number {
  if (mode === "text") return 0;
  if (mode === "frame") return provider === "veo" ? 2 : 1;
  // ingredient — Veo + Grok + GeminiOmni all cap at 3 (Gemini API allows
  // 7 but Original Video tab UX matches Veo's 3 for layout consistency).
  return 3;
}

// Mode picker button labels. Per user direction, both multi-ref
// (ingredient) and single-image (frame) modes use the "References"
// nomenclature when the provider treats refs as a generic input list.
// Veo keeps the "Start frame" label for its frame mode because its
// frame mode is semantically distinct (i2v start+end frame, not r2v).
function modeLabel(provider: Provider, mode: ImageMode): string {
  if (mode === "text") return "📝 Text only";
  if (mode === "frame") return "🖼️ Start frame";
  // ingredient (multi-ref) → "References" for all providers
  return "🧩 References";
}

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
  // Per-provider rates:
  //   • Veo    → /api/veo/rate (flat per-video price, rate_veo setting)
  //   • Grok   → /api/grok/rate (per-second rate × duration)
  //   • Sora 2 → /api/sora2/rate (per-second rate × duration)
  const [veoFlatRate, setVeoFlatRate] = useState<number | null>(null);
  const [grokRatePerSec, setGrokRatePerSec] = useState<number | null>(null);
  const [sora2RatePerSec, setSora2RatePerSec] = useState<number | null>(null);
  // GeminiOmni — flat per-10s-video rate (like Veo, not per-second).
  const [geminiFlatRate, setGeminiFlatRate] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pickingSlot, setPickingSlot] = useState<number | null>(null);

  useEffect(() => {
    let cancel = false;
    // Veo flat rate (rate_veo.per_video_8s setting — admin-driven).
    fetch("/api/veo/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && typeof d?.rate === "number") setVeoFlatRate(d.rate);
      })
      .catch(() => {});
    // Grok per-second rate (shares cinema rate setting).
    fetch("/api/grok/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && typeof d?.rate === "number") setGrokRatePerSec(d.rate);
      })
      .catch(() => {});
    // Sora 2 per-second rate (sora2_rate setting, falls back to cinema × 2).
    fetch("/api/sora2/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && typeof d?.rate === "number") setSora2RatePerSec(d.rate);
      })
      .catch(() => {});
    // GeminiOmni flat per-video rate (rate_gemini.per_video_10s).
    fetch("/api/gemini/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && typeof d?.rate === "number") setGeminiFlatRate(d.rate);
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
    // GeminiOmni — fixed 10s.
    if (provider === "gemini" && duration !== 10) setDuration(10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const theme = PROVIDER_THEME[provider];
  const availableModes = PROVIDER_MODES[provider];
  const refCap = getRefCap(provider, imageMode);
  const filledRefs = refSlots.filter((u) => !!u);

  // Live cost preview. Veo + Grok use cinema rate × duration; Sora 2
  // uses its own rate. Null when admin hasn't configured the rate yet.
  // Per-provider cost preview — mirrors the backend pricing branch in
  // /api/generate/cinema so what user sees on the button = what they
  // pay on settlement.
  //   • Veo    → flat veoFlatRate (regardless of duration since Veo is fixed 8s)
  //   • Grok   → grokRatePerSec × duration (per-second)
  //   • Sora 2 → sora2RatePerSec × duration (per-second)
  let estCost: string | null = null;
  if (provider === "veo" && veoFlatRate != null) {
    estCost = veoFlatRate.toFixed(2);
  } else if (provider === "grok" && grokRatePerSec != null) {
    estCost = (grokRatePerSec * duration).toFixed(2);
  } else if (provider === "sora2" && sora2RatePerSec != null) {
    estCost = (sora2RatePerSec * duration).toFixed(2);
  } else if (provider === "gemini" && geminiFlatRate != null) {
    // Gemini is flat per-video (10s fixed) — don't multiply by duration.
    estCost = geminiFlatRate.toFixed(2);
  }

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
          // Gemini forces 1080p server-side; we still send the right
          // value here so the optimistic UI cost preview matches what
          // /api/generate/cinema will actually compute.
          resolution: provider === "gemini" ? "1080p" : "720p",
          aspect_ratio: aspect,
          // Cinema route uses "text" / "frame" / "ingredient" directly.
          image_mode: imageMode,
          model: provider, // "veo" | "grok" | "sora2" | "gemini"
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {(["veo", "grok", "sora2", "gemini"] as const).map((p) => {
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
                {p === "veo"
                  ? "Veo 3.1"
                  : p === "grok"
                    ? "Grok"
                    : p === "sora2"
                      ? "Sora 2"
                      : "GeminiOmni"}
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
                {modeLabel(provider, m)}
              </button>
            );
          })}
        </div>

        {/* Per-(provider, mode) slot layouts. Mirrors UGC tab's
            FrameZoneRow / MultiRefRow structure but inlined here to
            keep the file self-contained. Slot semantics:
              • Veo + frame      → Start Frame * + End Frame (2 labeled zones)
              • Veo + ingredient → Multi-ref Product Reference (up to 3)
              • Grok + ingredient → Multi-ref Product Reference (up to 3)
              • Sora 2 + frame   → single Start Frame zone
              • any provider + text → no slots */}

        {/* === Veo Start + End Frame layout === */}
        {provider === "veo" && imageMode === "frame" && (
          <div className="mb-4 grid grid-cols-2 gap-3">
            <FrameZone
              label="Start Frame"
              required
              theme={theme}
              url={refSlots[0] || ""}
              onPick={() => setPickingSlot(0)}
              onClear={() =>
                setRefSlots(refSlots.map((u, j) => (j === 0 ? "" : u)))
              }
            />
            <FrameZone
              label="End Frame"
              theme={theme}
              url={refSlots[1] || ""}
              onPick={() => setPickingSlot(1)}
              onClear={() =>
                setRefSlots(refSlots.map((u, j) => (j === 1 ? "" : u)))
              }
            />
          </div>
        )}

        {/* === Sora 2 single Start Frame zone === */}
        {provider === "sora2" && imageMode === "frame" && (
          <div className="mb-4 grid grid-cols-2 gap-3">
            <FrameZone
              label="Start Frame"
              required
              theme={theme}
              url={refSlots[0] || ""}
              onPick={() => setPickingSlot(0)}
              onClear={() =>
                setRefSlots(refSlots.map((u, j) => (j === 0 ? "" : u)))
              }
            />
            <div className="text-[10px] text-[var(--color-text-muted)] self-center">
              ⚠️ Sora 2 needs 720×1280 (9:16) or 1280×720 (16:9). Real
              portrait photos often fail — use AI-gen images.
            </div>
          </div>
        )}

        {/* === Multi-ref References (Veo + Grok) === */}
        {imageMode === "ingredient" && (
          <div className="mb-4">
            <div
              className="text-[11px] font-bold uppercase tracking-wider mb-1.5"
              style={{ color: theme.primary }}
            >
              References ({filledRefs.length}/{refCap})
            </div>
            <div className="flex items-stretch gap-2">
              <div className="flex gap-1.5 flex-wrap">
                {Array.from({ length: refCap }).map((_, i) => {
                  const url = refSlots[i] || "";
                  // Slot 1 is mandatory, slots 2+ optional per user
                  // direction. Mandatory slot uses a solid (not dashed)
                  // border so the "must fill this one" affordance is
                  // visible at a glance even when empty.
                  const isRequired = i === 0;
                  return (
                    <div key={i} className="flex flex-col items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => setPickingSlot(i)}
                        className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
                        style={{
                          border: url
                            ? `2px solid ${theme.primary}`
                            : isRequired
                              ? `2px solid ${theme.soft}`
                              : `2px dashed ${theme.soft}`,
                          background: url ? "#000" : "var(--color-bg)",
                        }}
                      >
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={url}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span
                            className="text-xs font-semibold"
                            style={{ color: theme.primary }}
                          >
                            {i + 1}
                          </span>
                        )}
                        {url && (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              setRefSlots(
                                refSlots.map((u, j) => (j === i ? "" : u))
                              );
                            }}
                            className="absolute top-0 right-0 w-4 h-4 rounded-bl bg-black/70 text-white text-[10px] flex items-center justify-center cursor-pointer"
                          >
                            ×
                          </span>
                        )}
                      </button>
                      <span
                        className="text-[9px] font-mono uppercase tracking-wider"
                        style={{
                          color: isRequired
                            ? "#ef4444"
                            : "var(--color-text-muted)",
                        }}
                      >
                        {isRequired ? "REQUIRED" : "OPTIONAL"}
                      </span>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setPickingSlot(filledRefs.length)}
                disabled={filledRefs.length >= refCap}
                className="px-3 py-1 rounded text-[11px] font-bold whitespace-nowrap disabled:opacity-40 self-start"
                style={{
                  background: theme.faint,
                  border: `1px solid ${theme.primary}`,
                  color: theme.primary,
                }}
              >
                Reference
              </button>
            </div>
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
            {provider === "gemini" && (
              <div
                className="px-3 py-2 rounded-lg text-sm font-bold text-center"
                style={{
                  background: theme.faint,
                  border: `1px solid ${theme.soft}`,
                  color: theme.primary,
                }}
              >
                Fixed 10s
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
            `${theme.emoji} Generate ${provider === "veo" ? "Veo" : provider === "grok" ? "Grok" : provider === "sora2" ? "Sora 2" : "GeminiOmni"} Video${estCost ? ` · ~RM${estCost}` : ""}`
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

// Single labeled image picker zone — used by Veo Start/End Frame mode
// and Sora 2 single first-frame mode. Mirrors UGC tab's FrameZoneRow
// shape: label above, 64×64 slot, side "Reference" picker button,
// inline × clear when filled. `required` shows an asterisk + solid
// border accent to signal mandatory.
function FrameZone({
  label,
  required,
  theme,
  url,
  onPick,
  onClear,
}: {
  label: string;
  required?: boolean;
  theme: { primary: string; soft: string; faint: string };
  url: string;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div>
      <div
        className="text-[11px] font-bold uppercase tracking-wider mb-1.5 flex items-baseline gap-1.5"
        style={{ color: theme.primary }}
      >
        <span>{label}</span>
        {required ? (
          <span style={{ color: "#ef4444" }}>*</span>
        ) : (
          <span
            className="font-normal normal-case tracking-normal"
            style={{ color: "var(--color-text-muted)" }}
          >
            (optional)
          </span>
        )}
      </div>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={onPick}
          className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
          style={{
            border: url
              ? `2px solid ${theme.primary}`
              : required
                ? `2px solid ${theme.soft}`
                : `2px dashed ${theme.soft}`,
            background: url ? "#000" : "var(--color-bg)",
          }}
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-lg" style={{ color: theme.primary }}>
              {required ? "🖼️" : "+"}
            </span>
          )}
          {url && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              className="absolute top-0 right-0 w-4 h-4 rounded-bl bg-black/70 text-white text-[10px] flex items-center justify-center cursor-pointer"
            >
              ×
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onPick}
          className="px-3 py-1 rounded text-[11px] font-bold whitespace-nowrap self-start"
          style={{
            background: theme.faint,
            border: `1px solid ${theme.primary}`,
            color: theme.primary,
          }}
        >
          Reference
        </button>
      </div>
    </div>
  );
}
