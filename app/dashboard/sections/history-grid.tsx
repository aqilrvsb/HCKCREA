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
  Layers,
  Clock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Portal from "./portal";
import ExtendDialog from "./extend-dialog";
import LazyVideo from "@/app/components/lazy-video";

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
  project_id: string | null;
  parent_history_id?: string | null;
  segment_index?: number | null;
  merged_url?: string | null;
  frame_anchor?: string | null;
  metadata?: { model?: string; name?: string; duration_mode?: string; seg1_url?: string; seg2_url?: string; [k: string]: any } | null;
};

// Pretty model name for the badge under each card
function modelLabel(item: HistoryItem): string {
  const m = item.metadata?.model || "";
  // Provider tag (P1 / P2) — appended for video tabs where the same
  // model can be served by either backend so users know which one
  // produced (or is producing) this row.
  const provider = String(item.metadata?.provider || "").toUpperCase();
  const providerSuffix =
    provider === "P1" || provider === "P2" ? ` • ${provider}` : "";

  if (m.includes("nano-banana") || m === "nano-banana-pro") return "Banana Pro";
  if (m.includes("gpt-image") || m === "gpt-image-2") return "GPT Image 2";
  if (m.includes("grok-imagine") || m.includes("grok-3"))
    return "Grok Imagine" + providerSuffix;
  if (m.includes("seedance")) return "Seedance" + providerSuffix;
  if (m.includes("veo")) return "Veo 3.1" + providerSuffix;
  return item.type;
}

// Which generation mode produced this video. Falls back to the model id —
// google/veo3-1-fast-{t2v,i2v,r2v} — when metadata.imageMode is missing on
// older rows.
function videoModeLabel(item: HistoryItem): string | null {
  if (!(item.type === "video" || item.type === "auto-content" || item.type === "clone"))
    return null;
  const meta = item.metadata?.imageMode;
  if (meta === "text") return "Text to Video";
  if (meta === "image") return "Image to Video";
  if (meta === "frame") return "First Frame";
  if (meta === "ingredient") return "Product Ref";
  const m = item.metadata?.model || "";
  if (m.includes("grok-imagine/i2v")) return "Image to Video";
  if (m.includes("grok-imagine/t2v")) return "Text to Video";
  if (m.endsWith("-t2v") || m.includes("t2v")) return "Text to Video";
  if (m.endsWith("-i2v") || m.includes("i2v")) return "First Frame";
  if (m.endsWith("-r2v") || m.includes("r2v")) return "Product Ref";
  return null;
}

