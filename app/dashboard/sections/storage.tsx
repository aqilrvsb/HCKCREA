"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  HardDrive,
  Loader2,
  Trash2,
  Download,
  Filter,
  Image as ImageIcon,
  Video as VideoIcon,
  Sparkles,
} from "lucide-react";
import { fetchStorageList } from "@/lib/swr-fetchers";
import SkeletonCard from "@/app/components/skeleton-card";

// Storage section — lists every file the user has saved into their B2
// folder, mirrors the History grid layout (3-4 cols of cards) but
// pulls from /api/storage/list instead of the Supabase history table.
// Each card has Open + Download + Delete + the cached signed URL.

type StorageItem = {
  id: string;
  history_id: string | null;
  type: string;
  b2_key: string | null;
  size_bytes: number;
  content_type: string | null;
  cached_url: string | null;
  created_at: string;
  // Set on rows synthesized from history (storytelling videos + scene
  // images that auto-surface even without an explicit Save click).
  // Frontend hides the Delete button on these because they're owned
  // by the history table, not storage.
  synthetic?: boolean;
  thumbnail_url?: string | null;
};

// Filter chips. Storytelling rows ONLY appear here once the user
// clicks Save on a card — auto-synthesis was reverted because users
// wanted Storage to be "things I chose to keep", not "everything I
// ever generated". So we keep the two storytelling chips so saved
// rows can be filtered, but Storage won't be pre-populated with
// every scene image automatically.
// Cinema/Story chip — old "cinema" rows still queryable via "All".
const TYPE_FILTERS: { id: string; label: string }[] = [
  { id: "all",                label: "All" },
  { id: "image",              label: "Image" },
  { id: "video",              label: "UGC" },
  { id: "auto",               label: "Auto Content" },
  { id: "seedance",           label: "Cinema" },
  { id: "fairytale",          label: "Storytelling Videos" },
  { id: "fairytale-scene",    label: "Storytelling Images" },
];

function fmtMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}

