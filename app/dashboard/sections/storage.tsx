"use client";

import { useEffect, useMemo, useState } from "react";
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

// Storage section — lists every file the user has saved into their B2
// folder, mirrors the History grid layout (3-4 cols of cards) but
// pulls from /api/storage/list instead of the Supabase history table.
// Each card has Open + Download + Delete + the cached signed URL.

type StorageItem = {
  id: string;
  history_id: string | null;
  type: string;
  b2_key: string;
  size_bytes: number;
  content_type: string | null;
  cached_url: string | null;
  created_at: string;
};

// Only types that produce a final user-facing media asset are savable.
// Fairytale SCENES (the 10 per-scene image generations that the wizard
// concatenates into the merged mp4) are intentionally NOT savable —
// users should save the merged final video, not the intermediate frames.
// Clone Prompt rows have no media at all, so no Save button + no filter.
// Cinema/Story chip removed — Story tab was hidden from the project bar.
// Existing rows of type='cinema' (the old Story tab) won't appear in any
// chip but are still queryable via "All".
const TYPE_FILTERS: { id: string; label: string }[] = [
  { id: "all",          label: "All" },
  { id: "image",        label: "Image" },
  { id: "video",        label: "UGC" },
  { id: "auto",         label: "Auto Content" },
  { id: "seedance",     label: "Cinema" },
  { id: "fairytale",    label: "Storytelling" },
];

function fmtMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}

export default function StorageSection() {
  const [items, setItems] = useState<StorageItem[]>([]);
  const [usedMb, setUsedMb] = useState(0);
  const [quotaMb, setQuotaMb] = useState(1024);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const r = await fetch("/api/storage/list", { credentials: "include", cache: "no-store" });
      const d = await r.json();
      if (!r.ok || !d?.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      setItems(d.items || []);
      setUsedMb(d.used_mb || 0);
      setQuotaMb(d.quota_mb || 1024);
    } catch (e: any) {
      setError(e?.message || "Failed to load storage");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const onSaved = () => void load();
    window.addEventListener("storage:saved", onSaved);
    return () => window.removeEventListener("storage:saved", onSaved);
  }, []);

  const filtered = useMemo(
    () => filter === "all" ? items : items.filter((i) => i.type === filter),
    [items, filter]
  );

  const usedPct = quotaMb > 0 ? Math.min(100, (usedMb / quotaMb) * 100) : 0;

  async function handleDelete(id: string) {
    if (!confirm("Padam fail dari Storage? Tak boleh undo.")) return;
    try {
      const r = await fetch("/api/storage/delete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage_id: id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) {
        alert(`Failed to delete: ${d?.error || `HTTP ${r.status}`}`);
        return;
      }
      // Optimistic remove + refresh quota numbers from server
      setItems((prev) => prev.filter((i) => i.id !== id));
      void load();
    } catch (e: any) {
      alert(`Failed to delete: ${e?.message || "network error"}`);
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
      {loading && (
        <div className="card p-12 text-center">
          <Loader2 className="w-6 h-6 mx-auto animate-spin text-[var(--color-text-muted)]" />
        </div>
      )}
      {!loading && error && (
        <div className="card p-6" style={{ borderColor: "rgba(239,68,68,0.4)" }}>
          <div className="text-sm font-bold text-red-400 mb-1">Couldn't load storage</div>
          <p className="text-xs text-[var(--color-text-secondary)]">{error}</p>
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {filtered.map((it) => (
            <StorageCard key={it.id} item={it} onDelete={() => handleDelete(it.id)} />
          ))}
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
  const isVideo = (item.content_type || "").startsWith("video/") || item.b2_key.endsWith(".mp4") || item.b2_key.endsWith(".webm");
  const isImage = (item.content_type || "").startsWith("image/") || /\.(png|jpg|jpeg|webp)$/i.test(item.b2_key);

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
          {item.type === "fairytale" ? "Storytelling" : item.type}
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
          <button
            onClick={onDelete}
            title="Delete from Storage"
            className="w-6 h-6 rounded flex items-center justify-center hover:scale-110 transition-transform"
            style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.4)", color: "#fca5a5" }}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
