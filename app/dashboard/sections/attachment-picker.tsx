"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X,
  Loader2,
  Image as ImageIcon,
  Package,
  UserCircle2,
  ChevronLeft,
  ChevronRight,
  Upload,
  Trash2,
} from "lucide-react";
import type { Attachment, AttachmentCategory } from "./attachments";
import { CategoryPickModal } from "./attachments";

const PAGE_SIZE = 25;

// Shared modal — every tab's "Attachments" button opens this. The grid
// is filtered by a category radio at the top (Product / Avatar / All)
// so each slot only sees the relevant subset of the library.
//
// `defaultCategory` lets callers pre-select the radio for the slot's
// expected category (e.g. UGC avatar slot → "avatar"). The user can
// still toggle if they want.
export default function AttachmentPicker({
  open,
  onClose,
  onPick,
  title = "Pick from Attachments",
  defaultCategory = "product",
}: {
  open: boolean;
  onClose: () => void;
  onPick: (a: Attachment) => void;
  title?: string;
  defaultCategory?: AttachmentCategory | "all";
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [filter, setFilter] = useState<AttachmentCategory | "all">(defaultCategory);
  // Pending upload files awaiting category choice — see CategoryPickModal.
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);

  const load = useCallback(
    async (p = 1, cat = filter) => {
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
    },
    [filter]
  );

  // Reset category to caller default + reload when opening.
  useEffect(() => {
    if (open) {
      setFilter(defaultCategory);
      load(1, defaultCategory);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reload when filter chip changes mid-open.
  useEffect(() => {
    if (open) load(1, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Delete from picker without leaving the modal. Same endpoint the
  // Attachments page uses. Optimistic remove from local state + fire
  // the global "attachments:changed" event so the Image-tab transfer
  // buttons revert their state for any cards that referenced this
  // attachment via source_history_id.
  const removeAttachment = useCallback(async (id: string) => {
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
    } else {
      alert(j.error || "Delete failed");
    }
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
          console.error("Picker upload error:", e?.message);
        } finally {
          setUploading((n) => Math.max(0, n - 1));
        }
      }
      if (added.length) {
        // Switch filter to the uploaded category so user sees them
        if (filter !== "all" && filter !== category) {
          setFilter(category);
        } else {
          setItems((prev) => [...added, ...prev].slice(0, PAGE_SIZE));
          setTotal((t) => t + added.length);
          setPage(1);
        }
        window.dispatchEvent(new CustomEvent("attachments:changed"));
      }
    },
    [pendingFiles, filter]
  );

  if (!open) return null;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[90vh] rounded-xl overflow-hidden flex flex-col"
        style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-5 py-3 flex items-center justify-between border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h3 className="text-base font-bold" style={{ color: "var(--color-text-secondary)" }}>
            {title}
          </h3>
          <div className="flex items-center gap-2">
            <label
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold cursor-pointer"
              style={{ background: "var(--color-surface-hover)", color: "var(--color-text-secondary)" }}
            >
              <Upload className="w-3.5 h-3.5" />
              Add new
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const arr = e.target.files
                    ? Array.from(e.target.files).filter((f) => f.type.startsWith("image/"))
                    : [];
                  if (arr.length) setPendingFiles(arr);
                  e.target.value = "";
                }}
              />
            </label>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-white/10">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Category radio */}
        <div
          className="px-5 py-3 flex items-center gap-2 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <FilterPill
            active={filter === "product"}
            onClick={() => setFilter("product")}
            icon={<Package className="w-3.5 h-3.5" />}
            label="Product"
            color="#f59e0b"
          />
          <FilterPill
            active={filter === "avatar"}
            onClick={() => setFilter("avatar")}
            icon={<UserCircle2 className="w-3.5 h-3.5" />}
            label="Avatar"
            color="#22c55e"
          />
          <FilterPill
            active={filter === "all"}
            onClick={() => setFilter("all")}
            icon={null}
            label="All"
            color="#888"
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {uploading > 0 && (
            <div className="mb-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
              Adding {uploading} image{uploading > 1 ? "s" : ""}…
            </div>
          )}
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--color-orange)" }} />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12" style={{ color: "var(--color-text-muted)" }}>
              <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">
                No {filter === "all" ? "attachments" : `${filter}s`} here yet. Click{" "}
                <span className="font-semibold">Add new</span> above to upload one.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {items.map((a) => (
                <div
                  key={a.id}
                  className="group rounded-lg overflow-hidden border hover:border-[var(--color-orange)] transition relative"
                  style={{ borderColor: "var(--color-border)" }}
                  title={a.name}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onPick(a);
                      onClose();
                    }}
                    className="block w-full"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.public_url}
                      alt={a.name}
                      className="w-full aspect-square object-cover bg-black/40"
                      loading="lazy"
                    />
                  </button>
                  <span
                    className="absolute top-1 left-1 inline-flex items-center gap-1 px-1 py-0.5 rounded text-[9px] font-bold uppercase pointer-events-none"
                    style={{
                      background:
                        a.category === "avatar"
                          ? "rgba(34,197,94,0.85)"
                          : "rgba(245,158,11,0.85)",
                      color: "white",
                    }}
                  >
                    {a.category === "avatar" ? (
                      <UserCircle2 className="w-2.5 h-2.5" />
                    ) : (
                      <Package className="w-2.5 h-2.5" />
                    )}
                    {a.category}
                  </span>
                  {/* Inline delete — only visible on hover so it doesn't
                      clutter the grid. Confirmation prompt + window event
                      keeps every other surface in sync. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeAttachment(a.id);
                    }}
                    className="absolute top-1 right-1 w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                    style={{ background: "rgba(239,68,68,0.85)", color: "white" }}
                    title="Delete attachment"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(a);
                      onClose();
                    }}
                    className="block w-full px-2 py-1.5 text-[11px] font-semibold truncate text-left"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    {a.name}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer / pagination */}
        {totalPages > 1 && (
          <div
            className="px-5 py-3 flex items-center justify-center gap-3 border-t"
            style={{ borderColor: "var(--color-border)" }}
          >
            <button
              onClick={() => load(page - 1)}
              disabled={page <= 1}
              className="p-1.5 rounded disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => load(page + 1)}
              disabled={page >= totalPages}
              className="p-1.5 rounded disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

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

function FilterPill({
  active,
  onClick,
  icon,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition"
      style={
        active
          ? { background: color, color: "white" }
          : {
              background: "var(--color-surface)",
              color: "var(--color-text-secondary)",
              border: `1px solid var(--color-border)`,
            }
      }
    >
      {icon}
      {label}
    </button>
  );
}
