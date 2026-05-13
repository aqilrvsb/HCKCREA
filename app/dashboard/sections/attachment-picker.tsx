"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Loader2, Image as ImageIcon, ChevronLeft, ChevronRight, Upload } from "lucide-react";
import type { Attachment } from "./attachments";

const PAGE_SIZE = 25;

// Shared modal — every tab's old "Upload from local" button now opens
// this picker. Click an image, the callback receives the public S3 URL
// + the attachment row so callers can also store filename/dimensions
// alongside the URL if they want to.
export default function AttachmentPicker({
  open,
  onClose,
  onPick,
  title = "Pick from Attachments",
}: {
  open: boolean;
  onClose: () => void;
  onPick: (a: Attachment) => void;
  title?: string;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(0);

  const load = useCallback(async (p = 1) => {
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
  }, []);

  useEffect(() => {
    if (open) load(1);
  }, [open, load]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (!arr.length) return;
      setUploading(arr.length);
      const added: Attachment[] = [];
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
          if (j.ok && j.attachment) added.push(j.attachment);
        } catch (e: any) {
          console.error("Picker upload error:", e?.message);
        } finally {
          setUploading((n) => Math.max(0, n - 1));
        }
      }
      if (added.length) {
        setItems((prev) => [...added, ...prev].slice(0, PAGE_SIZE));
        setTotal((t) => t + added.length);
        setPage(1);
      }
    },
    []
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
                  if (e.target.files) uploadFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-white/10">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {uploading > 0 && (
            <div className="mb-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
              Uploading {uploading} image{uploading > 1 ? "s" : ""}…
            </div>
          )}
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--color-orange)" }} />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12" style={{ color: "var(--color-text-muted)" }}>
              <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No attachments yet. Click <span className="font-semibold">Add new</span> above or visit the Attachments tab to add some.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {items.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    onPick(a);
                    onClose();
                  }}
                  className="group block rounded-lg overflow-hidden border hover:border-[var(--color-orange)] transition"
                  style={{ borderColor: "var(--color-border)" }}
                  title={a.name}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.public_url}
                    alt={a.name}
                    className="w-full aspect-square object-cover bg-black/40"
                    loading="lazy"
                  />
                  <div
                    className="px-2 py-1.5 text-[11px] font-semibold truncate text-left"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    {a.name}
                  </div>
                </button>
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
    </div>
  );
}
