"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  Star,
  StarOff,
  Image as ImageIcon,
  Video,
  Film,
  Sparkles,
  Copy,
  Check,
  Trash2,
  Pencil,
  X,
  Folder,
  Search,
  RotateCw,
} from "lucide-react";

type SavedRow = {
  id: string;
  project_id: string | null;
  history_id: string | null;
  prompt_text: string;
  bucket: "ugc" | "cinema" | "image" | "auto";
  model: string | null;
  scene_template: string | null;
  reference_url: string | null;
  duration: number | null;
  aspect_ratio: string | null;
  cost: number;
  outcome: string;
  starred: boolean;
  user_notes: string | null;
  source: string;
  created_at: string;
  history?: {
    id?: string;
    type?: string;
    tab?: string;
    output_url?: string | null;
    thumbnail_url?: string | null;
    status?: string;
    framework?: string | null;
  } | null;
};

type Project = { id: string; name: string };

const BUCKET_META: Record<
  string,
  { label: string; color: string; icon: any }
> = {
  ugc: { label: "UGC", color: "#22c55e", icon: Video },
  cinema: { label: "Cinema", color: "#7c4dff", icon: Film },
  image: { label: "Image", color: "#ff6a1a", icon: ImageIcon },
  auto: { label: "Auto", color: "#f59e0b", icon: Sparkles },
};

