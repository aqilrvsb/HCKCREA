"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X, Pin, Copy, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Portal from "../sections/portal";
import { uploadImage, dataUrlToFile } from "@/lib/upload-image";

// Clone Prompt — input: reference video + product image →
// output: list of segment prompts (no video generation). Two output models:
//   • UGC    → Veo 3.1 (8s segments)
//   • Cinema → Grok Imagine (up to 30s segments)
// Browser extracts up to 60 frames at 1 fps; backend slices them per
// segment and runs parallel vision calls.

type Status = "idle" | "extracting" | "analyzing" | "failed";
type Mode = "ugc" | "cinema";

const RED = "#e60023";
const RED_SOFT = "rgba(230, 0, 35, 0.18)";
const RED_FAINT = "rgba(230, 0, 35, 0.06)";
const ORANGE = "#f59e0b";

const MAX_FRAMES = 60;
const SEG_DUR_UGC = 8;
const SEG_DUR_CINEMA = 30;

export default function CloneTab({ projectId }: { projectId?: string } = {}) {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState("");
  const [videoDuration, setVideoDuration] = useState(0);
  const [productImage, setProductImage] = useState("");
  const [mode, setMode] = useState<Mode>("ugc");
  const [aspect, setAspect] = useState("9:16");
  const [dialog, setDialog] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [resultPrompts, setResultPrompts] = useState<string[]>([]);
  const [resultMode, setResultMode] = useState<Mode>("ugc");
  const [resultSegDur, setResultSegDur] = useState(8);
  const [showHistoryPicker, setShowHistoryPicker] = useState(false);

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const productInputRef = useRef<HTMLInputElement | null>(null);

  function pushLog(line: string) {
    setLog((prev) => [
      ...prev,
      `${new Date().toLocaleTimeString("ms-MY", { hour: "numeric", minute: "numeric", second: "numeric" })} · ${line}`,
    ]);
  }

  function onVideoFile(f: File | null) {
    if (!f) return;
    // Revoke the previous preview URL (if any) before swapping in a new
    // one. Don't revoke this new URL until the next swap — the <video>
    // element in the preview keeps using it for playback.
    setVideoPreviewUrl((old) => {
      if (old) {
        try {
          URL.revokeObjectURL(old);
        } catch {}
      }
      return URL.createObjectURL(f);
    });
    setVideoFile(f);
    // Read duration via a separate hidden element so we don't disturb the
    // preview's URL lifetime.
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      setVideoDuration(Math.floor(probe.duration));
      try { URL.revokeObjectURL(probe.src); } catch {}
    };
    probe.src = URL.createObjectURL(f);
  }

  function onProductFile(f: File | null) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setProductImage(String(reader.result || ""));
    reader.readAsDataURL(f);
  }

  async function ensurePublicUrl(v: string): Promise<string> {
    if (!v) return "";
    if (!v.startsWith("data:")) return v;
    const file = await dataUrlToFile(v, "ref.png");
    const { url } = await uploadImage(file);
    return url;
  }

  async function extractFrames(file: File, count: number): Promise<string[]> {
    const url = URL.createObjectURL(file);
    const frames: string[] = [];
    for (let i = 0; i < count; i++) {
      const ts = i + 0.2;
      const frame = await new Promise<string | null>((resolve) => {
        const v = document.createElement("video");
        v.crossOrigin = "anonymous";
        v.muted = true;
        v.preload = "auto";
        v.onloadedmetadata = () => {
          v.currentTime = Math.min(ts, v.duration - 0.5);
        };
        v.onseeked = () => {
          try {
            const c = document.createElement("canvas");
            c.width = v.videoWidth;
            c.height = v.videoHeight;
            c.getContext("2d")!.drawImage(v, 0, 0);
            resolve(c.toDataURL("image/jpeg", 0.7));
          } catch {
            resolve(null);
          }
          v.remove();
        };
        v.onerror = () => {
          resolve(null);
          v.remove();
        };
        setTimeout(() => {
          resolve(null);
          v.remove();
        }, 8000);
        v.src = url;
      });
      if (frame) frames.push(frame);
    }
    URL.revokeObjectURL(url);
    return frames;
  }

  async function submit() {
    if (!videoFile) {
      setError("Upload a reference video first.");
      return;
    }
    if (videoDuration < 3) {
      setError("Video too short (need at least 3s).");
      return;
    }
    setError(null);
    setStatus("extracting");
    setLog([]);
    setResultPrompts([]);

    const frameCount = Math.min(MAX_FRAMES, Math.max(2, videoDuration));
    const segDur = mode === "cinema" ? SEG_DUR_CINEMA : SEG_DUR_UGC;
    const segCount = Math.ceil(frameCount / (mode === "cinema" ? 30 : 8));

    pushLog(`Extracting ${frameCount} frames (1 fps)…`);
    pushLog(`Mode: ${mode === "cinema" ? "Cinema (Grok Imagine)" : "UGC (Veo 3.1)"}`);
    pushLog(`Will plan ${segCount} segment(s) in parallel.`);

    try {
      const frames = await extractFrames(videoFile, frameCount);
      pushLog(`${frames.length} frames extracted ✓`);

      setStatus("analyzing");
      let productPub = "";
      if (productImage) {
        if (productImage.startsWith("data:")) {
          pushLog("Uploading product reference to RunningHub…");
          productPub = await ensurePublicUrl(productImage);
          pushLog("Product uploaded ✓");
        } else {
          productPub = productImage;
        }
      }

      pushLog(`Submitting ${segCount} segment(s) — vision calls run in background.`);
      const r = await fetch("/api/generate/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frames,
          product_image_url: productPub,
          custom_dialog: dialog,
          duration: videoDuration,
          mode,
          aspect_ratio: aspect,
          project_id: projectId,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        pushLog(`✗ ${d?.error || "Failed"}`);
        setError(d?.error || "Failed to submit");
        setStatus("failed");
        return;
      }
      pushLog(`✓ Cloning ${segCount} segment(s) in background — appears in History below when ready.`);
      // Background placeholder is in History grid below — refresh it.
      window.dispatchEvent(new CustomEvent("history:refresh"));
      setStatus("idle");
    } catch (e: any) {
      pushLog(`✗ ${e?.message || "Network error"}`);
      setError(e?.message || "Network error");
      setStatus("failed");
    }
  }

  const busy = status === "extracting" || status === "analyzing";

  const sectionBg: React.CSSProperties = {
    background:
      "radial-gradient(ellipse 1200px 800px at 50% 0%, #fff5f6 0%, #fafaf7 40%, #f5f5f0 100%)",
    color: "#1a1a1a",
    boxShadow: "0 0 0 1px rgba(230, 0, 35, 0.08)",
  };

  return (
    <div className="rounded-3xl p-6 md:p-8 space-y-5" style={sectionBg}>
      <Card borderColor={RED}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <Pin className="w-5 h-5" style={{ color: RED }} strokeWidth={2.4} />
            <span className="text-[13px] font-extrabold uppercase tracking-[0.06em]">
              Clone Prompt
            </span>
          </div>
          <span
            className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded"
            style={{ background: RED_FAINT, color: RED, border: `1px solid ${RED_SOFT}` }}
          >
            Frames → AI → Prompt(s)
          </span>
        </div>

        {/* Upload reference video */}
        <Label>Upload Reference Video</Label>
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => onVideoFile(e.target.files?.[0] || null)}
        />
        <button
          type="button"
          onClick={() => videoInputRef.current?.click()}
          className="w-full h-20 rounded-xl flex items-center justify-center cursor-pointer transition-all hover:-translate-y-0.5 mb-1 overflow-hidden"
          style={{
            border: `2px dashed ${RED_SOFT}`,
            background: videoPreviewUrl ? "#000" : RED_FAINT,
          }}
        >
          {videoPreviewUrl ? (
            <video
              src={videoPreviewUrl + "#t=1"}
              muted
              preload="metadata"
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-sm font-semibold" style={{ color: RED }}>
              🎬 Click or drop video
            </span>
          )}
        </button>
        {videoDuration > 0 && (
          <div className="text-[10px] text-gray-500 mb-3">
            {videoDuration}s detected · will sample{" "}
            {Math.min(MAX_FRAMES, videoDuration)} frames (max {MAX_FRAMES})
          </div>
        )}

        {/* Mode + Size */}
        <div className="flex items-center gap-4 mb-4">
          <div>
            <Label>Output</Label>
            <Select value={mode} onChange={(v) => setMode(v as Mode)} width={150}>
              <option value="ugc">UGC</option>
              <option value="cinema">Cinema</option>
            </Select>
          </div>
          <div>
            <Label>Size</Label>
            <Select value={aspect} onChange={(v) => setAspect(v)} width={100}>
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
            </Select>
          </div>
        </div>

        {/* Dialog */}
        <Label>
          Dialog{" "}
          <span className="text-gray-400 font-normal normal-case tracking-normal">
            (optional — leave empty to follow reference exactly)
          </span>
        </Label>
        <textarea
          rows={5}
          value={dialog}
          onChange={(e) => setDialog(e.target.value)}
          placeholder={`Use timestamps for exact timing (recommended):\n0s-4s Okey real talk, dendeng ni memang hits different\n4s-8s aku tak boleh stop makan\n8s-12s korang tunggu apa lagi\n12s-16s tekan je beg kuning dekat bawah tu\n\nOr just free-form text — AI will split it across segments.`}
          className="w-full p-3 rounded-xl text-sm resize-y outline-none mb-4"
          style={{
            background: "#fafaf7",
            border: "1px solid #e8e0d8",
            color: "#1a1a1a",
          }}
        />

        <button
          onClick={submit}
          disabled={busy}
          className="w-full py-3.5 rounded-xl font-extrabold text-base text-white transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
          style={{
            background: `linear-gradient(135deg, ${RED} 0%, #ff4444 100%)`,
            boxShadow: "0 6px 20px rgba(230,0,35,0.35), inset 0 1px 0 rgba(255,255,255,0.2)",
          }}
        >
          {busy ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {status === "extracting" ? "Extracting frames…" : "Analyzing…"}
            </span>
          ) : (
            <>📋 Generate Prompt</>
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

      {/* Result prompts */}
      {resultPrompts.length > 0 && (
        <Card>
          <div className="flex items-center gap-2.5 mb-3">
            <span className="text-lg">✨</span>
            <span className="text-[13px] font-extrabold uppercase tracking-[0.06em]">
              Generated Prompts
            </span>
            <span
              className="ml-auto text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded"
              style={{ background: RED_FAINT, color: RED }}
            >
              {resultPrompts.length} ×{" "}
              {resultMode === "cinema" ? "Cinema" : "UGC"} {resultSegDur}s
            </span>
          </div>
          <div className="space-y-3">
            {resultPrompts.map((p, i) => (
              <PromptCard
                key={i}
                idx={i}
                prompt={p}
                segDur={resultSegDur}
                mode={resultMode}
              />
            ))}
          </div>
        </Card>
      )}

      {showHistoryPicker && (
        <HistoryPicker
          onPick={(url) => {
            setProductImage(url);
            setShowHistoryPicker(false);
          }}
          onClose={() => setShowHistoryPicker(false)}
        />
      )}
    </div>
  );
}

