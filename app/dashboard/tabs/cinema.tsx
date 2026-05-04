"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X, Film } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Portal from "../sections/portal";
import { uploadImage, dataUrlToFile } from "@/lib/upload-image";
import { isVisibleAfterTtl, fetchSavedSet } from "@/lib/history-filter";

// Cinema — Grok Imagine via Crun.ai. Two image modes (Text to Video,
// Image to Video), duration slider 6-30s, resolution 480p|720p, mode
// hardcoded "normal", price = duration × admin-set rate per second.

type Status = "idle" | "submitting" | "failed";
type ImageMode = "text" | "image";

const PURPLE = "#7c4dff";
const PURPLE_SOFT = "rgba(124, 77, 255, 0.18)";
const PURPLE_FAINT = "rgba(124, 77, 255, 0.06)";

export default function CinemaTab({ projectId }: { projectId?: string } = {}) {
  const [imageMode, setImageMode] = useState<ImageMode>("text");
  const [refImage, setRefImage] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("9:16");
  // Resolution is hardcoded to 720p — admin/product call. UI dropdown removed
  // intentionally; the value still flows through to the API body so the
  // backend stays unchanged.
  const resolution: "720p" = "720p";
  const [duration, setDuration] = useState(6);
  const [ratePerSec, setRatePerSec] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const refInputRef = useRef<HTMLInputElement | null>(null);

  // Pull admin-configurable rate once on mount so the cost preview stays in
  // sync with /admin → cinema_rate_per_sec without a redeploy.
  useEffect(() => {
    let cancel = false;
    fetch("/api/cinema/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && typeof d?.rate === "number") setRatePerSec(d.rate);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  const cost = ratePerSec != null ? duration * ratePerSec : null;

  // Eager-upload: file pick → instant data: preview → background upload to
  // RunningHub. By submit time, refImage holds the public URL.
  function readFile(f: File | null) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setRefImage(String(reader.result || ""));
      (async () => {
        try {
          const { url } = await uploadImage(f);
          setRefImage(url);
        } catch {
          // Silent — submit's ensurePublicUrl handles retry
        }
      })();
    };
    reader.readAsDataURL(f);
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
    if (imageMode === "image" && !refImage)
      return setError("Upload reference image dulu.");
    setError(null);
    setStatus("submitting");

    try {
      let pubUrl = "";
      if (imageMode === "image" && refImage) {
        pubUrl = await ensurePublicUrl(refImage);
      }
      const r = await fetch("/api/generate/cinema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          image_url: pubUrl,
          duration,
          resolution,
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

  const sectionBg: React.CSSProperties = {
    background:
      "radial-gradient(ellipse 1200px 800px at 50% 0%, #f7f3ff 0%, #fafaf7 40%, #f5f5f0 100%)",
    color: "#1a1a1a",
    boxShadow: "0 0 0 1px rgba(124, 77, 255, 0.08)",
  };

  return (
    <div className="rounded-3xl p-6 md:p-8 space-y-5" style={sectionBg}>
      <Card borderColor={PURPLE}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <Film className="w-5 h-5" style={{ color: PURPLE }} strokeWidth={2.4} />
            <span className="text-[13px] font-extrabold uppercase tracking-[0.06em]">
              Cinema Generator
            </span>
          </div>
          <span
            className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded"
            style={{ background: PURPLE_FAINT, color: PURPLE, border: `1px solid ${PURPLE_SOFT}` }}
          >
            6–30s
          </span>
        </div>

        <Label>Image Mode</Label>
        <Select
          value={imageMode}
          onChange={(v) => setImageMode(v as ImageMode)}
        >
          <option value="text">Text to Video (no image needed)</option>
          <option value="image">Image to Video (animate from image)</option>
        </Select>
      </Card>

      <Card>
        <div className="flex items-center gap-2.5 mb-4">
          <span className="text-lg">🎞️</span>
          <span className="text-[13px] font-extrabold uppercase tracking-[0.06em]">
            Scene
          </span>
        </div>

        {imageMode === "text" && (
          <div
            className="p-3 rounded-lg mb-4 text-center text-xs font-semibold"
            style={{
              background: PURPLE_FAINT,
              border: `1px dashed ${PURPLE_SOFT}`,
              color: PURPLE,
            }}
          >
            📝 Text only — no image needed
          </div>
        )}

        {imageMode === "image" && (
          <div className="mb-4">
            <Label>Reference Image *</Label>
            <input
              ref={refInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => readFile(e.target.files?.[0] || null)}
            />
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => refInputRef.current?.click()}
                className="relative w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
                style={{
                  border: `2px dashed ${refImage ? "transparent" : PURPLE}`,
                  background: refImage ? "#000" : PURPLE_FAINT,
                }}
              >
                {refImage ? (
                  <img src={refImage} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl opacity-75">🖼️</span>
                )}
              </button>
              <div className="flex flex-col gap-1 justify-between">
                <SmallBtn onClick={() => setPickerOpen(true)}>History</SmallBtn>
                <SmallBtn onClick={() => refInputRef.current?.click()}>Upload</SmallBtn>
                <SmallBtn onClick={() => setRefImage("")} danger>
                  x
                </SmallBtn>
              </div>
            </div>
          </div>
        )}

        <Label>Prompt</Label>
        <textarea
          rows={5}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.substring(0, 5000))}
          maxLength={5000}
          placeholder="A cinematic slow-motion shot of…"
          className="w-full p-3.5 rounded-xl text-sm resize-y outline-none"
          style={{
            background: "#fafaf7",
            border: "1px solid #e8e0d8",
            color: "#1a1a1a",
            lineHeight: 1.5,
          }}
        />
        <p className="text-[10px] text-gray-500 mt-2 text-right">
          <span className={prompt.length > 4900 ? "text-red-500 font-bold" : ""}>
            {prompt.length}/5000
          </span>
        </p>
      </Card>

      <Card>
        {/* Duration slider + live cost preview */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <Label>Duration (s)</Label>
            <div className="flex items-center gap-2">
              <span
                className="text-sm font-extrabold"
                style={{ color: PURPLE }}
              >
                {duration}s
              </span>
              {cost != null && (
                <span
                  className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded"
                  style={{
                    background: PURPLE_FAINT,
                    color: PURPLE,
                    border: `1px solid ${PURPLE_SOFT}`,
                  }}
                >
                  ~RM{cost.toFixed(2)}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-gray-500 font-mono">6</span>
            <input
              type="range"
              min={6}
              max={30}
              step={1}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="flex-1 h-2 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, ${PURPLE} 0%, ${PURPLE} ${
                  ((duration - 6) / 24) * 100
                }%, #e8e0d8 ${((duration - 6) / 24) * 100}%, #e8e0d8 100%)`,
              }}
            />
            <span className="text-[10px] text-gray-500 font-mono">30</span>
          </div>
          {ratePerSec != null && (
            <p className="text-[10px] text-gray-500 mt-1.5">
              Rate: RM{ratePerSec.toFixed(2)}/sec · admin-tunable
            </p>
          )}
        </div>

        <div className="mb-4">
          <Label>Size</Label>
          <Select value={aspect} onChange={(v) => setAspect(v)}>
            <option value="9:16">9:16</option>
            <option value="16:9">16:9</option>
          </Select>
        </div>

        <button
          onClick={submit}
          disabled={busy}
          className="w-full py-3.5 rounded-xl font-extrabold text-base text-white transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
          style={{
            background: `linear-gradient(135deg, ${PURPLE} 0%, #b388ff 100%)`,
            boxShadow:
              "0 6px 20px rgba(124,77,255,0.35), inset 0 1px 0 rgba(255,255,255,0.2)",
          }}
        >
          {busy ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Submitting…
            </span>
          ) : (
            <>🎬 Generate Cinema</>
          )}
        </button>

        {error && (
          <div
            className="mt-3 px-4 py-2.5 rounded-lg text-xs font-semibold"
            style={{
              background: "rgba(244,67,54,0.08)",
              border: "1px solid rgba(244,67,54,0.4)",
              color: "#c62828",
            }}
          >
            {error}
          </div>
        )}
      </Card>

      {pickerOpen && (
        <HistoryPicker
          onPick={(url) => {
            setRefImage(url);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* Cinema Agent panel is mounted at dashboard-shell level so it
          persists across tab switches — see DashboardShell. */}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────
function Card({
  children,
  borderColor,
}: {
  children: React.ReactNode;
  borderColor?: string;
}) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: "#ffffff",
        border: `1px solid ${borderColor || "#e8e0d8"}`,
        boxShadow:
          "0 1px 2px rgba(0,0,0,0.03), 0 4px 16px -4px rgba(0,0,0,0.04)",
        ...(borderColor
          ? { borderTopWidth: 3, borderTopColor: borderColor }
          : {}),
      }}
    >
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10px] font-extrabold uppercase tracking-[0.1em] mb-2"
      style={{ color: "#888" }}
    >
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3.5 py-2.5 rounded-lg text-sm font-semibold outline-none"
      style={{
        background: "#fafaf7",
        border: "1px solid #e8e0d8",
        color: "#1a1a1a",
      }}
    >
      {children}
    </select>
  );
}

