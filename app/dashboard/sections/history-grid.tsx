"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  History,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Plus,
  Download,
  Trash2,
  Pencil,
  RotateCw,
  X,
  Copy,
  Palette,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export type HistoryItem = {
  id: string;
  type: string;
  tab: string;
  status: string;
  prompt: string | null;
  output_url: string | null;
  thumbnail_url: string | null;
  reference_url: string | null;
  duration: number | null;
  framework: string | null;
  caption: string | null;
  cost: number;
  task_id: string | null;
  error_message: string | null;
  created_at: string;
  metadata?: { model?: string; name?: string; [k: string]: any } | null;
};

// Pretty model name for the badge under each card
function modelLabel(item: HistoryItem): string {
  const m = item.metadata?.model || "";
  if (m.includes("nano-banana") || m === "nano-banana-pro") return "Banana Pro";
  if (m.includes("gpt-image") || m === "gpt-image-2") return "GPT Image 2";
  if (m.includes("veo3-1-fast")) return "Veo 3.1 Fast";
  if (m.includes("veo")) return "Veo 3.1";
  return item.type;
}

// Reusable "history below the form" grid. Loads + auto-polls rows for one tab.
// Used by Image, Video, Clone, Auto Content sections.
export default function HistoryGrid({
  tab,
  title,
  projectId,
}: {
  tab: "image" | "video" | "clone" | "auto";
  title: string;
  projectId?: string;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 12;

  useEffect(() => {
    void load();
    setPage(0);
    // Only refresh on explicit dispatch (webhook completes → user clicks
    // per-card refresh icon → user re-enters tab). No background polling.
    const onRefresh = () => load();
    window.addEventListener("history:refresh", onRefresh);
    return () => window.removeEventListener("history:refresh", onRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, projectId]);

  async function load() {
    setLoading(true);
    try {
      const sb = createClient();
      let q = sb
        .from("history")
        .select("*")
        .eq("tab", tab)
        .order("created_at", { ascending: false })
        .limit(60);
      if (projectId) q = q.eq("project_id", projectId);
      const { data } = await q;
      setItems((data as HistoryItem[]) || []);
    } finally {
      setLoading(false);
    }
  }

  const counts = useMemo(
    () => ({
      total: items.length,
      pending: items.filter((i) => i.status === "pending").length,
    }),
    [items]
  );

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  // Clamp page if items shrink (e.g. after delete) so we never show empty page.
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <section className="card">
      <div className="flex items-center justify-between mb-5 pb-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-[var(--color-text-muted)]" />
          <h2 className="font-display font-bold text-xl text-[var(--color-text-primary)]">
            History — {title}
          </h2>
        </div>
        <span className="text-xs text-[var(--color-text-muted)] font-mono">
          {counts.total} items
        </span>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-16">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
            }}
          >
            <History className="w-7 h-7 text-[var(--color-text-muted)]" />
          </div>
          <p className="text-[var(--color-text-secondary)] font-medium mb-1">
            {loading ? "Loading…" : "Belum ada history."}
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">
            Generate satu, ia akan muncul di sini.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {pageItems.map((it) => (
              <HistoryCard key={it.id} item={it} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-5 pt-4 border-t border-[var(--color-border)]">
              <button
                onClick={() => setPage(Math.max(0, safePage - 1))}
                disabled={safePage === 0}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold disabled:opacity-30 transition"
                style={{
                  background: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {Array.from({ length: totalPages }).map((_, i) => {
                const isActive = i === safePage;
                return (
                  <button
                    key={i}
                    onClick={() => setPage(i)}
                    className="min-w-[36px] h-9 px-3 rounded-lg text-xs font-bold transition"
                    style={
                      isActive
                        ? {
                            background:
                              "linear-gradient(135deg, #ff6a1a 0%, #ff4d00 100%)",
                            color: "white",
                            boxShadow: "0 4px 12px rgba(255,87,34,0.3)",
                          }
                        : {
                            background: "var(--color-bg-card)",
                            border: "1px solid var(--color-border)",
                            color: "var(--color-text-secondary)",
                          }
                    }
                  >
                    {i + 1}
                  </button>
                );
              })}

              <button
                onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
                disabled={safePage >= totalPages - 1}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold disabled:opacity-30 transition"
                style={{
                  background: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// Extension's gradient palette — same colors per action, used everywhere
const ACTION = {
  edit: "linear-gradient(135deg, #7c4dff, #b388ff)",       // purple — edit/improve
  extend: "linear-gradient(135deg, #f59e0b, #fbbf24)",     // amber — extend +8s
  download: "linear-gradient(135deg, #3b82f6, #60a5fa)",   // blue — download
  delete: "linear-gradient(135deg, #ef4444, #f87171)",     // red — delete
  retry: "linear-gradient(135deg, #22c55e, #4ade80)",      // green — retry failed
};

function HistoryCard({ item }: { item: HistoryItem }) {
  const [extending, setExtending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(item.metadata?.name || "");
  const [editingName, setEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const isVideo = item.type === "video" || item.type === "auto-content" || item.type === "clone";
  const isImage = item.type === "image";
  const canExtend = isVideo && item.status === "done" && item.output_url;

  async function extend() {
    setExtending(true);
    try {
      const r = await fetch("/api/generate/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent_id: item.id }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        alert(d?.error || "Extend failed");
      } else {
        window.dispatchEvent(new CustomEvent("history:refresh"));
      }
    } finally {
      setExtending(false);
    }
  }

  async function checkNow() {
    setChecking(true);
    try {
      await fetch(`/api/generate/status?id=${item.id}`, { cache: "no-store" });
      window.dispatchEvent(new CustomEvent("history:refresh"));
    } finally {
      setChecking(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Padam item ni?")) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/history/delete?id=${item.id}`, { method: "DELETE" });
      if (r.ok) {
        window.dispatchEvent(new CustomEvent("history:refresh"));
      } else {
        alert("Delete failed");
        setDeleting(false);
      }
    } catch {
      setDeleting(false);
    }
  }

  function handleDownload() {
    if (!item.output_url) return;
    const safeName = (name || `${item.type}-${item.id.substring(0, 8)}`)
      .replace(/[^a-z0-9_\-]/gi, "_")
      .substring(0, 60);
    const a = document.createElement("a");
    a.href = item.output_url;
    a.download = `${safeName}.${isVideo ? "mp4" : "png"}`;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function saveName() {
    setSavingName(true);
    try {
      await fetch(`/api/history/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, name: name.trim() }),
      });
      setEditingName(false);
      window.dispatchEvent(new CustomEvent("history:refresh"));
    } finally {
      setSavingName(false);
    }
  }

  async function handleRetry() {
    if (!item.prompt) {
      alert("Tiada prompt asal — sila gunakan form untuk re-generate.");
      return;
    }
    setChecking(true);
    try {
      const endpoint = isImage ? "/api/generate/image" : "/api/generate/video";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: item.prompt,
          reference_url: item.reference_url || undefined,
          duration: item.duration || 8,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        alert(d?.error || "Retry failed");
      } else {
        window.dispatchEvent(new CustomEvent("history:refresh"));
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <div
      className="rounded-xl overflow-hidden border"
      style={{
        background: "var(--color-bg-card)",
        borderColor: "var(--color-border)",
      }}
    >
      <div className="aspect-[9/16] bg-black relative">
        {item.status === "pending" && (
          <>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-amber-400 text-xs font-bold gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Generating…</span>
            </div>
            <button
              onClick={checkNow}
              disabled={checking}
              title="Check status now"
              className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-50 transition"
              style={{
                background: "rgba(20,20,20,0.85)",
                border: "1px solid var(--color-border)",
                backdropFilter: "blur(8px)",
                color: "var(--color-text-primary)",
              }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} />
            </button>
          </>
        )}
        {item.status === "failed" && (
          <>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 text-xs font-bold gap-2 px-3 text-center">
              <XCircle className="w-5 h-5" />
              <span className="line-clamp-2">{item.error_message || "Failed"}</span>
            </div>
            <button
              onClick={checkNow}
              disabled={checking}
              title="Re-check"
              className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-50 transition"
              style={{
                background: "rgba(20,20,20,0.85)",
                border: "1px solid rgba(239,68,68,0.4)",
                backdropFilter: "blur(8px)",
                color: "#fca5a5",
              }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} />
            </button>
          </>
        )}
        {item.status === "done" && item.output_url && (
          <>
            {isImage && (
              <img
                src={item.output_url}
                alt=""
                className="w-full h-full object-cover cursor-pointer"
                onClick={() => setShowFullscreen(true)}
              />
            )}
            {isVideo && (
              <video
                src={item.output_url + "#t=0.5"}
                preload="metadata"
                muted
                playsInline
                className="w-full h-full object-cover cursor-pointer"
                onClick={() => setShowFullscreen(true)}
              />
            )}
          </>
        )}
      </div>

      <div className="p-2.5">
        {/* Status + model badge (replaces RM cost) */}
        <div className="flex items-center gap-1.5 mb-1.5">
          {item.status === "done" && <CheckCircle2 className="w-3 h-3" style={{ color: "var(--color-lime)" }} />}
          {item.status === "pending" && <Loader2 className="w-3 h-3 animate-spin text-amber-400" />}
          {item.status === "failed" && <XCircle className="w-3 h-3 text-red-400" />}
          <span
            className="text-[10px] font-mono uppercase tracking-wider font-bold ml-auto"
            style={{ color: "var(--color-orange)" }}
          >
            {modelLabel(item)}
          </span>
        </div>

        {/* Editable name row — ✏️ Name */}
        {item.status === "done" && (
          <div className="flex items-center gap-1.5 mb-1.5">
            <Pencil className="w-3 h-3 text-[var(--color-text-muted)] flex-shrink-0" />
            {editingName ? (
              <>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveName()}
                  placeholder="Name…"
                  autoFocus
                  className="flex-1 min-w-0 text-[11px] font-semibold bg-transparent outline-none border-b border-[var(--color-border)] text-[var(--color-text-primary)]"
                />
                <button
                  onClick={saveName}
                  disabled={savingName}
                  className="text-[9px] px-1.5 py-0.5 rounded font-bold disabled:opacity-50"
                  style={{ background: "var(--color-orange)", color: "white" }}
                >
                  {savingName ? "…" : "Save"}
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditingName(true)}
                className="flex-1 min-w-0 text-left text-[11px] font-semibold truncate text-[var(--color-text-secondary)] hover:text-[var(--color-orange)]"
              >
                {name || "Name"}
              </button>
            )}
          </div>
        )}

        {/* Click prompt → modal */}
        {item.prompt && item.status === "done" && (
          <button
            onClick={() => setShowPromptModal(true)}
            className="w-full text-left text-[10px] text-[var(--color-text-secondary)] line-clamp-2 mb-2 hover:text-[var(--color-orange)] transition-colors"
            title="Click to view full prompt"
          >
            {item.prompt}
          </button>
        )}

        {/* Action row — extension's exact icon flow */}
        <div className="flex items-center gap-1 mt-1.5">
          {/* DONE — image: Edit + Download + Delete */}
          {item.status === "done" && isImage && (
            <>
              <ActionBtn title="Edit Image" onClick={() => setShowEditModal(true)} bg={ACTION.edit}>
                <Palette className="w-3.5 h-3.5" strokeWidth={2.4} />
              </ActionBtn>
              <ActionBtn title="Download" onClick={handleDownload} bg={ACTION.download}>
                <Download className="w-3.5 h-3.5" strokeWidth={2.4} />
              </ActionBtn>
              <ActionBtn title="Delete" onClick={handleDelete} bg={ACTION.delete} disabled={deleting}>
                <Trash2 className="w-3.5 h-3.5" strokeWidth={2.4} />
              </ActionBtn>
            </>
          )}

          {/* DONE — video: Extend + Download + Delete */}
          {item.status === "done" && isVideo && (
            <>
              {canExtend && (
                <button
                  onClick={extend}
                  disabled={extending}
                  title="Extend +8s"
                  className="flex-1 h-7 rounded-lg text-[9px] font-extrabold uppercase tracking-wider text-white flex items-center justify-center gap-1 disabled:opacity-50 transition-transform hover:scale-105"
                  style={{ background: ACTION.extend, boxShadow: "0 2px 6px rgba(245,158,11,0.4)" }}
                >
                  {extending ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Plus className="w-3 h-3" />Extend</>}
                </button>
              )}
              <ActionBtn title="Download" onClick={handleDownload} bg={ACTION.download}>
                <Download className="w-3.5 h-3.5" strokeWidth={2.4} />
              </ActionBtn>
              <ActionBtn title="Delete" onClick={handleDelete} bg={ACTION.delete} disabled={deleting}>
                <Trash2 className="w-3.5 h-3.5" strokeWidth={2.4} />
              </ActionBtn>
            </>
          )}

          {/* FAILED — Retry + Delete */}
          {item.status === "failed" && (
            <>
              <button
                onClick={handleRetry}
                disabled={checking}
                title="Retry with same prompt"
                className="flex-1 h-7 rounded-lg text-[9px] font-extrabold uppercase tracking-wider text-white flex items-center justify-center gap-1 disabled:opacity-50 transition-transform hover:scale-105"
                style={{ background: ACTION.retry, boxShadow: "0 2px 6px rgba(34,197,94,0.4)" }}
              >
                {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <><RotateCw className="w-3 h-3" />Retry</>}
              </button>
              <ActionBtn title="Delete" onClick={handleDelete} bg={ACTION.delete} disabled={deleting}>
                <Trash2 className="w-3.5 h-3.5" strokeWidth={2.4} />
              </ActionBtn>
            </>
          )}

          {/* PENDING — no action row, just the refresh icon overlay on the media */}
        </div>
      </div>

      {/* Fullscreen modal */}
      {showFullscreen && item.output_url && (
        <FullscreenModal
          url={item.output_url}
          isVideo={isVideo}
          onClose={() => setShowFullscreen(false)}
        />
      )}

      {/* Prompt modal */}
      {showPromptModal && item.prompt && (
        <PromptModal prompt={item.prompt} onClose={() => setShowPromptModal(false)} />
      )}

      {/* Edit Image modal */}
      {showEditModal && item.output_url && (
        <EditImageModal
          referenceUrl={item.output_url}
          model={item.metadata?.model || "nano-banana-pro"}
          onClose={() => setShowEditModal(false)}
        />
      )}
    </div>
  );
}

// ── Modals ──────────────────────────────────────────────────────────────────

function FullscreenModal({
  url,
  isVideo,
  onClose,
}: {
  url: string;
  isVideo: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.92)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-5 right-5 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition"
        aria-label="Close"
      >
        <X className="w-5 h-5" />
      </button>
      <div className="max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          <video
            src={url}
            controls
            autoPlay
            playsInline
            className="max-w-[90vw] max-h-[90vh] rounded-2xl"
          />
        ) : (
          <img
            src={url}
            alt=""
            className="max-w-[90vw] max-h-[90vh] rounded-2xl object-contain"
          />
        )}
      </div>
    </div>
  );
}

function PromptModal({
  prompt,
  onClose,
}: {
  prompt: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function copy() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        style={{
          background: "#fafaf7",
          border: `2px solid ${ACTION_GREEN_BORDER}`,
          boxShadow: "0 20px 60px rgba(76,175,80,0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "#d8e8d0" }}
        >
          <h2 className="font-display font-extrabold text-lg" style={{ color: "#2e7d32" }}>
            Full Prompt
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-200 text-xs font-bold"
            style={{ background: "#fafaf7", border: "1px solid #d8e8d0", color: "#1a1a1a" }}
          >
            X
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <pre
            className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap rounded-lg p-4"
            style={{
              background: "#f0f5ec",
              color: "#1a1a1a",
              border: "1px solid #d8e8d0",
            }}
          >
            {prompt}
          </pre>
        </div>
        <div className="px-5 pb-5">
          <button
            onClick={copy}
            className="w-full py-3 rounded-lg font-extrabold text-sm text-white transition-transform hover:-translate-y-0.5 inline-flex items-center justify-center gap-2"
            style={{
              background: "linear-gradient(135deg, #4caf50, #66bb6a)",
              boxShadow: "0 4px 14px rgba(76,175,80,0.3)",
            }}
          >
            <Copy className="w-4 h-4" />
            {copied ? "Copied!" : "Copy Prompt"}
          </button>
        </div>
      </div>
    </div>
  );
}

const ACTION_GREEN_BORDER = "#4caf50";

function EditImageModal({
  referenceUrl,
  model,
  onClose,
}: {
  referenceUrl: string;
  model: string;
  onClose: () => void;
}) {
  const [edit, setEdit] = useState(
    "\n\n🚫 Negative Prompt (VERY IMPORTANT)\nextra hands, extra fingers, deformed hands, mutated fingers, bad anatomy, blurry, low quality, duplicate limbs, poorly drawn hands, distorted face, unrealistic proportions, extra arms, cropped hands, missing fingers"
  );
  const [extraRefUrl, setExtraRefUrl] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function pickFile(f: File | null) {
    if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch("/api/upload/image", { method: "POST", body: fd });
      const d = await r.json();
      if (r.ok && d?.url) setExtraRefUrl(d.url);
      else alert(d?.error || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function apply() {
    if (!edit.trim()) return alert("Type an edit instruction first.");
    setSubmitting(true);
    try {
      const refs = [referenceUrl, extraRefUrl].filter(Boolean);
      const r = await fetch("/api/generate/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.includes("gpt-image") ? "gpt-image-2" : "nano-banana-pro",
          prompt: edit.trim(),
          reference_url: refs[0],
          reference_urls: refs.length > 1 ? refs : undefined,
          aspect_ratio: "9:16",
        }),
      });
      const d = await r.json();
      if (r.ok && d?.ok) {
        window.dispatchEvent(new CustomEvent("history:refresh"));
        onClose();
      } else {
        alert(d?.error || "Edit failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden"
        style={{
          background: "#fafaf7",
          border: "2px solid #b388ff",
          boxShadow: "0 20px 60px rgba(124,77,255,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "#d8e8d0" }}
        >
          <h2 className="font-display font-extrabold text-lg flex items-center gap-2" style={{ color: "#7c4dff" }}>
            <Palette className="w-5 h-5" />
            Edit Image
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-200 text-xs font-bold"
            style={{ background: "#fafaf7", border: "1px solid #d8e8d0", color: "#1a1a1a" }}
          >
            X
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="flex justify-center mb-4">
            <img
              src={referenceUrl}
              alt=""
              className="max-h-48 rounded-lg border"
              style={{ borderColor: "#d8e8d0" }}
            />
          </div>

          <label className="block text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#666" }}>
            Edit Instruction
          </label>
          <textarea
            rows={5}
            value={edit}
            onChange={(e) => setEdit(e.target.value)}
            placeholder="Type your edit action here…"
            className="w-full p-3 rounded-lg text-xs resize-y outline-none mb-4"
            style={{
              background: "#f0f5ec",
              border: "1px solid #d8e8d0",
              color: "#1a1a1a",
              fontFamily: "monospace",
            }}
          />

          <label className="block text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#666" }}>
            Reference image (optional)
          </label>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] || null)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
              style={{ background: "#fafaf7", border: "1px solid #d8e8d0", color: "#1a1a1a" }}
            >
              {uploading ? "Uploading…" : "Choose File"}
            </button>
            <span className="text-xs text-gray-500 truncate flex-1">
              {extraRefUrl ? "Uploaded ✓" : "No file chosen"}
            </span>
          </div>
        </div>

        <div
          className="px-5 py-4 border-t flex gap-3"
          style={{ borderColor: "#d8e8d0", background: "#f5f5f0" }}
        >
          <button
            onClick={apply}
            disabled={submitting || uploading}
            className="flex-1 py-3 rounded-lg font-extrabold text-sm text-white transition-transform hover:-translate-y-0.5 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            style={{
              background: "linear-gradient(135deg, #7c4dff, #b388ff)",
              boxShadow: "0 4px 14px rgba(124,77,255,0.4)",
            }}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Palette className="w-4 h-4" />}
            {submitting ? "Submitting…" : "Apply Edit"}
          </button>
          <button
            onClick={onClose}
            className="px-6 py-3 rounded-lg text-sm font-semibold"
            style={{ background: "#fafaf7", border: "1px solid #d8e8d0", color: "#1a1a1a" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// 28×28 square gradient action button — matches extension card buttons
function ActionBtn({
  title,
  onClick,
  bg,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  bg: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-7 h-7 rounded-lg flex items-center justify-center text-white disabled:opacity-50 transition-transform hover:scale-105"
      style={{ background: bg, boxShadow: "0 2px 4px rgba(0,0,0,0.3)" }}
    >
      {disabled ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : children}
    </button>
  );
}