// Reusable "history below the form" grid. Loads + auto-polls rows for one tab.
// Used by Image, Video, Clone, Auto Content sections.
export default function HistoryGrid({
  tab,
  title,
  projectId,
}: {
  tab: "image" | "video" | "cinema" | "seedance" | "clone" | "auto";
  title: string;
  projectId?: string;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 12;

  // Combine/merge multi-select. Only enabled on video tabs (UGC/Auto/Cinema)
  // — image tabs don't have a "combine" semantic. Reset whenever the tab or
  // project switches (the parent re-keys this component, but extra-safe).
  const supportsMerge = tab === "video" || tab === "auto" || tab === "cinema";
  const [mergeSelection, setMergeSelection] = useState<string[]>([]);
  const [merging, setMerging] = useState(false);
  function toggleMergeSelection(id: string) {
    setMergeSelection((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }
  function clearMergeSelection() {
    setMergeSelection([]);
  }
  async function fireMerge() {
    if (mergeSelection.length < 2 || merging) return;
    setMerging(true);
    try {
      const r = await fetch("/api/merge/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history_ids: mergeSelection }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        alert(d?.error || "Merge failed");
      } else {
        clearMergeSelection();
        window.dispatchEvent(new CustomEvent("history:refresh"));
      }
    } catch (e: any) {
      alert(e?.message || "Network error");
    } finally {
      setMerging(false);
    }
  }
  // Clear selection on tab/project switch
  useEffect(() => {
    setMergeSelection([]);
  }, [tab, projectId]);

  useEffect(() => {
    void load();
    setPage(0);
    // Refresh on explicit dispatch (webhook completes → user clicks per-card
    // refresh icon → user re-enters tab) AND on a 1-minute interval while
    // pending rows are visible. The interval gates itself on items.some
    // (status === "pending"), so once everything is settled the polling
    // stops automatically — no battery drain on idle dashboards.
    const onRefresh = () => load();
    window.addEventListener("history:refresh", onRefresh);
    return () => window.removeEventListener("history:refresh", onRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, projectId]);

  // 1-minute auto-refresh when there's anything pending. Pauses when the
  // tab is hidden (browser throttles intervals on hidden tabs anyway, but
  // explicit pause keeps the logs clean) and stops entirely when no row
  // is pending. The server's pg_cron does the actual settling — this just
  // re-fetches so the UI mirrors what the DB already knows.
  // Cadence: 15s while anything is pending. Webhooks land in ~30-90s, cron
  // every 30s — so a 15s UI poll catches the flip within one tick of the
  // DB write and the user never has to F5.
  useEffect(() => {
    const hasPending = items.some(
      (i) => i.status === "pending" && !i.parent_history_id
    ) ||
      // Also keep ticking while any child seg-2 is pending — the parent
      // looks "done" but the slider's seg-2 thumb is still spinning.
      items.some((i) => i.parent_history_id && i.status === "pending");
    if (!hasPending) return;

    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load({ silent: true });
    }, 15_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  async function load(opts: { silent?: boolean } = {}) {
    // Initial load shows the grid skeleton; poll-driven loads keep the
    // existing cards on screen and just swap the data underneath, so a
    // pending card flipping to done doesn't make the whole grid blink.
    if (!opts.silent) setLoading(true);
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
      if (!opts.silent) setLoading(false);
    }
  }

  // Children (segment_index=2 with parent_history_id) live in the same query
  // result. Pull them out into a lookup map so HistoryCard can build its
  // segment slider, and only show parent rows in the grid.
  const { parents, childMap } = useMemo(() => {
    const parents: HistoryItem[] = [];
    const childMap: Record<string, HistoryItem> = {};
    for (const it of items) {
      if (it.parent_history_id) childMap[it.parent_history_id] = it;
      else parents.push(it);
    }
    return { parents, childMap };
  }, [items]);

  const counts = useMemo(
    () => ({
      total: parents.length,
      pending: parents.filter((i) => i.status === "pending").length,
    }),
    [parents]
  );

  const totalPages = Math.max(1, Math.ceil(parents.length / PAGE_SIZE));
  // Clamp page if items shrink (e.g. after delete) so we never show empty page.
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = parents.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

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
          {supportsMerge && mergeSelection.length >= 2 && (
            <div
              className="sticky top-0 z-10 flex items-center justify-between gap-3 mb-3 px-4 py-3 rounded-xl"
              style={{
                background:
                  "linear-gradient(135deg, rgba(139,92,246,0.18) 0%, rgba(167,139,250,0.12) 100%)",
                border: "1px solid rgba(139,92,246,0.45)",
                backdropFilter: "blur(8px)",
              }}
            >
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4" style={{ color: "#a78bfa" }} />
                <span className="text-sm font-bold text-[var(--color-text-primary)]">
                  {mergeSelection.length} videos selected
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-muted)]">
                  · click cards to add/remove
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={clearMergeSelection}
                  disabled={merging}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50"
                  style={{
                    background: "var(--color-bg-card)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  Clear
                </button>
                <button
                  onClick={fireMerge}
                  disabled={merging}
                  className="px-4 py-1.5 rounded-lg text-xs font-extrabold uppercase tracking-wider text-white disabled:opacity-50 inline-flex items-center gap-2"
                  style={{
                    background:
                      "linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)",
                    boxShadow: "0 4px 12px rgba(139,92,246,0.4)",
                  }}
                >
                  {merging ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Merging…
                    </>
                  ) : (
                    <>
                      <Layers className="w-3.5 h-3.5" />
                      Merge
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {pageItems.map((it) => (
              <HistoryCard
                key={it.id}
                item={it}
                seg2={childMap[it.id]}
                mergeSupported={supportsMerge}
                mergeSelectedIdx={
                  supportsMerge
                    ? mergeSelection.indexOf(it.id)
                    : -1
                }
                onToggleMerge={
                  supportsMerge ? () => toggleMergeSelection(it.id) : undefined
                }
              />
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
                              "linear-gradient(135deg, #facc15 0%, #eab308 100%)",
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
  merge: "linear-gradient(135deg, #8b5cf6, #a78bfa)",      // violet — combine clips (cinema)
  download: "linear-gradient(135deg, #3b82f6, #60a5fa)",   // blue — download
  delete: "linear-gradient(135deg, #ef4444, #f87171)",     // red — delete
  retry: "linear-gradient(135deg, #22c55e, #4ade80)",      // green — retry failed
};

function HistoryCard({
  item,
  seg2,
  mergeSupported,
  mergeSelectedIdx,
  onToggleMerge,
}: {
  item: HistoryItem;
  seg2?: HistoryItem;
  mergeSupported?: boolean;
  mergeSelectedIdx?: number;
  onToggleMerge?: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(item.metadata?.name || "");
  const [editingName, setEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showExtendModal, setShowExtendModal] = useState(false);

  // Clone Prompt cards have no media — just the generated prompt text. They
  // live in the same HistoryGrid as image/video cards but render differently
  // (prompt-first, no player, no extend/improve).
  const isClonePrompt = item.tab === "clone";
  const isVideo =
    !isClonePrompt &&
    (item.type === "video" || item.type === "auto-content" || item.type === "clone");
  const isImage = !isClonePrompt && item.type === "image";
  const isCinema = item.tab === "cinema";
  // Extend + Improve are available on every completed video, regardless of
  // which provider rendered it — fal.ai extracts the last frame from the
  // output URL and feeds it to Veo i2v for the continuation. Cinema cards get
  // a Merge action instead. Clone cards get NEITHER (no media).
  const canExtend =
    isVideo && !isCinema && !isClonePrompt && item.status === "done" && item.output_url;

  // Segment slider — UGC + Auto Content cards that went through the 16s
  // pipeline (or were extended) have a parent row + a child seg-2 row. Build
  // a [seg-1, seg-2, merged] slide list so the user can flip between them.
  // status semantics:
  //   queued   — upstream dependency still running; this slide hasn't
  //              even started. No spinner, no recheck button (nothing
  //              to ping).
  //   pending  — actively running (Veo task / merge step). Spinner +
  //              recheck button (in case the webhook drops).
  //   ready    — final URL available, playable.
  //   failed   — give up, X icon.
  type Slide = {
    id: "seg_0" | "seg_1" | "merged";
    label: string;
    url: string | null;
    status: "ready" | "pending" | "queued" | "failed";
  };
  const slides = useMemo<Slide[]>(() => {
    const has16s = item.metadata?.duration_mode === "16s";
    if (!has16s && !seg2) return [];
    // Before merge: parent.output_url is the seg-1 URL, merged_url is null.
    // After merge: parent.output_url is the merged URL, metadata.seg1_url
    // preserves the original seg-1 URL.
    const merged = item.merged_url || null;
    const seg1Url = merged ? (item.metadata?.seg1_url ?? null) : item.output_url;
    const seg2Url = seg2?.output_url || null;
    const fail = item.status === "failed";
    const seg1Status: Slide["status"] = seg1Url ? "ready" : fail ? "failed" : "pending";
    const seg2Ready = !!seg2 && seg2.status === "done" && !!seg2Url;
    const seg2Status: Slide["status"] = seg2
      ? seg2Ready
        ? "ready"
        : seg2.status === "failed"
          ? "failed"
          : "pending"
      : "queued"; // seg-2 hasn't been kicked off yet (seg-1 still running)
    // Merged slide:
    //   ready  — merge URL exists
    //   failed — parent flagged failed
    //   pending — seg-2 is ready, merge step is actively running
    //   queued — seg-2 not done yet, so the merge hasn't started
    const mergedStatus: Slide["status"] = merged
      ? "ready"
      : fail
        ? "failed"
        : seg2Ready
          ? "pending"
          : "queued";
    return [
      { id: "seg_0", label: "Seg 1", url: seg1Url, status: seg1Status },
      { id: "seg_1", label: "Seg 2", url: seg2Url, status: seg2Status },
      { id: "merged", label: "16s", url: merged, status: mergedStatus },
    ];
  }, [item, seg2]);

  // Default to the merged slide when ready, else seg-1. Track whether the user
  // has manually picked a slide so the auto-jump-to-merged doesn't yank their
  // selection out from under them.
  const [activeIdx, setActiveIdx] = useState(0);
  const [userPicked, setUserPicked] = useState(false);
  useEffect(() => {
    if (slides.length === 0 || userPicked) return;
    const mergedReady = slides.findIndex(
      (s) => s.id === "merged" && s.status === "ready"
    );
    if (mergedReady !== -1) setActiveIdx(mergedReady);
    else setActiveIdx(0);
  }, [slides, userPicked]);

  const activeSlide = slides[activeIdx];
  // Player URL: when the slider is active, use the active slide's URL so
  // clicking a thumbnail switches the main player. Otherwise fall back to
  // item.output_url for plain (non-segmented) cards.
  const playerUrl =
    slides.length > 0 && activeSlide?.url ? activeSlide.url : item.output_url;

  async function checkNow() {
    setChecking(true);
    try {
      // Clone rows have no Crun task — just re-fetch from DB to see if
      // after() has updated the row. Other types poke the Crun status
      // endpoint which can also flip pending → done if the webhook missed.
      if (!isClonePrompt) {
        await fetch(`/api/generate/status?id=${item.id}`, { cache: "no-store" });
      }
      window.dispatchEvent(new CustomEvent("history:refresh"));
    } finally {
      setChecking(false);
    }
  }

  // Per-segment recheck — pokes the right Crun status endpoint based on
  // which slide is stuck. seg_0 + merged share the parent row's id (the
  // merge runs in the parent's after() and writes back to it). seg_1
  // is the child row, so we ping seg2.id for that one.
  const [recheckingId, setRecheckingId] = useState<string | null>(null);
  async function recheckSlide(slide: Slide) {
    const targetId =
      slide.id === "seg_1" ? seg2?.id : item.id;
    if (!targetId) return;
    setRecheckingId(slide.id);
    try {
      await fetch(`/api/generate/status?id=${targetId}`, { cache: "no-store" });
      window.dispatchEvent(new CustomEvent("history:refresh"));
    } finally {
      setRecheckingId(null);
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
    // /api/history/retry re-fires the SAME row in place — keeps the same
    // history_id, original prompt, original reference image, original model
    // (read from metadata so admin model rotations don't break retries).
    // Status flips failed → pending immediately so the card morphs back into
    // a Generating state without disappearing or duplicating.
    setChecking(true);
    try {
      const r = await fetch("/api/history/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history_id: item.id }),
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
      <div
        className={`bg-black relative ${
          isClonePrompt ? "aspect-[1/1]" : "aspect-[9/16]"
        }`}
      >
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
        {item.status === "done" && isClonePrompt && (
          // Clone prompt: no media, render the prompt as the "preview".
          // Click expands the full prompt in a modal.
          <button
            onClick={() => setShowPromptModal(true)}
            className="absolute inset-0 p-3 flex flex-col gap-1.5 text-left overflow-hidden cursor-pointer"
            style={{ background: "rgba(6,182,212,0.08)" }}
          >
            <div
              className="text-[9px] font-mono uppercase tracking-wider font-bold flex items-center gap-1.5"
              style={{ color: "#06b6d4" }}
            >
              <Copy className="w-3 h-3" />
              {item.metadata?.seg_count
                ? `${item.metadata.seg_count} segment${(item.metadata as any).seg_count > 1 ? "s" : ""}`
                : "Clone prompt"}
              {item.metadata?.mode ? ` · ${item.metadata.mode}` : ""}
            </div>
            <div
              className="text-[10px] leading-snug font-mono line-clamp-[10] flex-1 text-white/85"
            >
              {item.prompt}
            </div>
            <div className="text-[9px] text-white/40 mt-auto">
              Click to view full prompt
            </div>
          </button>
        )}
        {item.status === "done" && !isClonePrompt && playerUrl && (
          <>
            {isImage && (
              <img
                src={playerUrl}
                alt=""
                className="w-full h-full object-cover cursor-pointer"
                onClick={() => setShowFullscreen(true)}
              />
            )}
            {isVideo && (
              <LazyVideo
                src={playerUrl + "#t=1"}
                muted
                playsInline
                className="w-full h-full object-cover cursor-pointer"
                onClick={() => setShowFullscreen(true)}
              />
            )}
          </>
        )}
      </div>

      {/* Segment slider — only renders when the card has a seg-1 + seg-2 +
          merged trio. Click a thumb to swap the main player. Pending segments
          show a spinner; failed segments show a red X. */}
      {slides.length >= 2 && (
        <div className="flex gap-1 p-1.5 bg-black border-t border-[var(--color-border)]">
          {slides.map((slide, i) => {
            const isActive = i === activeIdx;
            const ready = slide.status === "ready";
            const lineageColor =
              slide.id === "merged"
                ? "#f59e0b"
                : slide.id === "seg_0"
                  ? "#3b82f6"
                  : "#22c55e";
            const borderColor = isActive
              ? "var(--color-orange)"
              : ready
                ? lineageColor
                : "#333";
            return (
              <button
                key={slide.id}
                onClick={() => {
                  if (!ready) return;
                  setActiveIdx(i);
                  setUserPicked(true);
                }}
                disabled={!ready}
                title={
                  slide.label +
                  (ready
                    ? ""
                    : slide.status === "failed"
                      ? " (failed)"
                      : slide.status === "queued"
                        ? slide.id === "seg_1"
                          ? " (queued — waits for Seg 1 to finish)"
                          : " (queued — merges after Seg 2 finishes)"
                        : " (still generating)")
                }
                className="relative flex-1 min-w-0 aspect-[9/16] rounded overflow-hidden bg-black"
                style={{
                  border: `2px solid ${borderColor}`,
                  opacity: ready ? 1 : 0.55,
                  cursor: ready ? "pointer" : "not-allowed",
                  maxHeight: 80,
                }}
              >
                {ready && slide.url ? (
                  <LazyVideo
                    src={slide.url + "#t=1"}
                    muted
                    playsInline
                    className="w-full h-full object-cover pointer-events-none"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    {slide.status === "failed" ? (
                      <XCircle className="w-3.5 h-3.5 text-red-400" />
                    ) : slide.status === "queued" ? (
                      // Upstream dep still running — show a static clock
                      // (no spinner, since this slide hasn't started yet).
                      <Clock
                        className="w-3.5 h-3.5"
                        style={{ color: "#666" }}
                      />
                    ) : (
                      <Loader2
                        className="w-3.5 h-3.5 animate-spin"
                        style={{ color: lineageColor }}
                      />
                    )}
                  </div>
                )}
                {/* Manual recheck overlay — only visible while the slide
                    is actively loading (status === "pending"). Hidden
                    when queued (upstream still running, nothing to
                    ping), ready (already done), or failed (it already
                    concluded; a kick won't change the result).
                    seg_0 + merged ping the parent row; seg_1 pings the
                    child seg2 row. */}
                {slide.status === "pending" && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void recheckSlide(slide);
                    }}
                    disabled={recheckingId === slide.id}
                    title="Re-check status"
                    className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center disabled:opacity-50"
                    style={{
                      background: "rgba(20,20,20,0.85)",
                      border: "1px solid rgba(255,255,255,0.25)",
                      color: lineageColor,
                      pointerEvents: "auto",
                    }}
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${recheckingId === slide.id ? "animate-spin" : ""}`}
                    />
                  </button>
                )}
                <div
                  className="absolute bottom-0 left-0 right-0 px-1 text-[8px] font-bold text-center truncate"
                  style={{
                    background: "rgba(0,0,0,0.75)",
                    color: ready ? lineageColor : "#aaa",
                    lineHeight: "12px",
                  }}
                >
                  {slide.label}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="p-2.5">
        {/* Status + mode + model badges */}
        <div className="flex items-center gap-1.5 mb-1.5">
          {item.status === "done" && <CheckCircle2 className="w-3 h-3" style={{ color: "var(--color-lime)" }} />}
          {item.status === "pending" && <Loader2 className="w-3 h-3 animate-spin text-amber-400" />}
          {item.status === "failed" && <XCircle className="w-3 h-3 text-red-400" />}
          <span className="ml-auto flex items-center gap-1.5">
            {videoModeLabel(item) && (
              <span
                className="text-[9px] font-mono uppercase tracking-wider font-bold px-1.5 py-0.5 rounded"
                style={{
                  background: "rgba(34,197,94,0.1)",
                  color: "#22c55e",
                  border: "1px solid rgba(34,197,94,0.3)",
                }}
              >
                {videoModeLabel(item)}
              </span>
            )}
            <span
              className="text-[10px] font-mono uppercase tracking-wider font-bold"
              style={{ color: "var(--color-orange)" }}
            >
              {modelLabel(item)}
            </span>
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
          {/* DONE — clone prompt: Copy + Delete only (no media, no extend) */}
          {item.status === "done" && isClonePrompt && (
            <>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(item.prompt || "");
                  } catch {}
                }}
                title="Copy prompt"
                className="flex-1 h-7 rounded-lg text-[9px] font-extrabold uppercase tracking-wider text-white flex items-center justify-center gap-1 transition-transform hover:scale-105"
                style={{
                  background: "linear-gradient(135deg, #06b6d4, #22d3ee)",
                  boxShadow: "0 2px 6px rgba(6,182,212,0.4)",
                }}
              >
                <Copy className="w-3 h-3" />
                Copy
              </button>
              <ActionBtn title="Delete" onClick={handleDelete} bg={ACTION.delete} disabled={deleting}>
                <Trash2 className="w-3.5 h-3.5" strokeWidth={2.4} />
              </ActionBtn>
            </>
          )}

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

          {/* DONE — video: Extend (UGC/Auto) + Combine (UGC/Auto/Cinema)
              + Improve + Download + Delete */}
          {item.status === "done" && isVideo && (
            <>
              {canExtend && (
                <button
                  onClick={() => setShowExtendModal(true)}
                  title="Extend +8s"
                  className="flex-1 h-7 rounded-lg text-[9px] font-extrabold uppercase tracking-wider text-white flex items-center justify-center gap-1 transition-transform hover:scale-105"
                  style={{ background: ACTION.extend, boxShadow: "0 2px 6px rgba(245,158,11,0.4)" }}
                >
                  <Plus className="w-3 h-3" />
                  Extend
                </button>
              )}
              {mergeSupported && onToggleMerge && (
                <button
                  onClick={onToggleMerge}
                  title={
                    (mergeSelectedIdx ?? -1) >= 0
                      ? "Selected for merge — click to deselect"
                      : "Select for merge"
                  }
                  className="flex-1 h-7 rounded-lg text-[9px] font-extrabold uppercase tracking-wider flex items-center justify-center gap-1 transition-all"
                  style={
                    (mergeSelectedIdx ?? -1) >= 0
                      ? {
                          background: ACTION.merge,
                          color: "white",
                          boxShadow: "0 2px 6px rgba(139,92,246,0.4)",
                        }
                      : {
                          background: "var(--color-bg-card)",
                          border: "1px solid var(--color-border)",
                          color: "var(--color-text-secondary)",
                        }
                  }
                >
                  {(mergeSelectedIdx ?? -1) >= 0 ? (
                    <>{(mergeSelectedIdx ?? 0) + 1} ✓</>
                  ) : (
                    <>☐ Combine</>
                  )}
                </button>
              )}
              <ActionBtn title="Improve Video" onClick={() => setShowEditModal(true)} bg={ACTION.edit}>
                <Pencil className="w-3.5 h-3.5" strokeWidth={2.4} />
              </ActionBtn>
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

          {/* PENDING — no action row; only the refresh icon overlay on the
              media. Delete is intentionally hidden during in-flight to keep
              the loading card clean. */}
        </div>
      </div>

      {/* Fullscreen modal — opens whichever slide is currently active so the
          user sees the same clip they were viewing on the card. */}
      {showFullscreen && playerUrl && (
        <FullscreenModal
          url={playerUrl}
          isVideo={isVideo}
          onClose={() => setShowFullscreen(false)}
        />
      )}

      {/* Prompt modal */}
      {showPromptModal && item.prompt && (
        <PromptModal prompt={item.prompt} onClose={() => setShowPromptModal(false)} />
      )}

      {/* Edit Image modal — image cards only */}
      {showEditModal && isImage && item.output_url && (
        <EditImageModal
          referenceUrl={item.output_url}
          model={item.metadata?.model || "nano-banana-pro"}
          projectId={item.project_id}
          onClose={() => setShowEditModal(false)}
        />
      )}

      {/* Improve Video modal — video cards only */}
      {showEditModal && isVideo && item.output_url && (
        <ImproveVideoModal
          parentId={item.id}
          referenceUrl={item.reference_url || item.output_url}
          originalPrompt={item.prompt || ""}
          projectId={item.project_id}
          onClose={() => setShowEditModal(false)}
        />
      )}

      {/* Extend Video modal — new pipeline w/ frame_anchor + auto-merge */}
      {showExtendModal && canExtend && item.output_url && (
        <ExtendDialog
          historyId={item.id}
          videoUrl={item.output_url}
          duration={item.duration || 8}
          bucket={
            item.tab === "cinema"
              ? "cinema"
              : item.tab === "auto"
                ? "auto"
                : "ugc"
          }
          productImageUrl={item.reference_url || undefined}
          voice={(item.metadata as any)?.voice || undefined}
          aspectRatio={(item.metadata as any)?.aspectRatio || "9:16"}
          onClose={() => setShowExtendModal(false)}
          onFired={() => {
            setShowExtendModal(false);
            window.dispatchEvent(new CustomEvent("history:refresh"));
          }}
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
    <Portal>
    <div
      className="fixed inset-0 lg:left-[280px] z-50 flex items-center justify-center p-4"
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
    </Portal>
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
    <Portal>
    <div
      className="fixed inset-0 lg:left-[280px] z-50 flex items-center justify-center p-4"
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
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
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
    </Portal>
  );
}

const ACTION_GREEN_BORDER = "#4caf50";

function EditImageModal({
  referenceUrl,
  model,
  projectId,
  onClose,
}: {
  referenceUrl: string;
  model: string;
  projectId: string | null;
  onClose: () => void;
}) {
  const [edit, setEdit] = useState(
    "\n\n🚫 Negative Prompt (VERY IMPORTANT)\nextra hands, extra fingers, deformed hands, mutated fingers, bad anatomy, blurry, low quality, duplicate limbs, poorly drawn hands, distorted face, unrealistic proportions, extra arms, cropped hands, missing fingers"
  );
  const [extraRefUrl, setExtraRefUrl] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [showHistoryPicker, setShowHistoryPicker] = useState(false);
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

  // Local preview only — upload happens at Apply Edit, not on file pick.
  function pickFile(f: File | null) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setExtraRefUrl(String(reader.result || ""));
    reader.readAsDataURL(f);
  }

  // Pass-through if already a public URL; upload data: URLs to RunningHub now.
  async function ensurePublicUrl(v: string): Promise<string> {
    if (!v) return "";
    if (!v.startsWith("data:")) return v;
    const blob = await (await fetch(v)).blob();
    const fd = new FormData();
    fd.append("file", blob, "edit-ref.png");
    const r = await fetch("/api/upload/image", { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok || !d?.url) throw new Error(d?.error || "Upload failed");
    return d.url;
  }

  async function apply() {
    if (!edit.trim()) return alert("Type an edit instruction first.");
    setSubmitting(true);
    try {
      const extraPub = await ensurePublicUrl(extraRefUrl);
      const refs = [referenceUrl, extraPub].filter(Boolean);
      const r = await fetch("/api/generate/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.includes("gpt-image") ? "gpt-image-2" : "nano-banana-pro",
          prompt: edit.trim(),
          reference_url: refs[0],
          reference_urls: refs.length > 1 ? refs : undefined,
          aspect_ratio: "9:16",
          project_id: projectId,
        }),
      });
      const d = await r.json();
      if (r.ok && d?.ok) {
        window.dispatchEvent(new CustomEvent("history:refresh"));
        onClose();
      } else {
        alert(d?.error || "Edit failed");
      }
    } catch (e: any) {
      alert(e?.message || "Edit failed");
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

        <div className="flex-1 min-h-0 overflow-y-auto p-5">
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
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] || null)}
          />
          <div className="flex items-stretch gap-2">
            {/* Preview thumbnail (uploaded data URL OR picked-from-history URL) */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
              style={{
                border: extraRefUrl ? "2px solid #b388ff" : "2px dashed #d8e8d0",
                background: extraRefUrl ? "#000" : "#fafaf7",
              }}
              aria-label={extraRefUrl ? "Replace image" : "Upload image"}
            >
              {extraRefUrl ? (
                <img src={extraRefUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl opacity-60">📦</span>
              )}
            </button>

            <div className="flex flex-col gap-1.5 justify-center">
              <button
                type="button"
                onClick={() => setShowHistoryPicker(true)}
                className="px-3 py-1.5 rounded-md text-[10px] font-bold"
                style={{ background: "rgba(124,77,255,0.08)", border: "1px solid #b388ff", color: "#7c4dff" }}
              >
                From History
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="px-3 py-1.5 rounded-md text-[10px] font-bold"
                style={{ background: "#fafaf7", border: "1px solid #d8e8d0", color: "#1a1a1a" }}
              >
                Upload
              </button>
              {extraRefUrl && (
                <button
                  type="button"
                  onClick={() => setExtraRefUrl("")}
                  className="px-3 py-1.5 rounded-md text-[10px] font-bold"
                  style={{ background: "rgba(244,67,54,0.08)", border: "1px solid rgba(244,67,54,0.4)", color: "#c62828" }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {showHistoryPicker && (
            <EditImagePicker
              onPick={(url) => {
                setExtraRefUrl(url);
                setShowHistoryPicker(false);
              }}
              onClose={() => setShowHistoryPicker(false)}
            />
          )}
        </div>

        <div
          className="px-5 py-4 border-t flex gap-3"
          style={{ borderColor: "#d8e8d0", background: "#f5f5f0" }}
        >
          <button
            onClick={apply}
            disabled={submitting}
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
    </Portal>
  );
}

// Picks a previously-generated image URL — used by the Edit Image modal
// for swapping in a reference. Filters to type=image, status=done.
function EditImagePicker({
  onPick,
  onClose,
}: {
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<
    { id: string; output_url: string; prompt: string | null }[]
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
        .select("id, output_url, prompt")
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
      className="fixed inset-0 lg:left-[280px] z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        style={{
          background: "#ffffff",
          border: "2px solid #b388ff",
          boxShadow: "0 20px 60px rgba(124,77,255,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "#e8e0d8" }}
        >
          <h3 className="font-display font-extrabold text-base" style={{ color: "#7c4dff" }}>
            Pick from History
          </h3>
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
              <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" style={{ color: "#7c4dff" }} />
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
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#b388ff")}
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

// ── Improve Video Modal ─────────────────────────────────────────────────────
// Mirrors creative-hack-auto's "Improve Video" flow: take user's improvement
// suggestion + image-role choice, build an improved prompt, and re-run the
// video generation with the original reference image as the start frame.
function ImproveVideoModal({
  parentId,
  referenceUrl,
  originalPrompt,
  projectId,
  onClose,
}: {
  parentId: string;
  referenceUrl: string;
  originalPrompt: string;
  projectId: string | null;
  onClose: () => void;
}) {
  const [suggestion, setSuggestion] = useState("");
  const [imageMode, setImageMode] = useState<"frame" | "ingredient">("ingredient");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function generate() {
    const text = suggestion.trim();
    if (!text) return alert("Please write an improvement suggestion");
    setSubmitting(true);

    // Build improved prompt — verbatim from extension's flow.
    let improvedPrompt =
      originalPrompt + "\n\nIMPROVEMENT INSTRUCTIONS (apply these changes): " + text;
    if (imageMode === "ingredient") {
      improvedPrompt +=
        "\n\n--- REFERENCE IMAGE LOCK (MANDATORY) ---\n" +
        "CRITICAL PRODUCT LOCK: The product shown MUST be PIXEL-IDENTICAL to the first reference image. " +
        "Do NOT change its color, shape, label, size, material, or any detail. Zero variation. " +
        "Use ONLY the product from the reference image. Do NOT invent or alter the product appearance.\n" +
        "CRITICAL AVATAR LOCK: The person/character MUST be IDENTICAL to the second reference image — " +
        "same face, same skin tone, same hair, same outfit, same hijab (if any), same age. " +
        "The avatar is the same person throughout. Zero variation in appearance.\n" +
        "NEVER leak brand names, logos, or text visible on the product. Refer to the product generically as \"the product\" or \"the item\" only.\n" +
        "Only the SCENE, motion, pose, background, and action may change per the improvement instructions above — " +
        "product identity and avatar identity are LOCKED.";
    }

    try {
      // Route through /api/generate/extend so Improve gets the same fal.ai
      // last-frame extract that Extend uses. "frame" mode → server extracts
      // parent.output_url's last frame as start. "ingredient" → user-selected
      // reference image flows through as start_frame_url for r2v.
      const body: any = {
        parent_id: parentId,
        continuation_prompt: improvedPrompt,
        image_mode: imageMode,
      };
      if (imageMode === "ingredient") {
        body.start_frame_url = referenceUrl;
      }
      const r = await fetch("/api/generate/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (r.ok && d?.ok) {
        window.dispatchEvent(new CustomEvent("history:refresh"));
        onClose();
      } else {
        alert(d?.error || "Improve failed");
      }
    } catch (e: any) {
      alert(e?.message || "Network error");
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
        className="rounded-2xl max-w-md w-full max-h-[90vh] flex flex-col overflow-hidden"
        style={{
          background: "#fafaf7",
          border: "2px solid #b388ff",
          boxShadow: "0 20px 60px rgba(124,77,255,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "#e8e0d8" }}
        >
          <h2 className="font-display font-extrabold text-lg flex items-center gap-2" style={{ color: "#7c4dff" }}>
            <Pencil className="w-5 h-5" />
            Improve Video
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-200 text-xs font-bold"
            style={{ background: "#fafaf7", border: "1px solid #e8e0d8", color: "#1a1a1a" }}
          >
            X
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          <div className="flex gap-3 mb-4">
            <img
              src={referenceUrl}
              alt=""
              className="w-20 h-24 object-cover rounded-lg flex-shrink-0"
              style={{ border: "1px solid #e8e0d8" }}
            />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#666" }}>
                Reference Image
              </div>
              <div className="text-xs text-gray-600 leading-relaxed">
                Will be reused as starting frame for the new video.
              </div>
            </div>
          </div>

          <label className="block text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#666" }}>
            Original Prompt
          </label>
          <div
            className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap rounded-lg p-3 max-h-28 overflow-y-auto mb-4"
            style={{ background: "#f0f5ec", color: "#1a1a1a", border: "1px solid #e8e0d8" }}
          >
            {originalPrompt}
          </div>

          <label className="block text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#666" }}>
            Your Improvement Suggestion <span className="text-gray-400 font-normal">(required)</span>
          </label>
          <textarea
            rows={4}
            value={suggestion}
            onChange={(e) => setSuggestion(e.target.value)}
            placeholder="E.g., make the person smile more, add a zoom-in on product at the end, slower pacing, brighter lighting..."
            className="w-full p-3 rounded-lg text-xs resize-y outline-none mb-4"
            style={{
              background: "#f0f5ec",
              border: "1px solid #e8e0d8",
              color: "#1a1a1a",
              fontFamily: "monospace",
            }}
          />

          <label className="block text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#666" }}>
            Image Role
          </label>
          <select
            value={imageMode}
            onChange={(e) => setImageMode(e.target.value as any)}
            className="w-full px-3 py-2 rounded-lg text-xs font-semibold outline-none"
            style={{ background: "#fafaf7", border: "1px solid #e8e0d8", color: "#1a1a1a" }}
          >
            <option value="ingredient">Product Reference (AI creates new scene)</option>
            <option value="frame">First Frame (scene continues from image)</option>
          </select>
        </div>

        <div
          className="px-5 py-4 border-t flex gap-3"
          style={{ borderColor: "#e8e0d8", background: "#f5f5f0" }}
        >
          <button
            onClick={onClose}
            className="px-6 py-3 rounded-lg text-sm font-semibold"
            style={{ background: "#fafaf7", border: "1px solid #e8e0d8", color: "#1a1a1a" }}
          >
            Cancel
          </button>
          <button
            onClick={generate}
            disabled={submitting}
            className="flex-1 py-3 rounded-lg font-extrabold text-sm text-white transition-transform hover:-translate-y-0.5 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            style={{
              background: "linear-gradient(135deg, #7c4dff, #b388ff)",
              boxShadow: "0 4px 14px rgba(124,77,255,0.4)",
            }}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "🎬"}
            {submitting ? "Submitting…" : "Generate Improved Video"}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

// ── Extend Video Modal ──────────────────────────────────────────────────────
// Single-scene 8s extension. Image mode (frame/ingredient/text) drives whether
// start/end frame zones appear. Frames default to "auto" (server uses parent's
// last frame) but the user can override via Upload or History pick.
function ExtendVideoModal({
  parentId,
  parentDuration,
  parentReferenceUrl,
  parentOutputUrl,
  onClose,
}: {
  parentId: string;
  parentDuration: number;
  parentReferenceUrl: string;
  parentOutputUrl: string;
  onClose: () => void;
}) {
  const [imageMode, setImageMode] = useState<"frame" | "ingredient" | "text">("ingredient");
  const [startFrame, setStartFrame] = useState(""); // "" = auto
  const [endFrame, setEndFrame] = useState("");
  const [refImage, setRefImage] = useState("");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<"start" | "end" | "ref" | null>(null);

  const startInputRef = useRef<HTMLInputElement | null>(null);
  const endInputRef = useRef<HTMLInputElement | null>(null);
  const refInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  function readFile(f: File | null, set: (s: string) => void) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => set(String(reader.result || ""));
    reader.readAsDataURL(f);
  }

  async function ensurePublicUrl(v: string): Promise<string> {
    if (!v) return "";
    if (!v.startsWith("data:")) return v;
    const blob = await (await fetch(v)).blob();
    const fd = new FormData();
    fd.append("file", blob, "extend-ref.png");
    const r = await fetch("/api/upload/image", { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok || !d?.url) throw new Error(d?.error || "Upload failed");
    return d.url;
  }

  async function generate() {
    const text = prompt.trim();
    if (!text) return alert("Continuation prompt is required");
    if (imageMode === "ingredient" && !refImage)
      return alert("Upload Image Reference for Product Ref mode");
    setSubmitting(true);
    try {
      const [startPub, endPub, refPub] = await Promise.all([
        ensurePublicUrl(startFrame),
        ensurePublicUrl(endFrame),
        ensurePublicUrl(refImage),
      ]);

      const body: any = {
        parent_id: parentId,
        continuation_prompt: text,
        image_mode: imageMode,
      };
      if (imageMode === "frame") {
        // Empty start_frame_url is intentional — server falls back to fal.ai
        // last-frame extract on parent.output_url. Only send when user picked
        // or uploaded an explicit start frame.
        if (startPub) body.start_frame_url = startPub;
        if (endPub) body.end_frame_url = endPub;
      } else if (imageMode === "ingredient") {
        body.start_frame_url = refPub;
      }
      // For "text" mode: no frames sent, just the prompt.

      const r = await fetch("/api/generate/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (r.ok && d?.ok) {
        window.dispatchEvent(new CustomEvent("history:refresh"));
        onClose();
      } else {
        alert(d?.error || "Extend failed");
      }
    } catch (e: any) {
      alert(e?.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  function handlePickFromHistory(url: string) {
    if (pickerSlot === "start") setStartFrame(url);
    else if (pickerSlot === "end") setEndFrame(url);
    else if (pickerSlot === "ref") setRefImage(url);
    setPickerSlot(null);
  }

  return (
    <Portal>
    <div
      className="fixed inset-0 lg:left-[280px] z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl max-w-md w-full max-h-[90vh] flex flex-col overflow-hidden"
        style={{
          background: "#fafaf7",
          border: "2px solid #f59e0b",
          boxShadow: "0 20px 60px rgba(245,158,11,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "#e8e0d8" }}
        >
          <h2 className="font-display font-extrabold text-lg" style={{ color: "#1a1a1a" }}>
            Extend Video <span className="text-xs font-mono text-gray-400">({parentDuration}s)</span>
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-200"
            style={{ background: "#fafaf7", border: "1px solid #e8e0d8" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {/* Duration — only 1 scene supported for now */}
          <select
            disabled
            className="w-full px-3 py-2 rounded-lg text-xs font-semibold outline-none mb-4"
            style={{ background: "#fafaf7", border: "1px solid #e8e0d8", color: "#1a1a1a" }}
          >
            <option>{parentDuration}-{parentDuration + 8}s (1 scene)</option>
          </select>

          <div
            className="rounded-lg p-4"
            style={{ background: "#f0f5ec", border: "1px solid #d8e8d0" }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-extrabold" style={{ color: "#f59e0b" }}>
                Scene ({parentDuration}-{parentDuration + 8}s)
              </span>
              <select
                value={imageMode}
                onChange={(e) => setImageMode(e.target.value as any)}
                className="px-2 py-1 rounded text-[10px] font-semibold outline-none"
                style={{ background: "#fafaf7", border: "1px solid #e8e0d8", color: "#1a1a1a" }}
              >
                <option value="ingredient">Product Ref</option>
                <option value="frame">First Frame</option>
                <option value="text">Text to Video</option>
              </select>
            </div>

            {imageMode === "text" && (
              <div
                className="p-2.5 rounded mb-3 text-center text-[10px] font-semibold"
                style={{ background: "#fafaf7", border: "1px dashed #d8e8d0", color: "#888" }}
              >
                📝 Text only — no image needed
              </div>
            )}

            {imageMode === "ingredient" && (
              <div className="mb-3">
                <div className="text-[10px] font-bold mb-1.5" style={{ color: "#f59e0b" }}>
                  Image Reference *
                </div>
                <ExtendFrameZone
                  url={refImage}
                  icon="📦"
                  color="#f59e0b"
                  required
                  inputRef={refInputRef}
                  onUpload={(f) => readFile(f, setRefImage)}
                  onHistory={() => setPickerSlot("ref")}
                  onClear={() => setRefImage("")}
                />
              </div>
            )}

            {imageMode === "frame" && (
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <div className="text-[10px] font-bold mb-1.5" style={{ color: "#22c55e" }}>
                    Start Frame {startFrame ? "" : "(auto)"}
                  </div>
                  <ExtendFrameZone
                    url={startFrame}
                    icon="auto"
                    color="#22c55e"
                    inputRef={startInputRef}
                    onUpload={(f) => readFile(f, setStartFrame)}
                    onHistory={() => setPickerSlot("start")}
                    onClear={() => setStartFrame("")}
                  />
                </div>
                <div>
                  <div className="text-[10px] font-bold mb-1.5" style={{ color: "#888" }}>
                    End Frame
                  </div>
                  <ExtendFrameZone
                    url={endFrame}
                    icon="🏁"
                    color="#888"
                    inputRef={endInputRef}
                    onUpload={(f) => readFile(f, setEndFrame)}
                    onHistory={() => setPickerSlot("end")}
                    onClear={() => setEndFrame("")}
                  />
                </div>
              </div>
            )}

            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Continuation prompt..."
              className="w-full p-2.5 rounded-lg text-xs resize-y outline-none"
              style={{ background: "#fafaf7", border: "1px solid #d8e8d0", color: "#1a1a1a" }}
            />
          </div>
        </div>

        <div
          className="px-5 py-4 border-t"
          style={{ borderColor: "#e8e0d8", background: "#f5f5f0" }}
        >
          <button
            onClick={generate}
            disabled={submitting}
            className="w-full py-3 rounded-lg font-extrabold text-sm text-white transition-transform hover:-translate-y-0.5 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            style={{
              background: "linear-gradient(135deg, #f59e0b, #fbbf24)",
              boxShadow: "0 4px 14px rgba(245,158,11,0.4)",
            }}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {submitting ? "Submitting…" : "Generate +8s"}
          </button>
        </div>

        {pickerSlot && (
          <EditImagePicker
            onPick={handlePickFromHistory}
            onClose={() => setPickerSlot(null)}
          />
        )}
      </div>
    </div>
    </Portal>
  );
}

// Compact 60×60 frame zone with stacked History/Upload/x buttons — used by
// the Extend Video modal to mirror the extension's frame-zone widget.
function ExtendFrameZone({
  url,
  icon,
  color,
  required,
  inputRef,
  onUpload,
  onHistory,
  onClear,
}: {
  url: string;
  icon: string;
  color: string;
  required?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (f: File | null) => void;
  onHistory: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-stretch gap-1.5">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative w-[60px] h-[60px] rounded overflow-hidden flex-shrink-0 flex items-center justify-center"
        style={{
          border: `${required ? 2 : 1}px dashed ${url ? "transparent" : color}`,
          background: url ? "#000" : "#fafaf7",
        }}
      >
        {url ? (
          <img src={url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-[10px] font-semibold" style={{ color }}>{icon}</span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onUpload(e.target.files?.[0] || null)}
      />
      <div className="flex flex-col gap-0.5 justify-between">
        <button
          type="button"
          onClick={onHistory}
          className="px-1.5 py-0.5 rounded text-[9px] font-bold"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid #f59e0b", color: "#f59e0b" }}
        >
          History
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="px-1.5 py-0.5 rounded text-[9px] font-bold"
          style={{ background: "#fafaf7", border: "1px solid #e8e0d8", color: "#1a1a1a" }}
        >
          Upload
        </button>
        <button
          type="button"
          onClick={onClear}
          className="px-1.5 py-0.5 rounded text-[9px] font-bold"
          style={{ background: "rgba(244,67,54,0.08)", border: "1px solid rgba(244,67,54,0.4)", color: "#c62828" }}
        >
          x
        </button>
      </div>
    </div>
  );
}