// Saved Prompts library — every successful generation auto-saves here. Users
// can star their wins (those become memory for the AI agents), recreate
// past prompts, and filter by project / bucket / starred.
export default function SavedPromptsSection() {
  const [rows, setRows] = useState<SavedRow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [bucketFilter, setBucketFilter] = useState<
    "all" | "ugc" | "cinema" | "image" | "auto"
  >("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [starredOnly, setStarredOnly] = useState(false);
  const [openRow, setOpenRow] = useState<SavedRow | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    try {
      const [pr, sr] = await Promise.all([
        fetch("/api/projects", { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/saved-prompts?limit=200`, { cache: "no-store" }).then((r) =>
          r.json()
        ),
      ]);
      if (pr?.ok) setProjects(pr.projects || []);
      if (sr?.ok) setRows(sr.rows || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (bucketFilter !== "all" && r.bucket !== bucketFilter) return false;
      if (projectFilter !== "all" && r.project_id !== projectFilter)
        return false;
      if (starredOnly && !r.starred) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (
          !r.prompt_text.toLowerCase().includes(q) &&
          !(r.user_notes || "").toLowerCase().includes(q) &&
          !(r.scene_template || "").toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [rows, bucketFilter, projectFilter, starredOnly, search]);

  async function toggleStar(row: SavedRow) {
    const next = !row.starred;
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, starred: next } : r))
    );
    await fetch("/api/saved-prompts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, starred: next }),
    });
  }

  async function deleteRow(row: SavedRow) {
    if (!confirm("Delete this saved prompt? The original generation stays.")) return;
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    await fetch(`/api/saved-prompts?id=${row.id}`, { method: "DELETE" });
  }

  async function copyPrompt(row: SavedRow) {
    try {
      await navigator.clipboard.writeText(row.prompt_text);
      setCopiedId(row.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  }

  const projectName = (id: string | null) =>
    id ? projects.find((p) => p.id === id)?.name || "—" : "—";

  return (
    <div className="px-5 lg:px-10 pt-8 pb-12 max-w-7xl mx-auto w-full">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Bookmark
            className="w-3.5 h-3.5"
            style={{ color: "var(--color-orange)" }}
          />
          <span
            className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold"
            style={{ color: "var(--color-orange)" }}
          >
            Saved Prompts
          </span>
        </div>
        <h1 className="font-display font-extrabold text-3xl tracking-tight leading-none text-[var(--color-text-primary)]">
          Your prompt library
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-2">
          Every successful generation saves here. Star your wins — the AI agents
          learn from starred prompts when planning new content.
        </p>
      </div>

      {/* Filter bar */}
      <div
        className="rounded-2xl p-4 mb-5 flex flex-wrap items-center gap-3"
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        {/* Search */}
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg flex-1 min-w-[200px]"
          style={{
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
          }}
        >
          <Search
            className="w-3.5 h-3.5"
            style={{ color: "var(--color-text-muted)" }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search prompts, notes, scene name..."
            className="flex-1 bg-transparent outline-none text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
          />
        </div>

        {/* Bucket filter */}
        <div className="flex gap-1.5 flex-wrap">
          {(["all", "ugc", "cinema", "image", "auto"] as const).map((b) => {
            const isActive = bucketFilter === b;
            const meta = b === "all" ? null : BUCKET_META[b];
            return (
              <button
                key={b}
                onClick={() => setBucketFilter(b)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wider transition-all"
                style={
                  isActive
                    ? b === "all"
                      ? {
                          background:
                            "linear-gradient(135deg, #ff6a1a 0%, #ff4d00 100%)",
                          color: "white",
                          boxShadow: "0 2px 8px rgba(255,77,0,0.3)",
                        }
                      : {
                          background: meta!.color,
                          color: "white",
                          boxShadow: `0 2px 8px ${meta!.color}66`,
                        }
                    : {
                        background: "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                        color: "var(--color-text-secondary)",
                      }
                }
              >
                {b === "all" ? "All" : meta!.label}
              </button>
            );
          })}
        </div>

        {/* Project filter */}
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold outline-none"
          style={{
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        >
          <option value="all">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {/* Starred toggle */}
        <button
          onClick={() => setStarredOnly((s) => !s)}
          className="px-3 py-1.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wider transition-all flex items-center gap-1.5"
          style={
            starredOnly
              ? {
                  background:
                    "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
                  color: "white",
                  boxShadow: "0 2px 8px rgba(245,158,11,0.4)",
                }
              : {
                  background: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-secondary)",
                }
          }
        >
          <Star
            className="w-3 h-3"
            fill={starredOnly ? "white" : "none"}
          />
          Starred only
        </button>

        {/* Refresh */}
        <button
          onClick={loadAll}
          disabled={loading}
          className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-50"
          style={{
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-secondary)",
          }}
          title="Refresh"
        >
          <RotateCw
            className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {/* Counts strip */}
      <div className="text-xs text-[var(--color-text-muted)] mb-4">
        Showing <strong className="text-[var(--color-text-primary)]">{filtered.length}</strong> of <strong className="text-[var(--color-text-primary)]">{rows.length}</strong> prompts
        {starredOnly && " · ⭐ starred only"}
        {projectFilter !== "all" && ` · 📁 ${projectName(projectFilter)}`}
      </div>

      {/* Cards grid */}
      {loading ? (
        <div className="text-center py-16 text-[var(--color-text-muted)] text-sm">
          Loading library…
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="text-center py-16 rounded-2xl"
          style={{
            background: "var(--color-bg-card)",
            border: "1px dashed var(--color-border)",
          }}
        >
          <Bookmark
            className="w-8 h-8 mx-auto mb-3 opacity-40"
            style={{ color: "var(--color-text-muted)" }}
          />
          <div className="text-sm text-[var(--color-text-secondary)] mb-1">
            No saved prompts match these filters
          </div>
          <div className="text-xs text-[var(--color-text-muted)]">
            {rows.length === 0
              ? "Generate something — your prompts will appear here automatically."
              : "Try clearing the search or filters."}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((row) => (
            <PromptCard
              key={row.id}
              row={row}
              projectName={projectName(row.project_id)}
              onOpen={() => setOpenRow(row)}
              onStar={() => toggleStar(row)}
              onCopy={() => copyPrompt(row)}
              onDelete={() => deleteRow(row)}
              copied={copiedId === row.id}
            />
          ))}
        </div>
      )}

      {openRow && (
        <PromptDetailModal
          row={openRow}
          projectName={projectName(openRow.project_id)}
          onClose={() => setOpenRow(null)}
          onStar={() => toggleStar(openRow)}
          onCopy={() => copyPrompt(openRow)}
          onDelete={() => {
            setOpenRow(null);
            deleteRow(openRow);
          }}
          onUpdate={(patch) => {
            setRows((prev) =>
              prev.map((r) => (r.id === openRow.id ? { ...r, ...patch } : r))
            );
            setOpenRow({ ...openRow, ...patch });
          }}
        />
      )}
    </div>
  );
}

function PromptCard({
  row,
  projectName,
  onOpen,
  onStar,
  onCopy,
  onDelete,
  copied,
}: {
  row: SavedRow;
  projectName: string;
  onOpen: () => void;
  onStar: () => void;
  onCopy: () => void;
  onDelete: () => void;
  copied: boolean;
}) {
  const meta = BUCKET_META[row.bucket] || BUCKET_META.ugc;
  const Icon = meta.icon;
  const thumb = row.history?.thumbnail_url || row.history?.output_url || row.reference_url;
  const isVideo = row.bucket !== "image";
  const date = new Date(row.created_at).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
  });

  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col cursor-pointer transition-transform hover:-translate-y-0.5"
      style={{
        background: "var(--color-bg-card)",
        border: row.starred
          ? "1px solid rgba(251,191,36,0.5)"
          : "1px solid var(--color-border)",
        boxShadow: row.starred
          ? "0 0 0 1px rgba(251,191,36,0.2)"
          : "none",
      }}
      onClick={onOpen}
    >
      {/* Thumbnail */}
      <div
        className="relative aspect-video w-full overflow-hidden"
        style={{ background: "var(--color-bg)" }}
      >
        {thumb ? (
          isVideo ? (
            <video
              src={thumb + (thumb.includes("#") ? "" : "#t=0.5")}
              preload="metadata"
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <img
              src={thumb}
              alt=""
              className="w-full h-full object-cover"
            />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--color-text-muted)] text-xs">
            no preview
          </div>
        )}
        {/* Bucket chip */}
        <div
          className="absolute top-2 left-2 px-2 py-1 rounded text-[9px] font-extrabold uppercase tracking-wider flex items-center gap-1"
          style={{
            background: `${meta.color}22`,
            color: meta.color,
            backdropFilter: "blur(6px)",
            border: `1px solid ${meta.color}44`,
          }}
        >
          <Icon className="w-2.5 h-2.5" />
          {meta.label}
        </div>
        {/* Star button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStar();
          }}
          className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center backdrop-blur"
          style={{
            background: row.starred
              ? "rgba(251,191,36,0.9)"
              : "rgba(0,0,0,0.5)",
            color: "white",
          }}
          title={row.starred ? "Unstar" : "Star this — agent will learn from it"}
        >
          <Star
            className="w-3.5 h-3.5"
            fill={row.starred ? "white" : "none"}
          />
        </button>
      </div>

      {/* Body */}
      <div className="p-3 flex-1 flex flex-col gap-2">
        {row.scene_template && (
          <div
            className="text-[10px] font-mono uppercase tracking-wider font-bold"
            style={{ color: meta.color }}
          >
            {row.scene_template}
          </div>
        )}
        <div className="text-xs text-[var(--color-text-primary)] line-clamp-3 leading-relaxed">
          {row.prompt_text}
        </div>
        <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)] mt-auto pt-1">
          <span className="flex items-center gap-1">
            <Folder className="w-2.5 h-2.5" />
            {projectName}
          </span>
          <span>{date}</span>
        </div>
      </div>

      {/* Actions */}
      <div
        className="flex items-center gap-1 px-3 py-2 border-t"
        style={{ borderColor: "var(--color-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onCopy}
          className="flex-1 h-7 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1 transition-colors"
          style={{
            background: copied ? "rgba(34,197,94,0.15)" : "var(--color-bg)",
            color: copied ? "#22c55e" : "var(--color-text-secondary)",
            border: "1px solid var(--color-border)",
          }}
        >
          {copied ? (
            <>
              <Check className="w-3 h-3" /> Copied
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" /> Copy
            </>
          )}
        </button>
        <button
          onClick={onDelete}
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{
            background: "var(--color-bg)",
            color: "#ef4444",
            border: "1px solid var(--color-border)",
          }}
          title="Delete saved prompt"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function PromptDetailModal({
  row,
  projectName,
  onClose,
  onStar,
  onCopy,
  onDelete,
  onUpdate,
}: {
  row: SavedRow;
  projectName: string;
  onClose: () => void;
  onStar: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<SavedRow>) => void;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(row.user_notes || "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [copied, setCopied] = useState(false);
  const meta = BUCKET_META[row.bucket] || BUCKET_META.ugc;
  const isVideo = row.bucket !== "image";
  const out = row.history?.output_url || row.history?.thumbnail_url;
  const date = new Date(row.created_at).toLocaleString("en-MY");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function saveNotes() {
    setSavingNotes(true);
    try {
      await fetch("/api/saved-prompts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, user_notes: notes }),
      });
      onUpdate({ user_notes: notes });
      setEditingNotes(false);
    } finally {
      setSavingNotes(false);
    }
  }

  async function copyAndFlash() {
    try {
      await navigator.clipboard.writeText(row.prompt_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
    onCopy();
  }

  return (
    <div
      className="fixed inset-0 lg:left-[280px] z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden"
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="px-2 py-1 rounded text-[10px] font-extrabold uppercase tracking-wider"
              style={{
                background: `${meta.color}22`,
                color: meta.color,
                border: `1px solid ${meta.color}44`,
              }}
            >
              {meta.label}
            </div>
            {row.scene_template && (
              <span
                className="text-xs font-mono"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {row.scene_template}
              </span>
            )}
            <button
              onClick={onStar}
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{
                background: row.starred
                  ? "rgba(251,191,36,0.2)"
                  : "transparent",
                color: row.starred ? "#fbbf24" : "var(--color-text-muted)",
              }}
              title={row.starred ? "Unstar" : "Star — agent learns from it"}
            >
              <Star
                className="w-4 h-4"
                fill={row.starred ? "#fbbf24" : "none"}
              />
            </button>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-secondary)",
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
          {/* Output preview */}
          {out && (
            <div
              className="rounded-xl overflow-hidden flex justify-center"
              style={{ background: "#000", maxHeight: "50vh" }}
            >
              {isVideo ? (
                <video
                  src={out}
                  controls
                  playsInline
                  className="max-h-[50vh] w-auto"
                />
              ) : (
                <img
                  src={out}
                  alt=""
                  className="max-h-[50vh] w-auto object-contain"
                />
              )}
            </div>
          )}

          {/* Prompt */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                Prompt
              </span>
              <button
                onClick={copyAndFlash}
                className="px-2.5 py-1 rounded text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1 transition-colors"
                style={{
                  background: copied ? "rgba(34,197,94,0.15)" : "var(--color-bg)",
                  color: copied ? "#22c55e" : "var(--color-text-secondary)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" /> Copy
                  </>
                )}
              </button>
            </div>
            <pre
              className="text-[12px] font-mono leading-relaxed whitespace-pre-wrap rounded-lg p-4"
              style={{
                background: "var(--color-bg)",
                color: "var(--color-text-primary)",
                border: "1px solid var(--color-border)",
              }}
            >
              {row.prompt_text}
            </pre>
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <Meta label="Project" value={projectName} />
            <Meta label="Model" value={row.model || "—"} />
            <Meta
              label="Duration"
              value={row.duration ? `${row.duration}s` : "—"}
            />
            <Meta label="Aspect" value={row.aspect_ratio || "—"} />
            <Meta label="Cost" value={`RM ${Number(row.cost).toFixed(2)}`} />
            <Meta label="Source" value={row.source} />
            <Meta label="Outcome" value={row.outcome} />
            <Meta label="Saved" value={date} />
          </div>

          {/* Notes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                Your notes
              </span>
              {!editingNotes && (
                <button
                  onClick={() => setEditingNotes(true)}
                  className="px-2.5 py-1 rounded text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1"
                  style={{
                    background: "var(--color-bg)",
                    color: "var(--color-text-secondary)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <Pencil className="w-3 h-3" />
                  {row.user_notes ? "Edit" : "Add"}
                </button>
              )}
            </div>
            {editingNotes ? (
              <div>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder='e.g. "Converted 12% on TikTok. Re-use this hook."'
                  className="w-full p-3 rounded-lg text-xs resize-y outline-none"
                  style={{
                    background: "var(--color-bg)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text-primary)",
                  }}
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={saveNotes}
                    disabled={savingNotes}
                    className="px-4 py-2 rounded-lg text-xs font-extrabold uppercase tracking-wider text-white disabled:opacity-50"
                    style={{
                      background:
                        "linear-gradient(135deg, #ff6a1a 0%, #ff4d00 100%)",
                    }}
                  >
                    {savingNotes ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => {
                      setNotes(row.user_notes || "");
                      setEditingNotes(false);
                    }}
                    className="px-4 py-2 rounded-lg text-xs font-bold"
                    style={{
                      background: "var(--color-bg)",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="text-xs italic rounded-lg p-3"
                style={{
                  background: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                  color: row.user_notes
                    ? "var(--color-text-primary)"
                    : "var(--color-text-muted)",
                }}
              >
                {row.user_notes || "No notes yet. Add a note to remember why this prompt worked."}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-5 py-4 border-t flex items-center justify-end gap-2"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg)",
          }}
        >
          <button
            onClick={onDelete}
            className="px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5"
            style={{
              background: "rgba(239,68,68,0.1)",
              color: "#ef4444",
              border: "1px solid rgba(239,68,68,0.3)",
            }}
          >
            <Trash2 className="w-3 h-3" />
            Delete
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-bold"
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-secondary)",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-lg p-2.5"
      style={{
        background: "var(--color-bg)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-text-muted)] mb-0.5">
        {label}
      </div>
      <div className="text-xs font-semibold text-[var(--color-text-primary)] truncate">
        {value}
      </div>
    </div>
  );
}
