"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Trash2, Pencil, X, Check, Loader2, Image as ImageIcon, ChevronLeft, ChevronRight } from "lucide-react";

export type Attachment = {
  id: string;
  name: string;
  public_url: string;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const load = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/attachments?page=${p}&pageSize=${PAGE_SIZE}`, {
        credentials: "include",
      });
      const j = await r.json();
      if (j.ok) {
        setItems(j.attachments);
        setTotal(j.total);
        setPage(j.page);
      }
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!arr.length) return;
    setUploading(arr.length);
    let added: Attachment[] = [];
    for (const file of arr) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("name", file.name.replace(/\.[^.]+$/, ""));
        const r = await fetch("/api/attachments/upload", {
          method: "POST",
          body: fd,
          credentials: "include",
        });
        const j = await r.json();
        if (j.ok && j.attachment) {
          added.push(j.attachment);
        } else {
          console.error("Upload failed:", j.error);
        }
      } catch (e: any) {
        console.error("Upload error:", e?.message);
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
    if (added.length) {
      // Prepend new items so user sees them immediately; refresh count.
      setItems((prev) => [...added, ...prev].slice(0, PAGE_SIZE));
      setTotal((t) => t + added.length);
      setPage(1);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      uploadFiles(e.dataTransfer.files);
    },
    [uploadFiles]
  );

  const onFilePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) uploadFiles(e.target.files);
      e.target.value = "";
    },
    [uploadFiles]
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
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Attachments</h1>
          <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
            Upload your product photos and avatars once. Pick them from any tab — no more re-uploading.
          </p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ background: "var(--color-orange)", color: "white" }}
        >
          <Upload className="w-4 h-4" /> Upload
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
            ? `Uploading ${uploading} image${uploading > 1 ? "s" : ""}…`
            : "Drag and drop images here, or click Upload above"}
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
          <p className="text-sm">No attachments yet — upload your first image to get started.</p>
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
                className="block w-full aspect-square bg-black/40"
                aria-label={`View ${a.name}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.public_url}
                  alt={a.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
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
                        color: "var(--color-text)",
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
                      style={{ color: "var(--color-text)" }}
                    >
                      {a.name}
                    </span>
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
    </div>
  );
}
