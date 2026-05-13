"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  Trash2,
  Pencil,
  X,
  Check,
  Loader2,
  Image as ImageIcon,
  Package,
  UserCircle2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export type AttachmentCategory = "product" | "avatar";

export type Attachment = {
  id: string;
  name: string;
  category: AttachmentCategory;
  public_url: string;
  source_history_id: string | null;
  content_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  created_at: string;
};

const PAGE_SIZE = 25;

export default function AttachmentsSection() {
  const [items, setItems] = useState<Attachment[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(0);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [filter, setFilter] = useState<"all" | AttachmentCategory>("all");
  // Unfiltered totals — drive the chip counts so the user can see at a
  // glance how many product vs avatar attachments they have, regardless
  // of which filter is active.
  const [counts, setCounts] = useState({ all: 0, product: 0, avatar: 0 });
  // Pending files awaiting category choice — set when user picks files
  // or drops them, cleared once they finish the category modal.
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const refreshCounts = useCallback(async () => {
    // Three small parallel HEAD-style fetches (pageSize=1, just for total)
    // — cheaper than scanning everything. Used to drive the chip counts
    // independently of the active filter.
    const fetchTotal = async (cat?: AttachmentCategory) => {
      const qs = new URLSearchParams({ page: "1", pageSize: "1" });
      if (cat) qs.set("category", cat);
      const r = await fetch(`/api/attachments?${qs}`, { credentials: "include" });
      const j = await r.json();
      return j?.ok ? Number(j.total || 0) : 0;
    };
    const [all, product, avatar] = await Promise.all([
      fetchTotal(),
      fetchTotal("product"),
      fetchTotal("avatar"),
    ]);
    setCounts({ all, product, avatar });
  }, []);

  const load = useCallback(
    async (p = 1, cat: "all" | AttachmentCategory = filter) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({
          page: String(p),
          pageSize: String(PAGE_SIZE),
        });
        if (cat !== "all") qs.set("category", cat);
        const r = await fetch(`/api/attachments?${qs}`, { credentials: "include" });
        const j = await r.json();
        if (j.ok) {
          setItems(j.attachments);
          setTotal(j.total);
          setPage(j.page);
        }
      } finally {
        setLoading(false);
      }
      void refreshCounts();
    },
    [filter, refreshCounts]
  );

  useEffect(() => {
    load(1, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const stageFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!arr.length) return;
    setPendingFiles(arr);
  }, []);

  const confirmUpload = useCallback(
    async (category: AttachmentCategory) => {
      const files = pendingFiles || [];
      setPendingFiles(null);
      if (!files.length) return;
      setUploading(files.length);
      const added: Attachment[] = [];
      for (const file of files) {
        try {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("name", file.name.replace(/\.[^.]+$/, ""));
          fd.append("category", category);
          const r = await fetch("/api/attachments/upload", {
            method: "POST",
            body: fd,
            credentials: "include",
          });
          const j = await r.json();
          if (j.ok && j.attachment) added.push(j.attachment);
        } catch (e: any) {
          console.error("Upload error:", e?.message);
        } finally {
          setUploading((n) => Math.max(0, n - 1));
        }
      }
      if (added.length) {
        // If current filter matches, prepend; otherwise just refresh count.
        const visibleAdded =
          filter === "all" ? added : added.filter((a) => a.category === filter);
        setItems((prev) => [...visibleAdded, ...prev].slice(0, PAGE_SIZE));
        setTotal((t) => t + added.length);
        setPage(1);
      }
    },
    [pendingFiles, filter]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      stageFiles(e.dataTransfer.files);
    },
    [stageFiles]
  );

  const onFilePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) stageFiles(e.target.files);
      e.target.value = "";
    },
    [stageFiles]
  );

  const startRename = (a: Attachment) => {
    setRenamingId(a.id);
    setRenameValue(a.name);
  };

  const saveRename = async (id: string) => {
    const name = renameValue.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    setRenamingId(null);
    const r = await fetch(`/api/attachments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      credentials: "include",
    });
    const j = await r.json();
    if (j.ok) {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, name: j.attachment.name } : it)));
    }
  };

  const toggleCategory = async (a: Attachment) => {
    const next: AttachmentCategory = a.category === "product" ? "avatar" : "product";
    const r = await fetch(`/api/attachments/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: next }),
      credentials: "include",
    });
    const j = await r.json();
    if (j.ok) {
      // If we're filtering and the new category no longer matches, drop it.
      setItems((prev) => {
        const updated = prev.map((it) => (it.id === a.id ? { ...it, category: next } : it));
        return filter === "all" ? updated : updated.filter((it) => it.category === filter);
      });
      // Notify other surfaces that attachments changed so they can
      // refetch (e.g. the image tab's transferred-set indicator).
      window.dispatchEvent(new CustomEvent("attachments:changed"));
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this attachment? This can't be undone.")) return;
    const r = await fetch(`/api/attachments/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    const j = await r.json();
    if (j.ok) {
      setItems((prev) => prev.filter((it) => it.id !== id));
      setTotal((t) => Math.max(0, t - 1));
      window.dispatchEvent(new CustomEvent("attachments:changed"));
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-text-secondary)" }}>
            Attachments
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
            Upload product photos and avatar references once. Pick them from any tab — no more re-uploading.
          </p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ background: "var(--color-orange)", color: "white" }}
        >
          <Upload className="w-4 h-4" /> Add Image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={onFilePick}
        />
      </div>

      {/* Category filter chips */}
      <div className="flex items-center gap-2 mb-4">
        <CategoryChip
          active={filter === "all"}
          onClick={() => setFilter("all")}
          icon={null}
          label={`All (${counts.all})`}
        />
        <CategoryChip
          active={filter === "product"}
          onClick={() => setFilter("product")}
          icon={<Package className="w-3.5 h-3.5" />}
          label={`Product (${counts.product})`}
        />
        <CategoryChip
          active={filter === "avatar"}
          onClick={() => setFilter("avatar")}
          icon={<UserCircle2 className="w-3.5 h-3.5" />}
          label={`Avatar (${counts.avatar})`}
        />
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className="rounded-xl border-2 border-dashed mb-6 px-6 py-8 text-center transition"
        style={{
          borderColor: dragOver ? "var(--color-orange)" : "var(--color-border)",
          background: dragOver ? "rgba(255,87,34,0.08)" : "transparent",
        }}
      >
        <ImageIcon className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--color-text-muted)" }} />
        <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          {uploading > 0
            ? `Adding ${uploading} image${uploading > 1 ? "s" : ""}…`
            : "Drag and drop images here, or click Add Image above"}
        </p>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--color-orange)" }} />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16" style={{ color: "var(--color-text-muted)" }}>
          <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No attachments here yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {items.map((a) => (
            <div
              key={a.id}
              className="group relative rounded-lg overflow-hidden border"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <button
                onClick={() => setViewing(a)}
                className="block w-full aspect-square bg-black/40 relative"
                aria-label={`View ${a.name}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.public_url}
                  alt={a.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <span
                  className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
                  style={{
                    background:
                      a.category === "avatar" ? "rgba(34,197,94,0.85)" : "rgba(245,158,11,0.85)",
                    color: "white",
                  }}
                >
                  {a.category === "avatar" ? (
                    <UserCircle2 className="w-3 h-3" />
                  ) : (
                    <Package className="w-3 h-3" />
                  )}
                  {a.category}
                </span>
              </button>
              <div className="px-2 py-2 flex items-center gap-1">
                {renamingId === a.id ? (
                  <>
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveRename(a.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="flex-1 min-w-0 px-2 py-1 rounded text-xs"
                      style={{
                        background: "var(--color-surface-hover)",
                        color: "var(--color-text-secondary)",
                        border: "1px solid var(--color-border)",
                      }}
                    />
                    <button
                      onClick={() => saveRename(a.id)}
                      className="p-1 rounded hover:bg-white/10"
                      style={{ color: "var(--color-orange)" }}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <span
                      className="flex-1 text-xs font-semibold truncate"
                      title={a.name}
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {a.name}
                    </span>
                    <button
                      onClick={() => toggleCategory(a)}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition"
                      style={{ color: "var(--color-text-muted)" }}
                      title={`Switch to ${a.category === "product" ? "avatar" : "product"}`}
                    >
                      {a.category === "product" ? (
                        <UserCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <Package className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => startRename(a)}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition"
                      style={{ color: "var(--color-text-muted)" }}
                      title="Rename"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => remove(a.id)}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition"
                      style={{ color: "var(--color-text-muted)" }}
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            onClick={() => load(page - 1)}
            disabled={page <= 1}
            className="p-2 rounded disabled:opacity-30"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => load(page + 1)}
            disabled={page >= totalPages}
            className="p-2 rounded disabled:opacity-30"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* View modal */}
      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.85)" }}
          onClick={() => setViewing(null)}
        >
          <div className="relative max-w-5xl max-h-full" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setViewing(null)}
              className="absolute -top-12 right-0 p-2 rounded text-white/80 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={viewing.public_url}
              alt={viewing.name}
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
            />
            <div className="mt-3 text-center text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>
              {viewing.name}
            </div>
          </div>
        </div>
      )}

      {/* Category-pick modal — gates every upload */}
      {pendingFiles && (
        <CategoryPickModal
          fileCount={pendingFiles.length}
          onPick={confirmUpload}
          onClose={() => setPendingFiles(null)}
        />
      )}
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition"
      style={
        active
          ? { background: "var(--color-orange)", color: "white" }
          : {
              background: "var(--color-surface)",
              color: "var(--color-text-secondary)",
              border: "1px solid var(--color-border)",
            }
      }
    >
      {icon}
      {label}
    </button>
  );
}

