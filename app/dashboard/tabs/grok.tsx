"use client";

import { useEffect, useState } from "react";
import { Loader2, X, Zap, Info } from "lucide-react";
import Portal from "../sections/portal";
import { uploadImage, dataUrlToFile } from "@/lib/upload-image";
import AttachmentPicker from "../sections/attachment-picker";

// Grok Imagine 1.5 Preview tab — replaces legacy Grok Imagine (t2v/i2v)
// entirely per user direction 2026-06-08. APIPod model:
// grok-imagine-1.5-preview. Single image_url MANDATORY (string, not
// array). No text-only mode. Posts to /api/generate/cinema with
// model='grok' which routes through the p6 (APIPod) cascade.
//
// API constraints (per APIPod grok-imagine-1.5-preview spec):
//   - image_url: REQUIRED, single reference image only
//   - aspect_ratio: 1:1 / 2:3 / 3:2 / 9:16 / 16:9 (5 options)
//   - duration: 1-15 (default 10), per-second pricing
//   - resolution: fixed 720p

type Status = "idle" | "submitting" | "failed";
type Aspect = "9:16" | "16:9" | "1:1" | "2:3" | "3:2";

const ORANGE = "#f97316";
const ORANGE_SOFT = "rgba(249, 115, 22, 0.18)";
const ORANGE_FAINT = "rgba(249, 115, 22, 0.06)";

export default function GrokTab({ projectId }: { projectId?: string } = {}) {
  const [refUrl, setRefUrl] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<Aspect>("9:16");
  // 1.5 Preview supports 1-15s. Default 10 per APIPod spec.
  const [duration, setDuration] = useState<number>(10);
  const [ratePerSec, setRatePerSec] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pickingSlot, setPickingSlot] = useState<boolean>(false);

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
    if (!refUrl) return setError("Reference image is required for Grok 1.5 Preview.");
    setError(null);
    setStatus("submitting");
    try {
      const pubUrl = await ensurePublicUrl(refUrl);
      const r = await fetch("/api/generate/cinema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          image_url: pubUrl,
          image_urls: [pubUrl],
          duration,
          resolution: "720p",
          aspect_ratio: aspect,
          image_mode: "image",
          model: "grok",
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
            Grok Imagine 1.5 Preview
          </h2>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mb-4">
          xAI Grok Imagine 1.5 · 1–15s · 720p · 5 aspect ratios. Image-to-video
          only (single reference image required). Fluid cinematic motion,
          faithful to source image.
        </p>

        {/* Single reference image — MANDATORY per APIPod spec */}
        <div className="mb-4">
          <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
            Reference image (required)
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
                  alt="Reference image"
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => setRefUrl("")}
                  title="Clear reference"
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
                <span>Reference</span>
              </button>
            )}
          </div>
          <div
            className="mt-2 flex items-start gap-2 px-3 py-2 rounded-lg text-[10px]"
            style={{
              background: ORANGE_FAINT,
              border: `1px solid ${ORANGE_SOFT}`,
              color: "var(--color-text-secondary)",
            }}
          >
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: ORANGE }} />
            <div>
              <div className="font-bold mb-0.5" style={{ color: ORANGE }}>
                1.5 Preview image rules
              </div>
              Single image only. The model animates THIS image — describe the
              motion / camera move in the prompt below.
            </div>
          </div>
        </div>

        {/* Prompt */}
        <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
          Prompt
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, 4000))}
          maxLength={4000}
          rows={4}
          placeholder="Describe the motion — camera moves, atmosphere, action, physics…"
          className="w-full px-3 py-2 rounded-lg text-sm mb-1"
          style={{
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
        <div className="text-[10px] text-gray-400 mt-1 text-right mb-3">
          {prompt.length}/4000
        </div>

        {/* Aspect + Duration */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
              Aspect ratio
            </label>
            <select
              value={aspect}
              onChange={(e) => setAspect(e.target.value as Aspect)}
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
              min={1}
              max={15}
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
            `⚡ Generate Grok 1.5 Video${estCost ? ` · ~RM${estCost}` : ""}`
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
    </div>
  );
}