function SmallBtn({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2 py-1 rounded text-[10px] font-bold"
      style={
        danger
          ? {
              background: "rgba(244,67,54,0.08)",
              border: "1px solid rgba(244,67,54,0.4)",
              color: "#c62828",
            }
          : {
              background: PURPLE_FAINT,
              border: `1px solid ${PURPLE}`,
              color: PURPLE,
            }
      }
    >
      {children}
    </button>
  );
}

function HistoryPicker({
  onPick,
  onClose,
}: {
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<{ id: string; output_url: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const sb = createClient();
      const { data } = await sb
        .from("history")
        .select("id, output_url, created_at")
        .eq("type", "image")
        .eq("status", "done")
        .not("output_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(60);
      const rows = (data as any[]) || [];
      const saved = await fetchSavedSet(rows.map((r: any) => r.id));
      setItems(rows.filter((r: any) => isVisibleAfterTtl(r.created_at, saved.has(r.id))) as any);
    } finally {
      setLoading(false);
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
        className="rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        style={{
          background: "#ffffff",
          border: `2px solid ${PURPLE}`,
          boxShadow: "0 20px 60px rgba(124,77,255,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "#e8e0d8" }}
        >
          <h2 className="font-display font-extrabold text-base" style={{ color: PURPLE }}>
            Pick Reference Image
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-500">
              <Loader2
                className="w-5 h-5 animate-spin inline-block mr-2"
                style={{ color: PURPLE }}
              />
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              Belum ada image dalam history.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => onPick(it.output_url)}
                  className="aspect-square rounded-lg overflow-hidden border-2 transition-all hover:-translate-y-0.5"
                  style={{ borderColor: "#e8e0d8", background: "#fafaf7" }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = PURPLE)}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#e8e0d8")}
                >
                  <img src={it.output_url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    </Portal>
  );
}