// Modal shown after the user picks/drops files but before they upload.
// Forces a category choice so we don't end up with "uncategorised" rows.
export function CategoryPickModal({
  fileCount,
  onPick,
  onClose,
  title = "What kind of image?",
}: {
  fileCount: number;
  onPick: (category: AttachmentCategory) => void;
  onClose: () => void;
  title?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl overflow-hidden"
        style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-5 py-3 flex items-center justify-between border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h3 className="text-base font-bold" style={{ color: "var(--color-text-secondary)" }}>
            {title}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {fileCount > 0 && (
            <p className="text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>
              Categorise {fileCount} image{fileCount > 1 ? "s" : ""} so the picker can filter them later.
            </p>
          )}
          <button
            onClick={() => onPick("product")}
            className="w-full flex items-center gap-3 p-4 rounded-lg text-left transition hover:bg-white/5"
            style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
          >
            <Package className="w-6 h-6" style={{ color: "#f59e0b" }} />
            <div>
              <div className="text-sm font-bold" style={{ color: "var(--color-text-secondary)" }}>
                Product
              </div>
              <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Packaging, label, hero shot — anything Veo locks onto as the product
              </div>
            </div>
          </button>
          <button
            onClick={() => onPick("avatar")}
            className="w-full flex items-center gap-3 p-4 rounded-lg text-left transition hover:bg-white/5"
            style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
          >
            <UserCircle2 className="w-6 h-6" style={{ color: "#22c55e" }} />
            <div>
              <div className="text-sm font-bold" style={{ color: "var(--color-text-secondary)" }}>
                Avatar
              </div>
              <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Face / character reference — used to lock identity in UGC + Cinema
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