// ── PromptCard with copy + send-to-Video ────────────────────────────────
function PromptCard({
  idx,
  prompt,
  segDur,
  mode,
}: {
  idx: number;
  prompt: string;
  segDur: number;
  mode: Mode;
}) {
  const [copied, setCopied] = useState(false);
  const startSec = idx * segDur;
  const endSec = startSec + segDur;

  async function copy() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function sendToVideo() {
    // Reuses the UGC handoff event the Video tab already listens for.
    window.dispatchEvent(new CustomEvent("ugc:hand-off", { detail: prompt }));
  }

  return (
    <div
      className="rounded-xl p-3"
      style={{ background: "#fafaf7", border: "1px solid #e8e0d8" }}
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[10px] font-mono uppercase tracking-wider font-bold px-2 py-1 rounded"
          style={{ background: RED_FAINT, color: RED }}
        >
          Segment {idx + 1} · {startSec}-{endSec}s
        </span>
        <div className="flex items-center gap-1.5">
          {mode === "ugc" && (
            <button
              type="button"
              onClick={sendToVideo}
              className="px-2.5 py-1 rounded-md text-[10px] font-bold transition-transform hover:scale-105"
              style={{
                background: "linear-gradient(135deg, #facc15, #fde047)",
                color: "white",
                boxShadow: "0 2px 6px rgba(255,87,34,0.3)",
              }}
            >
              → Use in Video
            </button>
          )}
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold"
            style={{
              background: copied ? "rgba(34,197,94,0.1)" : "#f0f5ec",
              border: `1px solid ${copied ? "#22c55e" : "#d8e8d0"}`,
              color: copied ? "#22c55e" : "#1a1a1a",
            }}
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre
        className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap rounded p-2.5 max-h-72 overflow-y-auto"
        style={{ background: "#fff", border: "1px solid #e8e0d8", color: "#1a1a1a" }}
      >
        {prompt}
      </pre>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
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
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3.5 py-2.5 rounded-lg text-sm font-semibold outline-none"
      style={{
        width: width ? `${width}px` : "100%",
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
  color,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  color?: string;
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
              background: `${color || RED}10`,
              border: `1px solid ${color || RED}`,
              color: color || RED,
            }
      }
    >
      {children}
    </button>
  );
}

// ── History Picker ──────────────────────────────────────────────────────
function HistoryPicker({
  onPick,
  onClose,
}: {
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<
    { id: string; output_url: string }[]
  >([]);
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
        .select("id, output_url")
        .eq("type", "image")
        .eq("status", "done")
        .not("output_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(60);
      setItems((data as any) || []);
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
          border: `2px solid ${RED}`,
          boxShadow: "0 20px 60px rgba(230,0,35,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "#e8e0d8" }}
        >
          <h2 className="font-display font-extrabold text-base" style={{ color: RED }}>
            Pick Product Image from History
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
              <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" style={{ color: RED }} />
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
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = RED)}
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