export default function StorageSection() {
  const [filter, setFilter] = useState("all");

  const {
    data: listData,
    error,
    isLoading: loading,
    mutate: mutateList,
  } = useSWR("storage:list", fetchStorageList, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  });
  const items = (listData?.items ?? []) as StorageItem[];
  const usedMb = listData?.used_mb ?? 0;
  const quotaMb = listData?.quota_mb ?? 1024;

  useEffect(() => {
    const onSaved = () => { void mutateList(); };
    window.addEventListener("storage:saved", onSaved);
    return () => window.removeEventListener("storage:saved", onSaved);
  }, [mutateList]);

  const filtered = useMemo(
    () => filter === "all" ? items : items.filter((i) => i.type === filter),
    [items, filter]
  );

  const usedPct = quotaMb > 0 ? Math.min(100, (usedMb / quotaMb) * 100) : 0;

  // Virtualized grid — only the rows currently in view (plus a small
  // overscan) are kept mounted. Storage list is one-shot (no infinite
  // scroll), so the virtualizer just windows what's already in memory.
  const storageScrollRef = useRef<HTMLDivElement | null>(null);
  const storageVirtualizer = useVirtualizer({
    count: Math.ceil(filtered.length / 4),
    getScrollElement: () => storageScrollRef.current,
    estimateSize: () => 280,
    overscan: 2,
  });

  async function handleDelete(id: string) {
    if (!confirm("Padam fail dari Storage? Tak boleh undo.")) return;
    try {
      // Optimistic local remove (no revalidate) — keeps the UI snappy.
      mutateList(
        (prev) =>
          prev && {
            ...prev,
            items: prev.items.filter((i: any) => i.id !== id),
          },
        false
      );
      const r = await fetch("/api/storage/delete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage_id: id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) {
        alert(`Failed to delete: ${d?.error || `HTTP ${r.status}`}`);
        // Roll back by re-fetching authoritative state.
        await mutateList();
        return;
      }
      // Refresh quota numbers from server.
      await mutateList();
    } catch (e: any) {
      alert(`Failed to delete: ${e?.message || "network error"}`);
      await mutateList();
    }
  }

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <HardDrive className="w-4 h-4" style={{ color: "var(--color-orange)" }} />
          <h1 className="font-display font-extrabold text-2xl tracking-tight text-[var(--color-text-primary)]">
            Storage
          </h1>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Permanent backup of your generations. Saved files stay even after the 14-day TTL.
        </p>
      </div>

      {/* Quota bar — Total / Used / Remaining */}
      <div className="card p-5 mb-5">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <span className="text-xs font-mono uppercase tracking-wider font-bold text-[var(--color-text-muted)]">
            Storage
          </span>
          <div className="flex items-center gap-4 text-xs font-mono">
            <span className="text-[var(--color-text-secondary)]">
              <span className="opacity-60">Total</span> <span className="font-bold">{quotaMb} MB</span>
            </span>
            <span className="text-[var(--color-text-secondary)]">
              <span className="opacity-60">Used</span> <span className="font-bold">{usedMb.toFixed(2)} MB</span>
            </span>
            <span className="text-[var(--color-text-secondary)]">
              <span className="opacity-60">Free</span>{" "}
              <span className="font-bold" style={{ color: usedPct > 90 ? "#ef4444" : "var(--color-orange)" }}>
                {Math.max(0, quotaMb - usedMb).toFixed(2)} MB
              </span>
            </span>
          </div>
        </div>
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--color-bg-card)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${usedPct}%`,
              background: usedPct > 90 ? "#ef4444" : usedPct > 70 ? "#f59e0b" : "var(--color-orange)",
            }}
          />
        </div>
        <div className="text-[10px] text-[var(--color-text-muted)] mt-1.5">
          {items.length} files saved · {usedPct.toFixed(1)}% of quota used · quota set by admin
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <Filter className="w-3.5 h-3.5" style={{ color: "var(--color-text-muted)" }} />
        {TYPE_FILTERS.map((t) => {
          const active = filter === t.id;
          const count = t.id === "all" ? items.length : items.filter((i) => i.type === t.id).length;
          return (
            <button
              key={t.id}
              onClick={() => setFilter(t.id)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all"
              style={
                active
                  ? { background: "var(--color-orange)", color: "#000" }
                  : { background: "var(--color-bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }
              }
            >
              {t.label} {count > 0 && <span className="opacity-60 ml-1">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Loading / Error / Empty */}
      {loading && items.length === 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}
      {!loading && error && (
        <div className="card p-6" style={{ borderColor: "rgba(239,68,68,0.4)" }}>
          <div className="text-sm font-bold text-red-400 mb-1">Couldn't load storage</div>
          <p className="text-xs text-[var(--color-text-secondary)]">
            {(error as any)?.message || "Failed to load storage"}
          </p>
        </div>
      )}
      {!loading && !error && filtered.length === 0 && (
        <div className="card p-12 text-center">
          <HardDrive className="w-10 h-10 mx-auto text-[var(--color-text-muted)] mb-3" />
          <div className="font-bold mb-1 text-[var(--color-text-primary)]">No saved files yet</div>
          <p className="text-xs text-[var(--color-text-secondary)] max-w-md mx-auto">
            Click the cloud icon ☁️ on any history card to save it here permanently.
            Files in Storage stay forever — temp URLs in History expire after 14 days.
          </p>
        </div>
      )}

      {/* Grid */}
      {!loading && !error && filtered.length > 0 && (
        <div
          ref={storageScrollRef}
          className="overflow-y-auto"
          style={{ height: "calc(100vh - 320px)", contain: "layout paint" }}
        >
          <div
            style={{
              height: `${storageVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {storageVirtualizer.getVirtualItems().map((vrow) => {
              const startIdx = vrow.index * 4;
              const rowItems = filtered.slice(startIdx, startIdx + 4);
              return (
                <div
                  key={vrow.key}
                  ref={(el) => storageVirtualizer.measureElement(el)}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    transform: `translateY(${vrow.start}px)`,
                    width: "100%",
                  }}
                >
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pb-3">
                    {rowItems.map((it) => (
                      <StorageCard
                        key={it.id}
                        item={it}
                        onDelete={() => handleDelete(it.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StorageCard({
  item,
  onDelete,
}: {
  item: StorageItem;
  onDelete: () => void;
}) {
  // Synthetic storytelling items have no b2_key — fall back to type +
  // content_type. Real storage items have a key whose suffix tells us
  // the format reliably even when content_type is missing.
  const key = item.b2_key || "";
  const isVideo =
    (item.content_type || "").startsWith("video/") ||
    item.type === "fairytale" ||
    key.endsWith(".mp4") || key.endsWith(".webm");
  const isImage =
    (item.content_type || "").startsWith("image/") ||
    item.type === "fairytale-scene" ||
    /\.(png|jpg|jpeg|webp)$/i.test(key);

  return (
    <div className="card p-0 overflow-hidden">
      <div className="aspect-square relative" style={{ background: "var(--color-bg-card)" }}>
        {item.cached_url && isImage && (
          <img
            src={item.cached_url}
            alt=""
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        )}
        {item.cached_url && isVideo && (
          <video
            src={item.cached_url}
            controls
            playsInline
            preload="metadata"
            className="w-full h-full object-cover"
          />
        )}
        {!item.cached_url && (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--color-text-muted)]">
            {isImage ? <ImageIcon className="w-6 h-6" /> : isVideo ? <VideoIcon className="w-6 h-6" /> : <Sparkles className="w-6 h-6" />}
          </div>
        )}
        <div
          className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider"
          style={{ background: "rgba(0,0,0,0.6)", color: "white" }}
        >
          {item.type === "fairytale"
            ? "Storytelling"
            : item.type === "fairytale-scene"
              ? "Scene Image"
              : item.type}
        </div>
      </div>
      <div className="p-2 flex items-center justify-between gap-1.5">
        <div className="text-[10px] text-[var(--color-text-muted)] font-mono truncate">
          {fmtMB(item.size_bytes)} MB
        </div>
        <div className="flex gap-1">
          {/* Download icon — images only. Videos get native download via the
              video element's controls when the user plays them. */}
          {isImage && item.cached_url && (
            <a
              href={item.cached_url}
              target="_blank"
              rel="noreferrer"
              title="Download image"
              className="w-6 h-6 rounded flex items-center justify-center hover:scale-110 transition-transform"
              style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
            >
              <Download className="w-3 h-3" />
            </a>
          )}
          {/* Synthetic items (storytelling rows surfaced from history)
              don't have their own storage row — their delete lives on
              the history grid instead. Hide the button here so users
              don't get confused by a no-op. */}
          {!item.synthetic && (
            <button
              onClick={onDelete}
              title="Delete from Storage"
              className="w-6 h-6 rounded flex items-center justify-center hover:scale-110 transition-transform"
              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.4)", color: "#fca5a5" }}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
