"use client";

// Seedance tab — manual generation only (no AI agent).
//
// Shipped as the user-facing "Cinema" tab (the previous Cinema tab is
// renamed to "Story"). Uses Bytedance's Seedance 2.0 Fast — admin
// rotates the backend (P1 GeminiGen / P2 Crun.ai) via app_settings.
//
// Two modes, auto-routed by ref presence:
//   - Text → video      (no refs uploaded)
//   - Reference → video (any image / video / audio uploaded)
//
// Audio is always on (Seedance natively generates synced audio). No
// toggle in the UI per the design choice.

import { useEffect, useState } from "react";
import { Loader2, X, Image as ImageIcon, Info } from "lucide-react";
import AttachmentPicker from "../sections/attachment-picker";

const MAX_REF_IMAGES = 4;
const MAX_REF_VIDEOS = 3;
const MAX_REF_AUDIOS = 3;
const ASPECT_OPTIONS = [
  { val: "9:16", label: "9:16 (Portrait)" },
  { val: "16:9", label: "16:9 (Landscape)" },
];

export default function SeedanceTab({ projectId }: { projectId: string }) {
  const [prompt, setPrompt] = useState("");
  const [tipOpen, setTipOpen] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [videoUrls, setVideoUrls] = useState<string[]>([]);
  const [audioUrls, setAudioUrls] = useState<string[]>([]);
  const [aspect, setAspect] = useState("9:16");
  const [duration, setDuration] = useState(8);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ratePerSec, setRatePerSec] = useState<number | null>(null);

  // Pull the seedance per-second rate so the user sees the cost before firing.
  // The same setting is used server-side to deduct credits.
  useEffect(() => {
    let alive = true;
    fetch("/api/seedance/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const rps = Number(d?.per_second);
        if (Number.isFinite(rps) && rps > 0) setRatePerSec(rps);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const cost = ratePerSec != null ? duration * ratePerSec : null;
  const hasRefs =
    imageUrls.length > 0 || videoUrls.length > 0 || audioUrls.length > 0;
  const mode = hasRefs ? "Reference → Video" : "Text → Video";

  // ─────────── Upload handlers ───────────

  // Generic uploader used for image / video / audio. Routes to the right
  // /api/upload/{kind} endpoint, all of which proxy to RunningHub binary
  // upload and return a public download URL.
  async function uploadFile(
    file: File,
    kind: "image" | "video" | "audio",
    onUrl: (url: string) => void
  ) {
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name || `ref.${kind}`);
      const r = await fetch(`/api/upload/${kind}`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok || !d?.url) throw new Error(d?.error || "Upload failed");
      onUrl(d.url);
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
    }
  }

  function uploadImage(file: File) {
    if (imageUrls.length >= MAX_REF_IMAGES) {
      setErr(`Max ${MAX_REF_IMAGES} reference images.`);
      return;
    }
    void uploadFile(file, "image", (url) =>
      setImageUrls((prev) => [...prev, url])
    );
  }
  function uploadVideo(file: File) {
    if (videoUrls.length >= MAX_REF_VIDEOS) {
      setErr(`Max ${MAX_REF_VIDEOS} reference videos.`);
      return;
    }
    void uploadFile(file, "video", (url) =>
      setVideoUrls((prev) => [...prev, url])
    );
  }
  function uploadAudio(file: File) {
    if (audioUrls.length >= MAX_REF_AUDIOS) {
      setErr(`Max ${MAX_REF_AUDIOS} reference audios.`);
      return;
    }
    void uploadFile(file, "audio", (url) =>
      setAudioUrls((prev) => [...prev, url])
    );
  }

  // Pick a past video from history as a reference. Lazy-loads on open.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState<Array<{ id: string; output_url: string; thumbnail_url?: string | null; tab?: string | null; prompt?: string | null }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function openHistoryPicker() {
    setHistoryOpen(true);
    if (historyRows.length > 0) return;
    setHistoryLoading(true);
    try {
      const r = await fetch("/api/history?type=video&status=done&limit=60", { cache: "no-store" });
      const d = await r.json();
      const rows = Array.isArray(d?.rows) ? d.rows : Array.isArray(d) ? d : [];
      setHistoryRows(rows.filter((x: any) => !!x?.output_url));
    } catch {
      // Silent — user can still upload local
    } finally {
      setHistoryLoading(false);
    }
  }

  function pickFromHistory(url: string) {
    if (videoUrls.length >= MAX_REF_VIDEOS) {
      setErr(`Max ${MAX_REF_VIDEOS} reference videos.`);
      return;
    }
    setVideoUrls((prev) => [...prev, url]);
    setHistoryOpen(false);
  }

  // ─────────── Submit ───────────

  async function submit() {
    if (!prompt.trim()) {
      setErr("Sila masukkan prompt.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch("/api/generate/seedance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          image_urls: imageUrls,
          video_urls: videoUrls,
          audio_urls: audioUrls,
          aspect_ratio: aspect,
          duration,
          project_id: projectId,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Generation failed");
      // Trigger history refresh so the placeholder appears immediately.
      // Event name MUST match history-grid.tsx's listener: "history:refresh".
      // Previous code dispatched "pl-history-refresh" which the grid
      // ignored, so cinema tab generations never showed a pending card
      // until the next 15s poll tick.
      window.dispatchEvent(new CustomEvent("history:refresh"));
      setPrompt("");
      setImageUrls([]);
      setVideoUrls([]);
      setAudioUrls([]);
    } catch (e: any) {
      setErr(e?.message || "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  // ─────────── UI ───────────

  return (
    <div className="space-y-4">
      {/* Mode pill + face-block tip */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-display font-extrabold text-lg tracking-tight">
            Cinema · <span className="text-orange">Seedance 2.0</span>
          </h2>
          <button
            type="button"
            onClick={() => setTipOpen(true)}
            title="Face-block bypass tip"
            aria-label="Face-block bypass tip"
            className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[var(--color-text-muted)] hover:text-orange hover:bg-orange-50/30 transition"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
        <span className="text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold">
          {mode}
        </span>
      </div>

      {/* Face-block bypass tip — pops on Info icon click */}
      {tipOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setTipOpen(false)}
        >
          <div
            className="bg-[#0d0d0d] border border-[var(--color-border)] rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-[var(--color-border)] flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-orange" />
                  <h3 className="font-display font-extrabold text-base">
                    Face-block bypass — Canva trick
                  </h3>
                </div>
                <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                  Use this when Seedance refuses to render a real face.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTipOpen(false)}
                className="text-[var(--color-text-muted)] hover:text-white shrink-0"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              <p>
                <span className="font-bold text-white">Most people give up</span>{" "}
                when Seedance blocks their face. But there is a smarter way.
              </p>
              <ol className="space-y-2 list-decimal list-inside marker:text-orange marker:font-extrabold">
                <li>
                  Open <span className="font-bold text-white">Canva</span> (free)
                </li>
                <li>Upload your photo</li>
                <li>
                  Draw a big{" "}
                  <span className="font-bold text-red-500">RED X</span> across
                  your face{" "}
                  <span className="text-[var(--color-text-muted)] text-xs">
                    (make sure it covers at least one eye)
                  </span>
                </li>
                <li>
                  Add text at the top:{" "}
                  <span className="font-mono font-bold text-white">
                    "CHARACTER REFERENCE SHEET"
                  </span>
                </li>
                <li>Download it</li>
                <li>
                  Upload to Seedance 2.0 as your reference image
                </li>
              </ol>
              <p className="text-[var(--color-text-muted)] text-xs italic pt-2">
                Done. The face detector gets confused. Your character data stays
                intact. Your video generates normally.
              </p>
              <a
                href="https://www.facebook.com/reel/1907392529914647/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 mt-2 text-xs font-bold text-orange hover:underline"
              >
                Watch the demo reel
                <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Prompt */}
      <div>
        <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-2">
          Prompt
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          maxLength={5000}
          placeholder="Describe the scene — characters, actions, camera movement, lighting, mood. Long descriptive prompts (200-500 words) work best for Seedance."
          className="input w-full font-mono text-sm leading-relaxed"
        />
        <div className="text-[10px] text-[var(--color-text-muted)] mt-1 text-right">
          {prompt.length} / 5000
        </div>
      </div>

      {/* Reference images */}
      <div>
        <label className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-2">
          <ImageIcon className="w-3.5 h-3.5" />
          Reference Images <span className="text-[10px] font-normal">(up to {MAX_REF_IMAGES})</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {imageUrls.map((u, i) => (
            <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-[var(--color-border)]">
              <img src={u} alt="" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => setImageUrls((p) => p.filter((_, j) => j !== i))}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-red-500"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {imageUrls.length < MAX_REF_IMAGES && (
            <button
              type="button"
              onClick={() => setAttachmentOpen(true)}
              className="w-20 h-20 rounded-lg border-2 border-dashed border-[var(--color-border)] flex items-center justify-center cursor-pointer hover:border-orange-400"
            >
              <span className="text-2xl text-[var(--color-text-muted)]">+</span>
            </button>
          )}
        </div>
      </div>

      {/* Reference Videos + Reference Audios — hidden for now. Backend
          + upload endpoints stay in place; re-enable by removing the
          `false &&` guard once the user is ready to expose them. */}
      {false && (
        <div className="hidden" aria-hidden="true">
          {/* placeholder — see git history (commit d9b007d) for the
              video + audio upload UI when re-enabling */}
        </div>
      )}

      {/* History picker modal */}
      {historyOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setHistoryOpen(false)}
        >
          <div
            className="bg-[var(--color-bg,#0d0d0d)] border border-[var(--color-border)] rounded-xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
              <h3 className="font-display font-extrabold text-base">Pick a video from your history</h3>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="text-[var(--color-text-muted)] hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {historyLoading ? (
                <div className="flex items-center justify-center py-12 text-[var(--color-text-muted)] text-sm">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
                </div>
              ) : historyRows.length === 0 ? (
                <div className="text-center py-12 text-[var(--color-text-muted)] text-sm">
                  No past videos yet — upload a local file instead.
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {historyRows.map((r) => (
                    <button
                      type="button"
                      key={r.id}
                      onClick={() => pickFromHistory(r.output_url)}
                      className="relative aspect-[9/16] rounded-lg overflow-hidden border border-[var(--color-border)] bg-black hover:border-orange transition"
                    >
                      <video
                        src={r.output_url + "#t=0.5"}
                        muted
                        preload="metadata"
                        className="w-full h-full object-cover pointer-events-none"
                      />
                      {r.tab && (
                        <span className="absolute top-1 left-1 text-[9px] font-bold uppercase bg-black/70 text-white px-1.5 py-0.5 rounded">
                          {r.tab}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <AttachmentPicker
        open={attachmentOpen}
        onClose={() => setAttachmentOpen(false)}
        onPick={(a) => {
          setImageUrls((prev) => (prev.length < MAX_REF_IMAGES ? [...prev, a.public_url] : prev));
          setAttachmentOpen(false);
        }}
      />

      {/* Aspect + duration */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-2">
            Aspect Ratio
          </label>
          <select
            value={aspect}
            onChange={(e) => setAspect(e.target.value)}
            className="input"
          >
            {ASPECT_OPTIONS.map((a) => (
              <option key={a.val} value={a.val}>{a.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-2">
            Duration · {duration}s
          </label>
          <input
            type="range"
            min={8}
            max={15}
            step={1}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full"
          />
        </div>
      </div>

      {/* Cost + submit */}
      <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
        <div className="text-xs font-mono">
          {cost != null ? (
            <>
              <span className="text-[var(--color-text-muted)] uppercase tracking-wider font-bold">Cost</span>
              <span className="ml-2 text-orange font-extrabold">RM {cost.toFixed(2)}</span>
              <span className="ml-1 text-[var(--color-text-muted)]">({duration}s × RM{ratePerSec?.toFixed(3)})</span>
            </>
          ) : (
            <span className="text-[var(--color-text-muted)]">Loading rate…</span>
          )}
        </div>
        <button
          type="button"
          disabled={busy || !prompt.trim()}
          onClick={submit}
          className="px-5 py-2.5 rounded-xl font-bold text-sm bg-orange text-black hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          Generate
        </button>
      </div>

      {err && (
        <div className="text-xs text-red-400 bg-red-50/5 border border-red-200/20 rounded-md px-3 py-2">
          {err}
        </div>
      )}
    </div>
  );
}
