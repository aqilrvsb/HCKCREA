"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
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
  HardDrive,
  CloudUpload,
  Upload,
  UploadCloud,
  Check,
  Hash,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Portal from "./portal";
import ExtendDialog from "./extend-dialog";
import AttachmentPicker from "./attachment-picker";
import { CategoryPickModal } from "./attachments";
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

  // SHORT-CIRCUIT: merged Storytelling videos are stitched from scene
  // images via ffmpeg on Modal — NO Veo / Grok / model call. Earlier
  // versions of this function fell through to the m.includes("veo")
  // branch below because per-scene image cascades sometimes leak a
  // model string into the merged row's metadata, and the merged row
  // ended up badged "VEO 3.1 • P6 A". Storytelling videos are always
  // Storytelling — return early before any model-string parsing.
  if (item.type === "fairytale") return "Storytelling";

  // Provider tag — prefer metadata.slot (e.g. "p2-a"/"p2-b"/"p4"/"p5")
  // so the chip distinguishes Crun key A vs B. For rows fired before
  // the slot field was stamped, fall back to extracting the slot from
  // tier_log[0].tier (format "1:p2-a:<model>"). Last-resort fallback
  // is metadata.provider (just "P2" with no key info).
  let rawSlot = String(item.metadata?.slot || "");
  if (!rawSlot) {
    const tier1: any = item.metadata?.tier_log?.[0];
    const parts = String(tier1?.tier || "").split(":");
    if (parts.length >= 2 && /^p[1-5](-[ab])?$|^p6-[a-h]$|^none$/i.test(parts[1])) {
      rawSlot = parts[1];
    }
  }
  const rawProvider = String(item.metadata?.provider || "");
  const slotLabel = rawSlot
    ? rawSlot
        .toUpperCase()
        .replace(/^P2-([AB])$/, "P2 $1")
        .replace(/^P6-([A-H])$/, "P6 $1")
    : rawProvider.toUpperCase();
  const providerSuffix =
    /^P[1-6]/.test(slotLabel) ? ` • ${slotLabel}` : "";

  if (item.type === "fairytale-scene") {
    // Storytelling scene image — show model + provider so it's
    // obvious whether the scene came from Crun (P2) or Mountsea (P3).
    if (m.includes("nano-banana-fast")) return "Banana Fast" + providerSuffix;
    if (m.includes("nano-banana")) return "Banana Pro" + providerSuffix;
    if (m.includes("gpt-image")) return "GPT Image" + providerSuffix;
    if (m.includes("z-image")) return "Z-Image" + providerSuffix;
    return ("Scene Image" + providerSuffix).trim();
  }
  // Banana variants — disambiguate so the badge reflects the actual model
  // selected in admin (P2's nano-banana-v2 vs P3's nano-banana-2 are
  // genuinely different upstream models). Add provider suffix for clarity.
  if (m === "nano-banana-fast") return "Banana Fast" + providerSuffix;
  if (m === "nano-banana-2") return "Banana 2" + providerSuffix;
  if (m === "nano-banana-v2" || m === "google/nano-banana-v2") return "Banana v2" + providerSuffix;
  if (m === "nano-banana-pro" || m === "google/nano-banana-pro") return "Banana Pro" + providerSuffix;
  if (m.includes("nano-banana")) return "Banana Pro" + providerSuffix; // fallback for unknown variants
  if (m.includes("gpt-image") || m === "gpt-image-2") return "GPT Image 2" + providerSuffix;
  if (m === "z-image" || m.includes("z-image")) return "Z-Image" + providerSuffix;
  if (m.includes("grok-imagine") || m.includes("grok-3"))
    return "Grok Imagine" + providerSuffix;
  if (m.includes("seedance")) return "Seedance" + providerSuffix;
  // Viral tab "Talking Object AI" rows — show the special badge so users can
  // distinguish them from free-form Veo generations on the same tab.
  if (
    item.tab === "cinema" &&
    item.metadata?.featureType === "talking-object"
  ) {
    return "Talking Object" + (m.includes("veo") ? providerSuffix : "");
  }
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
  tab: "image" | "video" | "cinema" | "grok" | "seedance" | "clone" | "auto" | "fairytale";
  title: string;
  projectId?: string;
}) {
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 12;

  // Storytelling has TWO kinds of artifacts the user wants visible:
  //   • merged final videos (type='fairytale')        ← the deliverable
  //   • intermediate scene images (type='fairytale-scene') ← the raw assets
  // Sub-tab toggles which the query returns. Default = "videos" (parity
  // with the old behaviour). Only relevant when tab === "fairytale".
  const [storytellingSubTab, setStorytellingSubTab] = useState<"videos" | "images" | "drafts">("videos");
  // Viral tab sub-tab — Talking Object AI generates BOTH a banana-pro
  // image AND a Veo video; users want to browse them as separate lists,
  // same UX as Storytelling. "videos" = the final mp4s (type=video).
  // "images" = the intermediate banana-pro images (type=image, child
  // rows of the talking-object pipeline).
  const [viralSubTab, setViralSubTab] = useState<"videos" | "images">("videos");
  // Viral tab now has TWO features: Talking Object (AI wizard, has both
  // videos AND images) and Normal Video (free-form prompt, videos only).
  // viralFeature switches between the two; when on Normal Video the
  // Videos/Images toggle is hidden and only videos render.
  const [viralFeature, setViralFeature] = useState<"talking-object" | "normal-video">("talking-object");

  // Cross-component sync — when the user clicks a feature button in the
  // wizard at the top of the Viral tab, cinema.tsx fires a
  // "viral-feature:change" event with the new tag. Mirror it here so
  // both panels stay in lockstep without prop drilling.
  useEffect(() => {
    function onViralFeatureChange(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail === "talking-object" || detail === "normal-video") {
        setViralFeature(detail);
      }
    }
    window.addEventListener("viral-feature:change", onViralFeatureChange);
    return () =>
      window.removeEventListener("viral-feature:change", onViralFeatureChange);
  }, []);

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

  // SWR cache for the history query. Cached results live in memory
  // keyed by [tab, projectId, sub-tabs, viralFeature], so a tab switch
  // (UGC → Cinema → UGC) shows the previous cards instantly while a
  // background revalidation runs. Replaces the old useState + load()
  // + setInterval combo — same fetch logic, just cached.
  //
  // refreshInterval is a function so polling auto-pauses when no row
  // is pending AND when the tab is hidden — same behaviour as the old
  // interval, just expressed declaratively.
  const swrKey = useMemo(
    () => ["history", tab, projectId || "", storytellingSubTab, viralSubTab, viralFeature] as const,
    [tab, projectId, storytellingSubTab, viralSubTab, viralFeature]
  );
  const { data: items = [], isLoading: loading, mutate: mutateItems } = useSWR<HistoryItem[]>(
    swrKey,
    async () => {
      const sb = createClient();
      // tab="grok" is a virtual tab — rows are stored as tab='cinema' in
      // the DB with metadata.featureType='grok' (or legacy 'normal-video').
      // Map the virtual tab back to the underlying DB tab here so the
      // SELECT lands on real rows.
      const dbTab = tab === "grok" ? "cinema" : tab;
      let q = sb
        .from("history")
        .select("*")
        .eq("tab", dbTab)
        .order("created_at", { ascending: false })
        .limit(60);
      if (projectId) q = q.eq("project_id", projectId);
      if (tab === "fairytale") {
        q = q.eq(
          "type",
          storytellingSubTab === "images" ? "fairytale-scene" : "fairytale"
        );
      }
      if (tab === "grok") {
        // Grok tab — only rows tagged grok (or legacy normal-video).
        q = q
          .eq("type", "video")
          .in("metadata->>featureType", ["grok", "normal-video"]);
      } else if (tab === "cinema") {
        if (viralFeature === "talking-object") {
          q = q
            .eq("type", viralSubTab === "images" ? "image" : "video")
            .in("metadata->>featureType", [
              "talking-object",
              "talking-object-image",
            ]);
        } else {
          // Postgres NULL gotcha: NOT IN (…) excludes NULL rows. Use an
          // OR'd filter that matches NULL OR not-in-the-set instead.
          q = q
            .eq("type", "video")
            .or(
              `metadata->>featureType.is.null,metadata->>featureType.not.in.(talking-object,talking-object-image)`
            );
        }
      }
      const { data } = await q;
      return (data as HistoryItem[]) || [];
    },
    {
      keepPreviousData: true, // <-- warm tab switch = instant
      revalidateOnFocus: true,
      dedupingInterval: 3000,
      // 15s poll while anything is pending AND tab is visible. Returns
      // 0 to disable. Same gating as the old setInterval, declarative.
      refreshInterval: (latest) => {
        if (!latest || latest.length === 0) return 0;
        const hasPending = latest.some((i) => i.status === "pending");
        if (!hasPending) return 0;
        if (typeof document !== "undefined" && document.visibilityState !== "visible") return 0;
        return 15_000;
      },
    }
  );

  // Reset pagination + listen for explicit refresh events.
  useEffect(() => {
    setPage(0);
  }, [tab, projectId, storytellingSubTab, viralSubTab, viralFeature]);

  useEffect(() => {
    const onRefresh = () => void mutateItems();
    window.addEventListener("history:refresh", onRefresh);
    return () => window.removeEventListener("history:refresh", onRefresh);
  }, [mutateItems]);

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

  // Save-to-storage status — single batched POST to /api/storage/status
  // with all parent ids on screen, cached via SWR so a tab re-switch
  // doesn't re-fire this 880ms call. Keyed by the joined id list so
  // adding/removing items (delete, paginate) triggers a fresh fetch.
  const parentIdsKey = useMemo(() => parents.map((p) => p.id).join("|"), [parents]);
  const { data: saveStatus = {}, mutate: mutateSaveStatus } = useSWR<
    Record<string, { saved: boolean; storage_id?: string; url?: string }>
  >(
    parentIdsKey ? ["storage-status", parentIdsKey] : null,
    async () => {
      const ids = parentIdsKey.split("|").filter(Boolean);
      const r = await fetch("/api/storage/status", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history_ids: ids }),
      });
      const d = await r.json();
      if (!d?.ok) return {};
      return d.statuses || {};
    },
    {
      keepPreviousData: true,
      dedupingInterval: 5000,
      revalidateOnFocus: false,
    }
  );
  useEffect(() => {
    const onSaved = () => void mutateSaveStatus();
    window.addEventListener("storage:saved", onSaved);
    return () => window.removeEventListener("storage:saved", onSaved);
  }, [mutateSaveStatus]);

  // Set of history_ids the user has transferred to Attachments. Drives
  // the Transfer button state on image-tab cards. Refetches on the
  // "attachments:changed" custom event fired by the Attachments page +
  // picker when the user uploads, transfers, deletes or recategorises.
  const { data: transferredArr = [], mutate: mutateTransferred } = useSWR<string[]>(
    "attachments:transferred",
    async () => {
      const r = await fetch("/api/attachments/transferred", { credentials: "include" });
      const d = await r.json();
      return d?.ok ? (d.history_ids as string[]) : [];
    },
    { keepPreviousData: true, dedupingInterval: 5000, revalidateOnFocus: false }
  );
  const transferredSet = useMemo(() => new Set(transferredArr), [transferredArr]);
  useEffect(() => {
    const on = () => void mutateTransferred();
    window.addEventListener("attachments:changed", on);
    return () => window.removeEventListener("attachments:changed", on);
  }, [mutateTransferred]);

  const counts = useMemo(
    () => ({
      // Reflect what the user actually sees in the grid (after the
      // expired-unsaved filter), not the raw row count.
      total: parents.length,
      pending: parents.filter((i) => i.status === "pending").length,
    }),
    [parents]
  );

  // Visibility rules — every generation is now auto-rehosted to B2 with
  // a 30-day lifecycle rule (see lib/settle.ts → rehostOutputToB2). The
  // dashboard hides rows whose B2 file is about to expire so users
  // aren't shown broken cards.
  //   • Default rows: hide once 30-day TTL is reached.
  //   • Storytelling: same 30-day window, but show the warning chip
  //     ≥29 days so users see the countdown before the row vanishes.
  const TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const STORY_CUTOFF_MS = 29 * 24 * 60 * 60 * 1000;
  const visibleParents = useMemo(() => {
    const now = Date.now();
    return parents.filter((p) => {
      if (!p.created_at) return true; // unknown age — keep
      const ageMs = now - new Date(p.created_at).getTime();
      const saved = !!saveStatus[p.id]?.saved;
      const isStorytelling = p.type === "fairytale" || p.type === "fairytale-scene";
      const cutoff = isStorytelling ? STORY_CUTOFF_MS : TTL_MS;
      const past = ageMs >= cutoff;
      if (!past) return true;
      return saved;
    });
  }, [parents, saveStatus]);

  const totalPages = Math.max(1, Math.ceil(visibleParents.length / PAGE_SIZE));
  // Clamp page if items shrink (e.g. after delete) so we never show empty page.
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = visibleParents.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

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

      {/* Storytelling has three artifact types worth surfacing — the
          merged final videos, the raw scene images that fed into them,
          AND in-progress drafts (unfinished wizard sessions). Sub-tab
          toggles between the three. Drafts persist across browser
          close/device switch; merging a draft does NOT auto-delete it
          so the user can reopen the same draft to iterate on a new
          variation. */}
      {tab === "fairytale" && (
        <div className="flex gap-1 p-1 rounded-xl bg-[var(--color-bg-card)] mb-4 max-w-md">
          {(["videos", "images", "drafts"] as const).map((t) => {
            const active = storytellingSubTab === t;
            const label =
              t === "videos"
                ? "🎬 Videos"
                : t === "images"
                  ? "🖼️ Images"
                  : "📝 Projects";
            return (
              <button
                key={t}
                type="button"
                onClick={() => setStorytellingSubTab(t)}
                className="flex-1 py-2 rounded-lg text-xs font-bold transition"
                style={
                  active
                    ? {
                        background: "var(--color-orange)",
                        color: "white",
                        boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                      }
                    : { background: "transparent", color: "var(--color-text-muted)" }
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Drafts pane — only renders when Storytelling tab + drafts
          sub-tab. Lists unfinished wizard sessions; click a card to
          fire the resume event the FairytaleTab listens for. */}
      {tab === "fairytale" && storytellingSubTab === "drafts" && (
        <StorytellingDraftsPane projectId={projectId} />
      )}

      {/* Viral tab: 2-level selector. Top row picks the sub-feature
          (Talking Object vs Normal Video). Second row picks Videos or
          Images, but only renders for Talking Object — Normal Video is
          videos-only. */}
      {tab === "cinema" && (
        <>
          <div className="flex gap-1 p-1 rounded-xl bg-[var(--color-bg-card)] mb-2 max-w-md">
            {(
              [
                { key: "talking-object" as const, emoji: "🗣️", label: "Talking Object" },
                { key: "normal-video" as const, emoji: "🎞️", label: "Normal Video" },
              ]
            ).map((f) => {
              const active = viralFeature === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setViralFeature(f.key)}
                  className="flex-1 py-2 rounded-lg text-xs font-bold transition"
                  style={
                    active
                      ? {
                          background: "var(--color-orange)",
                          color: "white",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                        }
                      : { background: "transparent", color: "var(--color-text-muted)" }
                  }
                >
                  {f.emoji} {f.label}
                </button>
              );
            })}
          </div>
          {viralFeature === "talking-object" && (
            <div className="flex gap-1 p-1 rounded-xl bg-[var(--color-bg-card)] mb-4 max-w-xs">
              {(["videos", "images"] as const).map((t) => {
                const active = viralSubTab === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setViralSubTab(t)}
                    className="flex-1 py-2 rounded-lg text-xs font-bold transition"
                    style={
                      active
                        ? {
                            background: "var(--color-orange)",
                            color: "white",
                            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                          }
                        : { background: "transparent", color: "var(--color-text-muted)" }
                    }
                  >
                    {t === "videos" ? "🎬 Videos" : "🖼️ Images"}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Skip the regular history grid when the Storytelling Drafts
          sub-tab is active — drafts come from fairytale_drafts table
          (rendered above via StorytellingDraftsPane), not from the
          history table. */}
      {tab === "fairytale" && storytellingSubTab === "drafts" ? null : items.length === 0 ? (
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

          {/* Card grid breakpoints — 2 cards per row on mobile (~180px
              each at 393px viewport) per user direction. Action row uses
              flex-wrap so 30d/Download/Delete wrap to a second row when
              they don't fit — no overflow. Larger screens scale up. */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {pageItems.map((it) => (
              <HistoryCard
                key={it.id}
                item={it}
                seg2={childMap[it.id]}
                saveStatus={saveStatus[it.id]}
                transferred={transferredSet.has(it.id)}
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

function HistoryCardInner({
  item,
  seg2,
  saveStatus,
  transferred,
  mergeSupported,
  mergeSelectedIdx,
  onToggleMerge,
}: {
  item: HistoryItem;
  seg2?: HistoryItem;
  saveStatus?: { saved: boolean; storage_id?: string; url?: string };
  transferred?: boolean;
  mergeSupported?: boolean;
  mergeSelectedIdx?: number;
  onToggleMerge?: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(item.metadata?.name || "");
  const [editingName, setEditingName] = useState(false);
  // Prompt edit mode for failed cards. null = view-only, string = editing.
  // When non-null, Resubmit sends this overridden prompt to the retry route.
  const [editedPrompt, setEditedPrompt] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showExtendModal, setShowExtendModal] = useState(false);
  // Transfer-to-Attachments — image tab only. The modal asks which
  // category (product/avatar) before firing /api/attachments/transfer.
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferring, setTransferring] = useState(false);

  async function handleTransfer(category: "product" | "avatar") {
    if (transferring || transferred) return;
    setShowTransferModal(false);
    setTransferring(true);
    try {
      const r = await fetch("/api/attachments/transfer", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history_id: item.id, category }),
      });
      const d = await r.json();
      if (!d?.ok) {
        alert(d?.error || "Transfer failed");
        return;
      }
      // Tell the parent grid to refetch the transferred set so this
      // card flips to the green "transferred" state immediately.
      window.dispatchEvent(new CustomEvent("attachments:changed"));
    } catch (e: any) {
      alert(e?.message || "Transfer failed");
    } finally {
      setTransferring(false);
    }
  }

  // Clone Prompt cards have no media — just the generated prompt text. They
  // live in the same HistoryGrid as image/video cards but render differently
  // (prompt-first, no player, no extend/improve).
  const isClonePrompt = item.tab === "clone";
  // Treat the merged Fairytale mp4 as a video card so it gets the player +
  // action row (Save / Download / Delete). Treat fairytale-scene rows as
  // image cards (they're intermediate frames generated by the wizard).
  const isVideo =
    !isClonePrompt &&
    (item.type === "video" ||
      item.type === "auto-content" ||
      item.type === "clone" ||
      item.type === "fairytale");
  const isImage =
    !isClonePrompt && (item.type === "image" || item.type === "fairytale-scene");
  const isCinema = item.tab === "cinema";
  // Extend + Improve are available on every completed Veo video — fal.ai
  // extracts the last frame from the output URL and feeds it to Veo i2v
  // for the continuation. Cinema cards get a Merge action instead. Clone
  // cards get NEITHER (no media). Grok rows are excluded because the
  // /api/extend/video pipeline is hard-wired to Veo i2v + Banana refine;
  // chaining a Veo seg-2 onto a Grok seg-1 produces a visible style cut
  // and the dialog timing model differs (Grok = 2-3 words/sec, Veo =
  // 20-24 words / 8s). Until Grok-to-Grok extend ships, hide the button.
  const rawModelLower = String(
    (item.metadata as any)?.model ||
      (item.metadata as any)?.actualModel ||
      ""
  ).toLowerCase();
  const isGrokRow =
    (item.metadata as any)?.modelChoice === "grok" ||
    /grok-imagine|grok-3/.test(rawModelLower);
  const canExtend =
    isVideo &&
    !isCinema &&
    !isClonePrompt &&
    !isGrokRow &&
    item.status === "done" &&
    item.output_url;

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

  // Default to Segment 1 (index 0) on initial load. User can click any
  // slide thumb to switch — userPicked flag locks their choice in so
  // subsequent grid refreshes / poll responses don't yank their
  // selection back to seg-1.
  // Earlier iteration auto-jumped to the merged 16s slide once it was
  // ready; user feedback was that they want to see seg-1 first by
  // default and explicitly click into the merged slide when they
  // want to view it.
  const [activeIdx, setActiveIdx] = useState(0);
  const [userPicked, setUserPicked] = useState(false);
  useEffect(() => {
    if (slides.length === 0 || userPicked) return;
    setActiveIdx(0);
  }, [slides, userPicked]);

  const activeSlide = slides[activeIdx];
  // Player URL: when the slider is active, use the active slide's URL so
  // clicking a thumbnail switches the main player. Otherwise fall back to
  // item.output_url for plain (non-segmented) cards.
  //
  // Saved-row swap: if this row has been copied to permanent Storage,
  // prefer the B2 cached URL over the original P1/P2 temp URL. The temp
  // URL expires at 14 days; the B2 URL is refreshed every 7 days by the
  // storage table so it stays alive forever as long as the user keeps
  // the saved file. Only applies to the non-segmented playerUrl path
  // (segmented chains keep their original per-segment URLs since each
  // seg has its own row).
  const savedUrl = saveStatus?.saved ? saveStatus.url : null;
  // When the card has a segment slider AND the user clicked a thumb
  // (slides.length > 0 + activeSlide selected), respect the active
  // slide's URL — even if null. NEVER fall back to seg-1's URL when
  // user clicked Seg 2/merged. The placeholder render below handles
  // the null case (loading spinner for pending, ❌ for failed). Only
  // non-segmented rows use the savedUrl/item.output_url fallback.
  const playerUrl =
    slides.length > 0
      ? activeSlide?.url || null
      : savedUrl || item.output_url;
  // True when user clicked a segment thumb that isn't ready yet
  // (queued / pending / failed). Used to render the placeholder
  // overlay instead of an empty video frame.
  const segmentPlaceholder =
    slides.length > 0 && !activeSlide?.url
      ? (activeSlide?.status as Slide["status"]) || "queued"
      : null;

  async function checkNow() {
    setChecking(true);
    try {
      // Storytelling merged videos (type=fairytale) follow a different
      // recovery path. The render runs on Modal (not the Crun providers
      // /api/generate/status polls), so the upstream-status endpoint
      // returns nothing useful for these rows. Instead, hit the
      // dedicated recheck endpoint that HEADs the expected B2 key on
      // peninglab-content — if Modal finished the upload but Vercel's
      // after() hook died before stamping output_url, this recovers the
      // row in one click without re-rendering anything on Modal.
      if (item.type === "fairytale") {
        try {
          const r = await fetch(`/api/fairytale/recheck/${item.id}`, {
            method: "POST",
            cache: "no-store",
            credentials: "include",
          });
          const d = await r.json().catch(() => ({}));
          if (r.ok && d?.ok && d?.recovered) {
            alert(
              `Recovered! Found the merged MP4 in B2 (${Math.round(
                (d.size_bytes || 0) / 1024 / 1024
              )} MB). Row updated to done.`
            );
          } else if (r.ok && d?.already_done) {
            alert("Row already marked done. Refreshing.");
          } else if (d?.reason === "not_found_in_b2") {
            alert(
              `Merge did NOT complete on Modal — no file at the expected B2 key. Delete this row and re-merge.`
            );
          } else if (d?.reason === "file_too_small") {
            alert(d?.message || "File found but too small to be valid.");
          } else if (!r.ok) {
            alert(d?.message || d?.error || `Recheck failed (HTTP ${r.status})`);
          }
        } catch (e: any) {
          alert(`Recheck failed: ${e?.message || "network error"}`);
        }
        window.dispatchEvent(new CustomEvent("history:refresh"));
        return;
      }
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
  // Inline toast for recheck result so the user gets explicit feedback
  // ("still pending", "ready!", "failed") instead of a silent no-op when
  // upstream hasn't changed yet. Auto-dismisses after 3.5s.
  const [recheckMsg, setRecheckMsg] = useState<{
    text: string;
    tone: "ok" | "info" | "err";
  } | null>(null);
  async function recheckSlide(slide: Slide) {
    // Resolve which DB row this slide tracks. slide.id naming:
    //   • "seg_0"  → "Seg 1" in UI, tracks `item` (the parent row)
    //   • "seg_1"  → "Seg 2" in UI, tracks `seg2` (the child row)
    //   • "merged" → final 16s, no upstream task
    const targetRow =
      slide.id === "seg_0" ? item : slide.id === "seg_1" ? seg2 : null;
    const targetId = targetRow?.id;
    if (recheckingId) return;

    // No DB row yet → segment chain is mid-flight (Banana refine
    // running, seg-2 row not inserted yet). Best we can do is refresh
    // the history grid so SWR re-fetches and picks up the new row if
    // it just landed. Show a toast so user knows the click registered.
    if (!targetId) {
      setRecheckingId(slide.id);
      setRecheckMsg({ text: `${slide.label}: refreshing…`, tone: "info" });
      try {
        window.dispatchEvent(new CustomEvent("history:refresh"));
        // Small delay so the spinner is visible and SWR has a tick
        // to re-fetch before we tell the user the result.
        await new Promise((r) => setTimeout(r, 1500));
        setRecheckMsg({
          text: `${slide.label}: chain still running (Banana refine + Veo i2v) — retry in a moment`,
          tone: "info",
        });
        setTimeout(() => setRecheckMsg(null), 4000);
      } finally {
        setRecheckingId(null);
      }
      return;
    }
    setRecheckingId(slide.id);
    setRecheckMsg(null);
    const startedAt = Date.now();
    // Pre-load the upstream identifiers so the toast can show them
    // immediately on the error path too. `task_id` + provider are stamped
    // by the generate route; if they're missing the row hasn't been
    // accepted upstream yet (after() still running) — surface that too.
    const taskId = (targetRow as any)?.task_id || "";
    const provider =
      (targetRow as any)?.metadata?.provider ||
      (targetRow as any)?.metadata?.actualProvider ||
      "?";

    // Self-heal path for seg-2 extends. If the row is a seg-2 child AND
    // has NO task_id stamped yet, the extend after() hook got killed by
    // Vercel between the Banana Pro refine step (which already paid)
    // and the Veo create_task step. The refined frame URL is still
    // sitting in metadata.anchor_frame_refined_url, so we can recover
    // by firing Veo seg-2 now with that frame instead of letting the
    // user delete + redo the whole extend (which would re-charge the
    // refine). Only applies to seg_1 slide (the seg-2 child row).
    const seg2NeedsRecover =
      slide.id === "seg_1" &&
      !taskId &&
      (targetRow as any)?.segment_index === 2 &&
      (targetRow as any)?.parent_history_id &&
      (targetRow as any)?.status !== "done" &&
      (targetRow as any)?.status !== "failed";
    if (seg2NeedsRecover) {
      try {
        const r = await fetch("/api/extend/recover-seg2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ history_id: targetId }),
        });
        const d = await r.json().catch(() => ({}));
        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, 700 - elapsed);
        if (remaining > 0) await new Promise((rs) => setTimeout(rs, remaining));
        setRecheckingId(null);
        if (r.ok && d?.ok) {
          setRecheckMsg({
            text:
              `Seg 2: recovered — Veo task fired with ${
                d.used_refined_frame ? "Banana-refined" : "raw"
              } frame.\n↳ task=${String(d.task_id || "").slice(0, 12)} · provider=${d.provider || "?"}`,
            tone: "ok",
          });
        } else {
          setRecheckMsg({
            text: `Seg 2: recover failed — ${d?.error || `HTTP ${r.status}`}`,
            tone: "err",
          });
        }
        setTimeout(
          () => setRecheckMsg((m) => (m ? null : m)),
          6000
        );
        window.dispatchEvent(new CustomEvent("history:refresh"));
      } catch (e: any) {
        setRecheckingId(null);
        setRecheckMsg({
          text: `Seg 2: recover failed — ${e?.message || "network"}`,
          tone: "err",
        });
      }
      return;
    }

    const traceSuffix = taskId
      ? `\n↳ task=${String(taskId).slice(0, 12)} · provider=${provider}`
      : "\n↳ task not yet stamped (upstream queue)";
    let resultMsg: { text: string; tone: "ok" | "info" | "err" } = {
      text: `${slide.label}: still generating — try again in a minute${traceSuffix}`,
      tone: "info",
    };
    try {
      const r = await fetch(`/api/generate/status?id=${targetId}`, {
        cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      const status =
        d?.history?.status || d?.p2_status || d?.status || "pending";
      const hasUrl = !!d?.history?.output_url;
      // Prefer fresh upstream identifiers from the status endpoint when
      // it returns them — the in-memory row can lag by a poll cycle.
      const freshTaskId =
        d?.history?.task_id ||
        d?.history?.metadata?.task_id ||
        taskId;
      const freshProvider =
        d?.history?.metadata?.provider ||
        d?.history?.metadata?.actualProvider ||
        provider;
      const freshTrace = freshTaskId
        ? `\n↳ task=${String(freshTaskId).slice(0, 12)} · provider=${freshProvider}`
        : "\n↳ task not yet stamped";
      if (status === "completed" || hasUrl) {
        resultMsg = { text: `${slide.label}: ready!${freshTrace}`, tone: "ok" };
      } else if (status === "failed") {
        resultMsg = {
          text: `${slide.label}: failed upstream — click thumb again to retry${freshTrace}`,
          tone: "err",
        };
      } else {
        resultMsg = {
          text: `${slide.label}: still generating (status: ${status})${freshTrace}`,
          tone: "info",
        };
      }
      window.dispatchEvent(new CustomEvent("history:refresh"));
    } catch (e: any) {
      resultMsg = {
        text: `${slide.label}: re-check failed (${e?.message || "network"})`,
        tone: "err",
      };
    } finally {
      // Min visible spin time so the user sees feedback even when the
      // status endpoint returns instantly (otherwise the icon flashes
      // for ~50ms and they think nothing happened).
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, 700 - elapsed);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      setRecheckingId(null);
      setRecheckMsg(resultMsg);
      setTimeout(() => {
        setRecheckMsg((m) => (m === resultMsg ? null : m));
      }, 3500);
    }
  }

  // Per-segment retry — fires /api/history/retry on the failed row so the
  // chain can recover without the user having to delete + redo the whole
  // 16s. seg_0 retry re-fires the parent (kicks off a fresh chain). seg_1
  // retry re-fires the child seg2 row only. merged retry isn't supported
  // here — the merge step is just a download+concat, retrying it without
  // its inputs makes no sense.
  async function retrySlide(slide: Slide) {
    const targetId =
      slide.id === "seg_1" ? seg2?.id : item.id;
    if (!targetId || slide.id === "merged") return;
    if (recheckingId) return;
    setRecheckingId(slide.id);
    setRecheckMsg(null);
    let resultMsg: { text: string; tone: "ok" | "info" | "err" };
    try {
      const r = await fetch("/api/history/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history_id: targetId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) {
        resultMsg = {
          text: `${slide.label}: retry failed — ${d?.error || `HTTP ${r.status}`}`,
          tone: "err",
        };
      } else {
        resultMsg = {
          text: `${slide.label}: retry sent — generating again`,
          tone: "ok",
        };
        window.dispatchEvent(new CustomEvent("history:refresh"));
      }
    } catch (e: any) {
      resultMsg = {
        text: `${slide.label}: retry failed (${e?.message || "network"})`,
        tone: "err",
      };
    } finally {
      setRecheckingId(null);
      setRecheckMsg(resultMsg!);
      setTimeout(() => {
        setRecheckMsg((m) => (m === resultMsg ? null : m));
      }, 3500);
    }
  }

  // Save-to-Storage: copies the temp Crun URL into the user's permanent B2
  // folder so it survives the 14-day Crun TTL. Status is provided by parent
  // via the saveStatus prop (one /api/storage/status call per grid render).
  const saved = !!saveStatus?.saved;
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  async function handleSave() {
    if (saved || saving) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const r = await fetch("/api/storage/save", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history_id: item.id }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      window.dispatchEvent(new CustomEvent("storage:saved"));
    } catch (e: any) {
      setSaveErr(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // 30-day countdown — matches the B2 lifecycle rule on
  // peninglab-content bucket. Files older than 30 days are auto-deleted
  // by B2; the dashboard mirrors that with this countdown badge.
  const expiryDays = useMemo(() => {
    if (!item.created_at) return null;
    const created = new Date(item.created_at).getTime();
    const expiresAt = created + 30 * 24 * 60 * 60 * 1000;
    const remainingMs = expiresAt - Date.now();
    return Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  }, [item.created_at]);

  async function handleDelete() {
    // Segment-aware delete (matches the rule the user defined):
    //   • Viewing Seg 2 slide → delete Seg 2 + any later siblings (Seg
    //     3/4/…). Seg 1 stays untouched; its merged_url is rolled back
    //     to the original seg-1 URL by the backend so it reverts from
    //     a 16s merged clip to its original 8s clip.
    //   • Viewing Seg 1 slide (or merged) → delete ONLY Seg 1 (the
    //     parent row). Any existing children are PROMOTED to standalone
    //     cards by the backend (parent_history_id cleared) so the user
    //     still has those clips as independent videos.
    //   • Plain non-chain card → just delete the row.
    const isSeg2View = activeSlide?.id === "seg_1" && !!seg2?.id;
    const targetId = isSeg2View ? seg2!.id : item.id;
    const confirmMsg = isSeg2View
      ? "Padam Segment 2 (dan segmen lepas seperti Seg 3 kalau ada)? Seg 1 akan jadi 8 saat semula."
      : seg2?.id
        ? "Padam Seg 1 sahaja? Seg 2 (dan segmen lain) akan jadi video bebas — tak akan hilang."
        : "Padam item ni?";
    if (!confirm(confirmMsg)) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/history/delete?id=${targetId}`, { method: "DELETE" });
      // Always refresh history — even on a non-OK response. The backend is
      // idempotent now (404 returns ok:true) so the most common failure
      // mode at this layer is a transient network error. Refreshing
      // pulls the truth from the server and removes the card if the row
      // is actually gone, avoiding the "stuck card / CORS loop on the
      // stale merged.mp4" symptom the user reported.
      window.dispatchEvent(new CustomEvent("history:refresh"));
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        if (d?.error) alert(`Delete: ${d.error}`);
      }
    } catch {
      // Network / abort — still refresh so the UI doesn't stay stuck.
      window.dispatchEvent(new CustomEvent("history:refresh"));
    } finally {
      // ALWAYS reset deleting so the spinner clears even on the success
      // path. Previously only the error branch reset it, leaving the
      // delete icon spinning forever after a successful delete (until
      // the parent unmounted the card).
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
      const body: any = { history_id: item.id };
      if (editedPrompt !== null && editedPrompt.trim() && editedPrompt !== item.prompt) {
        body.prompt = editedPrompt;
      }
      const r = await fetch("/api/history/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        alert(d?.error || "Retry failed");
      } else {
        setEditedPrompt(null);
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
      {/* Keyframes for the rainbow Custom Idea badge below. Cheap to
          duplicate per card (browser de-dupes identical rule names);
          keeps the animation self-contained without a global CSS file. */}
      <style>{`
        @keyframes hg-idea-rainbow {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>
      <div
        className={`bg-black relative ${
          isClonePrompt ? "aspect-[1/1]" : "aspect-[9/16]"
        }`}
      >
        {item.status === "pending" && (
          <>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-amber-400 text-xs font-bold gap-2 px-2 text-center">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Generating…</span>
              {/* Seedance + Cinema (Grok) take a lot longer than Veo
                  UGC. Surface the expected wait so clients don't think
                  the pipeline is stuck. */}
              {item.tab === "seedance" && (
                <span className="text-[10px] font-mono text-amber-300/80 mt-1 leading-tight">
                  Seedance 2.0
                  <br />~ 15–30 minit
                </span>
              )}
              {item.tab === "cinema" && (
                <span className="text-[10px] font-mono text-amber-300/80 mt-1 leading-tight">
                  {item.type === "image" ? "~ 30s–1 minit" : "~ 1–3 minit"}
                </span>
              )}
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
              <span className="line-clamp-2">
                {/^Stale\b/i.test(item.error_message || "") ? "Failed" : (item.error_message || "Failed")}
              </span>
              {/* Full prompt + inline editor. Click Edit to modify
                  before clicking Resubmit. Edited prompt is sent to
                  /api/history/retry via the prompt override field. */}
              {item.prompt && (
                <div
                  className="mt-2 pt-2 border-t w-full"
                  style={{ borderColor: "rgba(239,68,68,0.25)" }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[9px] font-mono uppercase tracking-wider opacity-60">
                      PROMPT
                    </div>
                    {editedPrompt === null ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditedPrompt(item.prompt || "");
                        }}
                        title="Edit prompt before resubmit"
                        className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1 transition"
                        style={{
                          background: "rgba(239,68,68,0.15)",
                          color: "#fca5a5",
                          border: "1px solid rgba(239,68,68,0.3)",
                        }}
                      >
                        <Pencil className="w-2.5 h-2.5" /> Edit
                      </button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (editedPrompt === null) return;
                            const trimmed = editedPrompt.trim();
                            if (!trimmed) return;
                            try {
                              const r = await fetch("/api/history/save-prompt", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ history_id: item.id, prompt: trimmed }),
                              });
                              if (r.ok) {
                                window.dispatchEvent(new CustomEvent("history:refresh"));
                                setEditedPrompt(null);
                              } else {
                                const d = await r.json().catch(() => ({}));
                                alert(d?.error || "Save failed");
                              }
                            } catch (err: any) {
                              alert(err?.message || "Save failed");
                            }
                          }}
                          title="Save edited prompt (does not fire generation)"
                          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                          style={{
                            background: "rgba(34,197,94,0.18)",
                            color: "#86efac",
                            border: "1px solid rgba(34,197,94,0.4)",
                          }}
                        >
                          <Check className="w-2.5 h-2.5" /> Save
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditedPrompt(null);
                          }}
                          title="Cancel edit"
                          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                          style={{
                            background: "rgba(239,68,68,0.15)",
                            color: "#fca5a5",
                            border: "1px solid rgba(239,68,68,0.3)",
                          }}
                        >
                          <X className="w-2.5 h-2.5" /> Cancel
                        </button>
                      </div>
                    )}
                  </div>
                  {editedPrompt === null ? (
                    <div
                      className="text-[10px] font-normal text-left leading-relaxed whitespace-pre-wrap max-h-[180px] overflow-y-auto pr-1"
                      style={{ color: "rgba(252,165,165,0.85)" }}
                    >
                      {item.prompt}
                    </div>
                  ) : (
                    <textarea
                      value={editedPrompt}
                      onChange={(e) => setEditedPrompt(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      rows={8}
                      className="w-full text-[10px] font-normal leading-relaxed rounded p-2 outline-none resize-y"
                      style={{
                        background: "rgba(20,20,20,0.6)",
                        color: "rgba(252,165,165,0.95)",
                        border: "1px solid rgba(239,68,68,0.35)",
                        minHeight: "120px",
                        maxHeight: "240px",
                      }}
                    />
                  )}
                </div>
              )}
              {/* Cascade attempt history — shows which tiers were tried.
                  Lets admin/user see "yep, all 3 providers failed" at a
                  glance instead of guessing why retry didn't help. */}
              {Array.isArray(item.metadata?.tier_log) && item.metadata.tier_log.length > 0 && (
                <div
                  className="mt-2 pt-2 border-t w-full"
                  style={{ borderColor: "rgba(239,68,68,0.25)" }}
                >
                  <div className="text-[9px] font-mono uppercase tracking-wider mb-1 opacity-60">
                    CASCADE ATTEMPTS
                  </div>
                  <div className="text-[9px] font-mono space-y-0.5 text-left">
                    {item.metadata.tier_log.map((t: any, i: number) => {
                      const parts = String(t.tier || "").split(":");
                      const label = parts.length >= 2 ? `${parts[0]}:${parts[1]}` : parts[0] || "";
                      return (
                        <div
                          key={i}
                          style={{
                            color: t.ok ? "#4ade80" : "rgba(252,165,165,0.7)",
                          }}
                        >
                          {t.ok ? "✓" : "✗"} {label}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
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
        {/* Segment placeholder — user clicked Seg 2 / merged thumb
            but that slide isn't ready yet. Shows clearly that the
            segment is loading / queued / failed instead of falling
            back to seg-1's video (which is what was happening
            before, making the thumb click feel broken).

            Background image hierarchy (so Seg 2 placeholder doesn't
            look identical to Seg 1):
              • Seg 2 placeholder → Banana-refined anchor frame
                (seg2.reference_url) if the child row exists; that's
                literally the start frame of seg-2 so it's the most
                honest preview.
              • Merged placeholder → seg-2's output if ready, else
                seg-1's video poster.
              • Seg 1 placeholder (rare — only when Seg 1 itself is
                pending but somehow still selectable) → product
                reference. */}
        {item.status === "done" && !isClonePrompt && segmentPlaceholder && (() => {
          const phBgUrl =
            activeSlide?.id === "seg_1"
              ? (seg2?.reference_url ||
                  (seg2 as any)?.metadata?.anchor_frame_url ||
                  null)
              : activeSlide?.id === "merged"
                ? (seg2?.output_url || item.output_url || null)
                : (item.reference_url || null);
          const phIsVideo =
            activeSlide?.id === "merged" && !seg2?.output_url && !!item.output_url;
          return (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white"
            style={{
              background: "linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%)",
            }}
          >
            {phBgUrl && !phIsVideo && (
              <img
                src={phBgUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                style={{ opacity: 0.32, filter: "blur(2px) saturate(0.9)" }}
              />
            )}
            {phBgUrl && phIsVideo && (
              <LazyVideo
                src={phBgUrl + "#t=1"}
                muted
                playsInline
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                style={{ opacity: 0.32, filter: "blur(2px) saturate(0.9)" }}
              />
            )}
            <div className="absolute inset-0 pointer-events-none" style={{ background: "rgba(0,0,0,0.45)" }} />
            <div className="relative z-10 flex flex-col items-center justify-center gap-2">
            {segmentPlaceholder === "failed" ? (
              <>
                <X className="w-10 h-10" style={{ color: "rgb(239, 68, 68)" }} />
                <div className="text-xs font-bold" style={{ color: "rgb(239, 68, 68)" }}>
                  {activeSlide?.label} failed
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (activeSlide) void retrySlide(activeSlide);
                  }}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold transition"
                  style={{
                    background: "rgba(239,68,68,0.18)",
                    border: "1px solid rgba(239,68,68,0.5)",
                    color: "rgb(252,165,165)",
                  }}
                >
                  <RefreshCw className="w-3 h-3" />
                  Resubmit
                </button>
              </>
            ) : segmentPlaceholder === "queued" ? (
              (() => {
                // Decide the right "queued" message based on where in
                // the 16s chain we are:
                //   • Seg 2 + parent still pending → seg-1 still running
                //   • Seg 2 + parent done           → seg-1 done, chain
                //     is mid-flight (Banana refining + firing Veo i2v).
                //     No seg-2 row yet because it lands AFTER the
                //     refine + create call returns.
                //   • merged + seg-2 not done      → seg-2 still running
                //   • merged + seg-2 done          → ffmpeg merging
                const seg1Done = item.status === "done";
                const seg2Done = !!seg2 && seg2.status === "done";
                const isSeg2 = activeSlide?.id === "seg_1";
                const isMerged = activeSlide?.id === "merged";
                const Icon = (isSeg2 && seg1Done) || (isMerged && seg2Done)
                  ? Loader2
                  : Clock;
                const iconClass =
                  (isSeg2 && seg1Done) || (isMerged && seg2Done)
                    ? "w-10 h-10 animate-spin text-orange-400"
                    : "w-10 h-10 text-white/40";
                const title = isSeg2
                  ? seg1Done
                    ? "Seg 2 generating…"
                    : "Seg 2 queued"
                  : seg2Done
                    ? "Merging Seg 1 + Seg 2…"
                    : "16s queued";
                // Read the live chain_phase marker stamped by
                // lib/segment-chain.ts so the user sees the actual
                // sub-step instead of a generic message.
                const phase = (item.metadata as any)?.chain_phase as
                  | "extracting_last_frame"
                  | "refining_with_banana"
                  | "firing_veo_i2v"
                  | undefined;
                const phaseMs = (item.metadata as any)?.chain_phase_at
                  ? Date.now() -
                    new Date((item.metadata as any).chain_phase_at).getTime()
                  : 0;
                const phaseMinAgo = Math.floor(phaseMs / 60000);
                const phaseLabel =
                  phase === "extracting_last_frame"
                    ? "Extracting last frame from Seg 1 (fal.ai)…"
                    : phase === "refining_with_banana"
                      ? "Refining frame + product via Banana Pro (cascade of admin's image slots)…"
                      : phase === "firing_veo_i2v"
                        ? "Refine done. Firing Veo i2v with refined frame…"
                        : null;
                const sub = isSeg2
                  ? seg1Done
                    ? phaseLabel
                      ? `${phaseLabel}${phaseMinAgo >= 1 ? ` (${phaseMinAgo} min in)` : ""}`
                      : "Refining last frame via Banana Pro, then firing Veo i2v"
                    : "Waiting for Seg 1 to finish"
                  : seg2Done
                    ? "ffmpeg concat — usually 10-20s"
                    : "Waiting for Seg 2 to finish before merge";
                // Show the "Check now" button when the slide is
                // actively being worked on (parent.done for seg-2,
                // seg-2.done for merged) so the user can manually
                // poll instead of waiting for the next 15s refresh.
                const showRecheck =
                  (isSeg2 && seg1Done) || (isMerged && seg2Done);
                return (
                  <>
                    <Icon className={iconClass} />
                    <div className={`text-xs font-bold ${showRecheck ? "text-orange-300" : "text-white/70"}`}>
                      {title}
                    </div>
                    <div className="text-[10px] text-white/50 text-center px-3">
                      {sub}
                    </div>
                    {showRecheck && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (activeSlide) void recheckSlide(activeSlide);
                        }}
                        disabled={!!recheckingId}
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold transition disabled:opacity-50"
                        style={{
                          background: "rgba(251,146,60,0.15)",
                          border: "1px solid rgba(251,146,60,0.4)",
                          color: "rgb(251,146,60)",
                        }}
                      >
                        <RefreshCw className={`w-3 h-3 ${recheckingId ? "animate-spin" : ""}`} />
                        Check now
                      </button>
                    )}
                  </>
                );
              })()
            ) : (
              <>
                <Loader2 className="w-10 h-10 animate-spin text-orange-400" />
                <div className="text-xs font-bold text-orange-300">
                  {activeSlide?.label} generating…
                </div>
                <div className="text-[10px] text-white/50">
                  Auto-refresh every 15s
                </div>
              </>
            )}
            </div>
          </div>
          );
        })()}
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
            // Whole-thumb click target. When ready → switch active video.
            // When pending → recheck status. When failed → retry. Queued
            // slides have NO upstream task yet (Seg 2 is queued until
            // Seg 1 finishes; merged 16s is queued until Seg 2 finishes),
            // so re-checking them queries nothing useful — disable until
            // the predecessor lands.
            const canRecheck = slide.status === "pending";
            const canRetry =
              slide.status === "failed" && slide.id !== "merged";
            // Always interactive — even queued/pending slides should be
            // selectable so the user can see the slide's context and
            // delete it (e.g. when seg-2 is stuck loading too long).
            // Selection happens unconditionally; recheck/retry fire as
            // a SECONDARY effect for non-ready slides so the user
            // doesn't lose that one-click recheck shortcut.
            const interactive = true;
            const onActivate = () => {
              setActiveIdx(i);
              setUserPicked(true);
              if (canRetry) {
                void retrySlide(slide);
              } else if (canRecheck) {
                void recheckSlide(slide);
              }
            };
            return (
              <div
                key={slide.id}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : -1}
                onClick={() => {
                  if (!interactive) return;
                  if (recheckingId === slide.id) return;
                  onActivate();
                }}
                onKeyDown={(e) => {
                  if (!interactive) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onActivate();
                  }
                }}
                title={(() => {
                  // Build the hover-tooltip dynamically so the user can
                  // verify which upstream + which task without firing
                  // recheck. seg_0 == this row (item, "Seg 1" in UI);
                  // seg_1 == seg2 ("Seg 2"); merged has no upstream task.
                  const traceRow =
                    slide.id === "seg_0"
                      ? item
                      : slide.id === "seg_1"
                        ? seg2
                        : null;
                  const traceTask = (traceRow as any)?.task_id || "";
                  const traceProvider =
                    (traceRow as any)?.metadata?.provider ||
                    (traceRow as any)?.metadata?.actualProvider ||
                    "";
                  const traceLine =
                    traceTask || traceProvider
                      ? `\nProvider: ${traceProvider || "?"}\nTask: ${
                          traceTask || "(not stamped yet)"
                        }`
                      : "";
                  const statusLine = ready
                    ? ""
                    : slide.status === "failed"
                      ? " (failed — click to retry)"
                      : slide.status === "queued"
                        ? slide.id === "seg_1"
                          ? " (waiting for Seg 1 to finish)"
                          : " (waiting for Seg 2 to finish before merge)"
                        : " (still generating — click to re-check)";
                  return slide.label + statusLine + traceLine;
                })()}
                className="relative flex-1 min-w-0 aspect-[9/16] rounded overflow-hidden bg-black select-none"
                style={{
                  border: `2px solid ${borderColor}`,
                  opacity: ready ? 1 : 0.55,
                  cursor: interactive ? "pointer" : "default",
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
                  // pointer-events-none so the icon container doesn't
                  // intercept clicks — the action button at top-right
                  // sits at the SAME absolute layer and would otherwise
                  // lose the hit test on its corner.
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
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
                {/* Visual-only action hint badge in the top-right corner.
                    The whole thumb is the click target now (parent <div>
                    role=button), so this is purely a visual cue showing
                    what clicking will do. pointer-events:none ensures the
                    parent's onClick is what fires. */}
                {(canRecheck || canRetry) && (
                  <div
                    className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center pointer-events-none"
                    style={{
                      background: "rgba(20,20,20,0.92)",
                      border: `1px solid ${canRetry ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.35)"}`,
                      color: canRetry ? "#fca5a5" : lineageColor,
                    }}
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${recheckingId === slide.id ? "animate-spin" : ""}`}
                    />
                  </div>
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
              </div>
            );
          })}
        </div>
      )}

      {/* Inline recheck-result toast — explicit feedback so the user knows
          their click registered and what came back, even when status is
          unchanged (the most common case when re-checking too soon). */}
      {recheckMsg && (
        <div
          className="px-2.5 py-1.5 text-[11px] font-medium border-t whitespace-pre-line"
          style={{
            background:
              recheckMsg.tone === "ok"
                ? "rgba(34,197,94,0.12)"
                : recheckMsg.tone === "err"
                  ? "rgba(239,68,68,0.12)"
                  : "rgba(245,158,11,0.12)",
            color:
              recheckMsg.tone === "ok"
                ? "#86efac"
                : recheckMsg.tone === "err"
                  ? "#fca5a5"
                  : "#fcd34d",
            borderColor: "var(--color-border)",
          }}
        >
          {recheckMsg.text}
        </div>
      )}

      <div className="p-2.5">
        {/* Status + mode + model badges */}
        <div className="flex items-center gap-1.5 mb-1.5">
          {item.status === "done" && <CheckCircle2 className="w-3 h-3" style={{ color: "var(--color-lime)" }} />}
          {item.status === "pending" && <Loader2 className="w-3 h-3 animate-spin text-amber-400" />}
          {item.status === "failed" && <XCircle className="w-3 h-3 text-red-400" />}
          <span className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
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

        {/* Framework label — auto-content rows tag each video with the
            selected framework (e.g. "Hook Tarik", "Pose Mirror") so the
            user can tell at a glance which template produced this
            specific card. Hidden when framework is missing (manual UGC,
            cinema, image, clone). */}
        {item.framework && item.tab === "auto" && (
          <div
            className="text-[9px] font-mono uppercase tracking-wider font-bold mb-1.5 inline-block px-1.5 py-0.5 rounded"
            style={{
              background: "rgba(168,85,247,0.12)",
              color: "#c084fc",
              border: "1px solid rgba(168,85,247,0.35)",
            }}
            title={`Framework: ${item.framework}`}
          >
            🎬 {item.framework}
          </div>
        )}

        {/* Custom Idea label — rainbow gradient badge that surfaces the
            client-provided idea_style when one was used for the batch.
            Hidden when the row was generated via Normal Flow (no idea
            set). Click expands the full idea text in a small alert so
            long ideas don't blow out the card width. */}
        {(item.metadata as any)?.idea_style && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const txt = String((item.metadata as any).idea_style || "");
              alert(`Custom Idea (client brief):\n\n${txt}`);
            }}
            className="text-[9px] font-mono uppercase tracking-wider font-bold mb-1.5 px-1.5 py-0.5 rounded inline-flex items-center gap-1 max-w-full text-left transition hover:scale-[1.02]"
            style={{
              background: "linear-gradient(120deg, #fef3c7, #fce7f3, #ede9fe, #dbeafe, #ccfbf1)",
              backgroundSize: "300% 100%",
              animation: "hg-idea-rainbow 6s linear infinite",
              color: "#6b21a8",
              border: "1px solid rgba(168,85,247,0.4)",
              boxShadow: "0 1px 4px rgba(168,85,247,0.18)",
            }}
            title={`Custom Idea: ${(item.metadata as any).idea_style}`}
          >
            <span>✨ Idea:</span>
            <span className="truncate normal-case font-normal" style={{ maxWidth: "180px" }}>
              {String((item.metadata as any).idea_style)}
            </span>
          </button>
        )}

        {/* Task ID icon — clickable. Tooltip on hover shows the full
            ID; click copies to clipboard + alerts so admins can
            correlate to provider logs without cluttering the card. */}
        {item.task_id && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const tid = String(item.task_id);
              try { navigator.clipboard?.writeText(tid); } catch {}
              alert(`Task ID:\n\n${tid}\n\n(copied to clipboard)`);
            }}
            title={`Click for full Task ID: ${item.task_id}`}
            className="inline-flex items-center gap-1 mt-1 mb-1 text-[9px] font-mono px-1.5 py-0.5 rounded transition hover:bg-[var(--color-surface-hover)]"
            style={{ color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
          >
            <Hash className="w-2.5 h-2.5" />
            <span>task id</span>
          </button>
        )}

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

        {/* Click prompt → modal. When the user is viewing Seg 2 the
            prompt area swaps to seg-2's own prompt (segment-chain
            built that prompt via code-level swapDialogBlock, so it's
            the actual text fired to Veo for that segment). Merged
            slide falls back to the parent prompt — there isn't a
            separate "merged" prompt. */}
        {item.status === "done" && (() => {
          const activePrompt =
            activeSlide?.id === "seg_1"
              ? (seg2?.prompt || item.prompt)
              : item.prompt;
          if (!activePrompt) return null;
          return (
            <button
              onClick={() => setShowPromptModal(true)}
              className="w-full text-left text-[10px] text-[var(--color-text-secondary)] line-clamp-2 mb-2 hover:text-[var(--color-orange)] transition-colors"
              title={`Click to view ${activeSlide?.id === "seg_1" ? "Seg 2" : ""} full prompt`.trim()}
            >
              {activePrompt}
            </button>
          );
        })()}

        {/* Action row — extension's exact icon flow.
            flex-wrap lets the 6-button row (Extend/Combine/Improve/30d/
            Download/Delete) break to a second row on narrow mobile cards
            (2-col grid at 393px viewport ≈ 180px card width). Without
            wrap, 30d/Download/Delete used to overflow off the card edge
            and become untappable. */}
        <div className="flex flex-wrap items-center gap-1 mt-1.5">
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

          {/* DONE — image: Transfer (Image tab only) + Edit + Save + Download + Delete */}
          {item.status === "done" && isImage && (
            <>
              {item.tab === "image" && (
                <ActionBtn
                  title={transferred ? "Already in Attachments" : "Transfer to Attachments"}
                  onClick={() => !transferred && setShowTransferModal(true)}
                  bg={
                    transferred
                      ? "linear-gradient(135deg, #22c55e, #4ade80)" // green — transferred
                      : "linear-gradient(135deg, #06b6d4, #22d3ee)" // cyan — available
                  }
                  disabled={transferred || transferring}
                >
                  {transferring ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : transferred ? (
                    <Check className="w-3.5 h-3.5" strokeWidth={2.4} />
                  ) : (
                    <UploadCloud className="w-3.5 h-3.5" strokeWidth={2.4} />
                  )}
                </ActionBtn>
              )}
              <ActionBtn title="Edit Image" onClick={() => setShowEditModal(true)} bg={ACTION.edit}>
                <Palette className="w-3.5 h-3.5" strokeWidth={2.4} />
              </ActionBtn>
              <SaveTrafficLight
                saved={saved}
                saving={saving}
                expiryDays={expiryDays}
                onSave={handleSave}
                isStorytelling={item.type === "fairytale" || item.type === "fairytale-scene"}
                showValidity={
                  // Show the Xd countdown chip for any time-bounded media:
                  //   • storytelling videos / scene images (vanish at ≤1d via early-cutoff)
                  //   • UGC videos (type='video' on tab='video' — fal.media TTL not guaranteed)
                  //   • Auto Content videos (tab='auto')
                  //   • Cinema videos (tab='cinema')
                  // We skip pure-image rows (the user said earlier "we already use storage" for those).
                  item.type === "fairytale" ||
                  item.type === "fairytale-scene" ||
                  item.type === "video"
                }
              />
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
              {/* Improve Video — hidden for UGC + Auto Content cards. The
                  flow there is "regenerate with a better prompt", not
                  "improve this specific clip", so the Extend / Combine
                  buttons cover the use case. Kept for Cinema / Story /
                  Clone where users do iterate on a single result. */}
              {item.tab !== "video" && item.tab !== "auto" && (
                <ActionBtn title="Improve Video" onClick={() => setShowEditModal(true)} bg={ACTION.edit}>
                  <Pencil className="w-3.5 h-3.5" strokeWidth={2.4} />
                </ActionBtn>
              )}
              <SaveTrafficLight
                saved={saved}
                saving={saving}
                expiryDays={expiryDays}
                onSave={handleSave}
                isStorytelling={item.type === "fairytale" || item.type === "fairytale-scene"}
                showValidity={
                  // Show the Xd countdown chip for any time-bounded media:
                  //   • storytelling videos / scene images (vanish at ≤1d via early-cutoff)
                  //   • UGC videos (type='video' on tab='video' — fal.media TTL not guaranteed)
                  //   • Auto Content videos (tab='auto')
                  //   • Cinema videos (tab='cinema')
                  // We skip pure-image rows (the user said earlier "we already use storage" for those).
                  item.type === "fairytale" ||
                  item.type === "fairytale-scene" ||
                  item.type === "video"
                }
              />
              <ActionBtn title="Download" onClick={handleDownload} bg={ACTION.download}>
                <Download className="w-3.5 h-3.5" strokeWidth={2.4} />
              </ActionBtn>
              <ActionBtn title="Delete" onClick={handleDelete} bg={ACTION.delete} disabled={deleting}>
                <Trash2 className="w-3.5 h-3.5" strokeWidth={2.4} />
              </ActionBtn>
            </>
          )}

          {/* FAILED — Retry + Delete (Storytelling merged videos skip
              Resubmit because the render is expensive (~60s+ Modal
              compute), and the recheck icon at top-right already
              handles the common case where Modal succeeded but the
              row got stuck. Resubmit here would just spend money
              re-rendering what may already exist in B2). */}
          {item.status === "failed" && (
            <>
              {item.type !== "fairytale" && (
                <button
                  onClick={handleRetry}
                  disabled={checking}
                  title="Resubmit"
                  className="flex-1 h-7 rounded-lg text-[9px] font-extrabold uppercase tracking-wider text-white flex items-center justify-center gap-1 disabled:opacity-50 transition-transform hover:scale-105"
                  style={{ background: ACTION.retry, boxShadow: "0 2px 6px rgba(34,197,94,0.4)" }}
                >
                  {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <><RotateCw className="w-3 h-3" />Resubmit</>}
                </button>
              )}
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

      {/* Prompt modal — shows the active segment's prompt so opening
          the modal while viewing Seg 2 displays seg-2's text, not
          seg-1's. */}
      {showPromptModal && (item.prompt || seg2?.prompt) && (
        <PromptModal
          prompt={
            (activeSlide?.id === "seg_1" ? seg2?.prompt : null) ||
            item.prompt ||
            ""
          }
          onClose={() => setShowPromptModal(false)}
        />
      )}

      {/* Transfer-to-Attachments — asks the user which category to save
          this image under, then POSTs to /api/attachments/transfer. */}
      {showTransferModal && (
        <CategoryPickModal
          fileCount={0}
          title="Save to Attachments as…"
          onPick={(cat) => handleTransfer(cat)}
          onClose={() => setShowTransferModal(false)}
        />
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
          // Pass the original first-video prompt so the modal can re-use
          // the scene context (character / setting / wardrobe / product
          // locks). The user only types fresh dialog for segment 2.
          originalPrompt={item.prompt || ""}
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

// React.memo with a shallow equality check on the fields that actually
// drive a re-render. The History grid polls every 15s and replaces the
// whole `items` array, but for most rows nothing changed — without this
// memo every card re-renders on every poll, which is why status-flip
// felt like the entire grid flickered.
const HistoryCard = memo(HistoryCardInner, (prev, next) => {
  return (
    prev.item.id === next.item.id &&
    prev.item.status === next.item.status &&
    prev.item.output_url === next.item.output_url &&
    prev.item.merged_url === next.item.merged_url &&
    prev.item.caption === next.item.caption &&
    prev.item.error_message === next.item.error_message &&
    prev.seg2?.id === next.seg2?.id &&
    prev.seg2?.status === next.seg2?.status &&
    prev.seg2?.output_url === next.seg2?.output_url &&
    prev.saveStatus?.saved === next.saveStatus?.saved &&
    prev.saveStatus?.storage_id === next.saveStatus?.storage_id &&
    prev.transferred === next.transferred &&
    prev.mergeSupported === next.mergeSupported &&
    prev.mergeSelectedIdx === next.mergeSelectedIdx
    // Intentionally NOT comparing onToggleMerge — the parent passes an
    // inline lambda that's a new ref every render, but it always closes
    // over the same `item.id` and a stable setState, so the old ref is
    // safe to keep. Re-rendering just because the lambda identity flipped
    // would defeat the point of this memo.
  );
});

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
  const [attachmentOpen, setAttachmentOpen] = useState(false);

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
          <div className="flex items-stretch gap-2">
            {/* Preview thumbnail (Attachment URL OR picked-from-history URL) */}
            <button
              type="button"
              onClick={() => setAttachmentOpen(true)}
              className="relative w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
              style={{
                border: extraRefUrl ? "2px solid #b388ff" : "2px dashed #d8e8d0",
                background: extraRefUrl ? "#000" : "#fafaf7",
              }}
              aria-label={extraRefUrl ? "Replace image" : "Pick image from Attachments"}
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
                onClick={() => setAttachmentOpen(true)}
                className="px-3 py-1.5 rounded-md text-[10px] font-bold"
                style={{ background: "#fafaf7", border: "1px solid #d8e8d0", color: "#1a1a1a" }}
              >
                Attachments
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

          <AttachmentPicker
            open={attachmentOpen}
            onClose={() => setAttachmentOpen(false)}
            onPick={(a: { public_url: string }) => {
              setExtraRefUrl(a.public_url);
              setAttachmentOpen(false);
            }}
          />
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

// Validity indicator — DISPLAY ONLY.
// Since every generation now auto-saves to peninglab-content with a
// 30-day B2 lifecycle, the manual "Save permanently" action is gone.
// This component is left in place as a pure countdown badge so users
// still see at-a-glance how long they have before the file auto-deletes.
//
// Color tiers:
//   YELLOW — plenty of time left (>3 days)
//   RED    — close to TTL (≤3 days)
//   DARK   — already past 30-day TTL
//
// Not clickable. No tooltip implying "click to save". Props for the old
// save flow (saved / saving / onSave) are kept in the signature for
// backwards-compat with all call sites, but ignored.
function SaveTrafficLight({
  expiryDays,
  isStorytelling,
  showValidity,
}: {
  saved?: boolean;
  saving?: boolean;
  expiryDays: number | null;
  onSave?: () => void;
  isStorytelling?: boolean;
  showValidity?: boolean;
}) {
  const expired = expiryDays !== null && expiryDays <= 0;
  const urgent = !expired && expiryDays !== null && expiryDays <= 3;
  const tierBg = expired
    ? "#52525b"        // dark gray — past TTL
    : urgent
      ? "#ef4444"      // red — soon expires
      : "#facc15";     // yellow — default
  const tierTitle = expired
    ? "Past 30-day TTL — file auto-deleted by B2 lifecycle"
    : `${expiryDays} day${expiryDays === 1 ? "" : "s"} until B2 auto-delete`;

  return (
    <div
      title={tierTitle}
      className="w-7 h-7 rounded-lg flex items-center justify-center relative pointer-events-none select-none"
      style={{
        background: tierBg,
        boxShadow: urgent
          ? "0 0 0 2px rgba(239,68,68,0.35), 0 2px 4px rgba(0,0,0,0.3)"
          : "0 2px 4px rgba(0,0,0,0.3)",
        color: tierBg === "#facc15" ? "#1a1a1a" : "white",
      }}
    >
      <CloudUpload className="w-3.5 h-3.5" strokeWidth={2.4} />
      {(showValidity || isStorytelling) && !expired && expiryDays !== null && (
        <span
          className="absolute -top-1 -right-1 text-[8px] font-extrabold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-1 leading-none"
          style={{
            background: urgent ? "#7f1d1d" : "#854d0e",
            color: "white",
            border: "1.5px solid var(--color-bg)",
          }}
        >
          {expiryDays}d
        </span>
      )}
    </div>
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
  // Required fresh product upload — replaces the auto-reuse of the
  // source row's referenceUrl. Same pattern as the Extend modal: every
  // Improve run gets a clean, freshly-uploaded product photo so Veo's
  // r2v anchor never relies on an expired Crun temp URL.
  const [overrideProductDataUrl, setOverrideProductDataUrl] = useState<string>("");
  const [attachmentOpen, setAttachmentOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  function handleProductUpload(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setOverrideProductDataUrl(String(reader.result || ""));
    reader.readAsDataURL(file);
  }

  // data: → public URL via /api/upload/image (RunningHub passthrough)
  async function ensurePublicUrl(v: string): Promise<string> {
    if (!v) return "";
    if (!v.startsWith("data:")) return v;
    const blob = await (await fetch(v)).blob();
    const fd = new FormData();
    fd.append("file", blob, "improve-product.png");
    const r = await fetch("/api/upload/image", { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok || !d?.url) throw new Error(d?.error || "Upload failed");
    return d.url;
  }

  async function generate() {
    const text = suggestion.trim();
    if (!text) return alert("Please write an improvement suggestion");
    if (!overrideProductDataUrl) {
      return alert("Product reference image is required — upload the product photo above before generating.");
    }
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
      // Upload the fresh product photo to RunningHub first so Crun
      // gets a permanent download_url for the r2v reference. Then
      // route through /api/generate/extend (same path as before) with
      // the new URL as start_frame_url for ingredient mode.
      let resolvedProductUrl = "";
      try {
        resolvedProductUrl = await ensurePublicUrl(overrideProductDataUrl);
      } catch (e: any) {
        throw new Error(`Product image upload failed: ${e?.message || e}`);
      }

      const body: any = {
        parent_id: parentId,
        continuation_prompt: improvedPrompt,
        image_mode: imageMode,
      };
      if (imageMode === "ingredient") {
        body.start_frame_url = resolvedProductUrl;
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
          {/* Product Reference upload — REQUIRED. Replaces the static
              re-use of the source row's referenceUrl since old rows
              often have expired Tencent temp URLs. User uploads a
              fresh shot of the product so Veo gets a clean pixel
              anchor every Improve run. */}
          <label className="block text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: overrideProductDataUrl ? "#666" : "#d97706" }}>
            Product Reference (required) {!overrideProductDataUrl && "*"}
          </label>
          <div className="text-[10px] text-gray-500 mb-2 leading-relaxed">
            Upload the product photo Veo should lock onto for the improved video. PNG / JPG.
          </div>
          {overrideProductDataUrl ? (
            <div
              className="flex items-center gap-3 p-2.5 rounded-lg mb-4"
              style={{ background: "rgba(124,77,255,0.08)", border: "1px solid rgba(124,77,255,0.3)" }}
            >
              <img
                src={overrideProductDataUrl}
                alt=""
                className="w-16 h-20 object-cover rounded-md flex-shrink-0"
                style={{ border: "1px solid #e8e0d8" }}
              />
              <div className="flex-1 min-w-0 text-[11px] leading-relaxed">
                <div className="font-extrabold uppercase tracking-wider mb-0.5" style={{ color: "#7c4dff" }}>
                  Product reference attached
                </div>
                <div className="text-gray-600">
                  Sent directly to Veo when you click Generate (no re-upload).
                </div>
              </div>
              <button
                onClick={() => setOverrideProductDataUrl("")}
                className="text-[10px] px-2 py-1 rounded text-gray-500 hover:text-gray-900 font-bold"
              >
                Clear
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAttachmentOpen(true)}
              className="w-full px-3 py-3 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-2 mb-4"
              style={{
                background: "#fafaf7",
                color: "#7c4dff",
                border: "1.5px dashed rgba(124,77,255,0.4)",
              }}
            >
              <Upload className="w-4 h-4" />
              Pick product image from Attachments
            </button>
          )}
          <AttachmentPicker
            open={attachmentOpen}
            onClose={() => setAttachmentOpen(false)}
            onPick={(a: { public_url: string }) => {
              setOverrideProductDataUrl(a.public_url);
              setAttachmentOpen(false);
            }}
          />

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
            disabled={submitting || !overrideProductDataUrl || !suggestion.trim()}
            title={
              !overrideProductDataUrl
                ? "Upload the product reference image first"
                : !suggestion.trim()
                  ? "Write an improvement suggestion"
                  : ""
            }
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

// ──────────────────────────────────────────────────────────────────────────
// Storytelling drafts pane — renders inside the Storytelling history grid
// when the Drafts sub-tab is active. Lists unfinished wizard sessions
// (rows from fairytale_drafts) so the user can resume editing.
//
// Click a draft → fetches the full state from GET /api/fairytale/drafts/[id]
// → fires a "storytelling:resume-draft" CustomEvent that the FairytaleTab
// listens for. FairytaleTab hydrates every wizard field from the state
// blob and jumps to the saved step. Drafts persist across browser close
// + device switch; merging a draft does NOT delete it (the user can
// reopen the same draft to iterate on a new variation).
// ──────────────────────────────────────────────────────────────────────────

type DraftListItem = {
  id: string;
  title: string;
  step: number;
  updated_at: string;
  created_at: string;
  thumb_url: string | null;
  scene_count: number;
};

function StorytellingDraftsPane({ projectId }: { projectId?: string | null }) {
  const [drafts, setDrafts] = useState<DraftListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    try {
      // Scope drafts to the current project so the Projects sub-tab on
      // NUR only shows drafts saved under NUR (not EXCLUSIVE / Project 1).
      // Matches the rest of the history grid which is also project-scoped.
      const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
      const r = await fetch(`/api/fairytale/drafts${qs}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        setError(d?.error || `HTTP ${r.status}`);
        setDrafts([]);
        return;
      }
      setDrafts(d.drafts || []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load drafts");
      setDrafts([]);
    }
  }
  useEffect(() => {
    void load();
    // Re-fetch when the active project changes so switching tabs
    // (NUR → EXCLUSIVE) immediately reloads the correct draft list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function resume(d: DraftListItem) {
    if (resumingId) return;
    setResumingId(d.id);
    try {
      const r = await fetch(`/api/fairytale/drafts/${d.id}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.ok) {
        alert(`Resume failed: ${j?.error || `HTTP ${r.status}`}`);
        return;
      }
      // Fire the event FairytaleTab listens for. Detail carries the full
      // draft object (id, step, state) so the tab can hydrate every field.
      window.dispatchEvent(
        new CustomEvent("storytelling:resume-draft", { detail: j.draft })
      );
      // Scroll to the top so the user sees the wizard restored.
      try {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch {}
    } catch (e: any) {
      alert(`Resume failed: ${e?.message || "network"}`);
    } finally {
      setResumingId(null);
    }
  }

  async function deleteDraft(d: DraftListItem) {
    if (deletingId) return;
    if (!confirm(`Padam project "${d.title}"? Tindakan ini tidak boleh undo.`)) return;
    setDeletingId(d.id);
    try {
      const r = await fetch(`/api/fairytale/drafts/${d.id}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        alert(`Delete failed: ${j?.error || `HTTP ${r.status}`}`);
        return;
      }
      setDrafts((prev) => (prev || []).filter((x) => x.id !== d.id));
    } finally {
      setDeletingId(null);
    }
  }

  if (drafts === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--color-text-muted)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16 text-sm text-red-400">
        Failed to load drafts: {error}
      </div>
    );
  }

  if (drafts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
          style={{
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
          }}
        >
          <Copy className="w-7 h-7 text-[var(--color-text-muted)]" />
        </div>
        <p className="text-[var(--color-text-secondary)] font-medium mb-1">
          Tiada project lagi.
        </p>
        <p className="text-sm text-[var(--color-text-muted)] max-w-md">
          Bila kau click <b>Preview</b> kat Storytelling wizard, kerja kau
          auto-save jadi project. Boleh sambung balik dari sini bila-bila masa.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {drafts.map((d) => {
        const isResuming = resumingId === d.id;
        const isDeleting = deletingId === d.id;
        const updatedAt = new Date(d.updated_at);
        const updatedAgo = formatAgo(updatedAt);
        return (
          <div
            key={d.id}
            className="rounded-xl overflow-hidden border flex flex-col"
            style={{
              background: "var(--color-bg-card)",
              borderColor: "var(--color-border)",
            }}
          >
            <button
              type="button"
              onClick={() => resume(d)}
              disabled={isResuming}
              className="aspect-[9/16] bg-black relative flex items-center justify-center text-center transition hover:opacity-90 disabled:opacity-50"
              title="Click to resume editing"
            >
              {d.thumb_url ? (
                <img
                  src={d.thumb_url}
                  alt=""
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex flex-col items-center text-white/50 px-3">
                  <Copy className="w-8 h-8 mb-2" />
                  <span className="text-[10px]">No preview</span>
                </div>
              )}
              {isResuming && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <Loader2 className="w-6 h-6 animate-spin text-white" />
                </div>
              )}
              {/* PROJECT badge top-left */}
              <span
                className="absolute top-1.5 left-1.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{
                  background: "rgba(245,158,11,0.92)",
                  color: "white",
                }}
              >
                📝 Project
              </span>
            </button>
            <div className="p-2.5 flex flex-col gap-1.5">
              <div
                className="text-[11px] font-semibold truncate"
                style={{ color: "var(--color-text-primary)" }}
                title={d.title}
              >
                {d.title}
              </div>
              <div className="text-[10px] text-[var(--color-text-muted)] flex items-center justify-between">
                <span>{d.scene_count} scene{d.scene_count === 1 ? "" : "s"}</span>
                <span title={updatedAt.toLocaleString()}>{updatedAgo}</span>
              </div>
              <div className="flex gap-1.5 mt-1">
                <button
                  type="button"
                  onClick={() => resume(d)}
                  disabled={isResuming}
                  className="flex-1 h-7 rounded-lg text-[9px] font-extrabold uppercase tracking-wider text-white flex items-center justify-center gap-1 disabled:opacity-50"
                  style={{
                    background: "linear-gradient(135deg, #a855f7, #c084fc)",
                  }}
                >
                  {isResuming ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <>
                      <RotateCw className="w-3 h-3" /> Continue
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => deleteDraft(d)}
                  disabled={isDeleting}
                  title="Delete project permanently"
                  className="w-8 h-7 rounded-lg flex items-center justify-center disabled:opacity-50"
                  style={{
                    background: "rgba(239,68,68,0.12)",
                    border: "1px solid rgba(239,68,68,0.35)",
                    color: "#fca5a5",
                  }}
                >
                  {isDeleting ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Trash2 className="w-3 h-3" />
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatAgo(d: Date): string {
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}
