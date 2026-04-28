"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  Wallet,
  Settings,
  Search,
  Plus,
  Folder,
  MoreVertical,
  Pencil,
  Trash2,
  Loader2,
  CreditCard,
  Activity,
  Bookmark,
  MessageCircle,
  ArrowUpRight,
} from "lucide-react";
import LogoutButton from "./logout-button";

export type Project = {
  id: string;
  name: string;
  created_at?: string;
};

export type SidebarView =
  | { kind: "dashboard" }
  | { kind: "project"; projectId: string }
  | { kind: "tool"; toolId: "url-to-ad" }
  | { kind: "billing" }
  | { kind: "credit" }
  | { kind: "usage" }
  | { kind: "saved-prompts" }
  | { kind: "settings" };

export default function Sidebar({
  email,
  name,
  credits,
  planActive,
  planExpiresAt,
  projects,
  projectLimit,
  onProjectsChange,
  view,
  onViewChange,
}: {
  email: string;
  name: string;
  credits: number;
  planActive: boolean;
  planExpiresAt: string | null;
  projects: Project[];
  projectLimit: number;
  onProjectsChange: (p: Project[]) => void;
  view: SidebarView;
  onViewChange: (v: SidebarView) => void;
}) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close 3-dot menu on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    if (openMenuId) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [openMenuId]);

  const filtered = search.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : projects;
  const atLimit = projects.length >= projectLimit;

  async function createProject() {
    if (atLimit) {
      alert(`Limit reached: ${projectLimit} projects max. Delete one to create another.`);
      return;
    }
    setCreating(true);
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Project ${projects.length + 1}` }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        alert(d?.error || "Failed to create project");
        return;
      }
      const next = [d.project, ...projects];
      onProjectsChange(next);
      onViewChange({ kind: "project", projectId: d.project.id });
      // Open inline rename right away
      setRenamingId(d.project.id);
      setRenameValue(d.project.name);
    } finally {
      setCreating(false);
    }
  }

  async function saveRename(id: string) {
    const value = renameValue.trim();
    if (!value) {
      setRenamingId(null);
      return;
    }
    const prev = projects;
    onProjectsChange(projects.map((p) => (p.id === id ? { ...p, name: value } : p)));
    setRenamingId(null);
    const r = await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: value }),
    });
    if (!r.ok) {
      onProjectsChange(prev);
      alert("Rename failed");
    }
  }

  async function deleteProject(id: string) {
    if (!confirm("Delete this project? Its generations stay in your history.")) return;
    const prev = projects;
    const next = projects.filter((p) => p.id !== id);
    onProjectsChange(next);
    setOpenMenuId(null);
    // If we just deleted the active project, fall back to first remaining or empty state
    if (view.kind === "project" && view.projectId === id) {
      if (next.length) onViewChange({ kind: "project", projectId: next[0].id });
      else onViewChange({ kind: "dashboard" });
    }
    const r = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (!r.ok) {
      onProjectsChange(prev);
      alert("Delete failed");
    }
  }

  const activeProjectId = view.kind === "project" ? view.projectId : null;

  return (
    <aside
      className="hidden lg:flex flex-col w-[280px] flex-shrink-0 border-r sticky top-0 self-start max-h-screen overflow-y-auto"
      style={{
        background: "var(--color-bg)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Logo */}
      <Link
        href="/dashboard"
        className="flex items-center gap-3 px-6 py-6 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 via-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/30 flex-shrink-0">
          <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
        </div>
        <div>
          <div
            className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold"
            style={{ color: "var(--color-text-muted)" }}
          >
            Marketing
          </div>
          <div className="font-display font-extrabold text-lg tracking-tight leading-none text-[var(--color-text-primary)]">
            Studio
          </div>
        </div>
      </Link>

      {/* Dashboard landing */}
      <div className="px-4 pt-4">
        <button
          onClick={() => onViewChange({ kind: "dashboard" })}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all"
          style={
            view.kind === "dashboard"
              ? {
                  background:
                    "linear-gradient(90deg, var(--color-orange) 0%, #ff6a1a 100%)",
                  color: "white",
                  boxShadow: "0 4px 14px rgba(255,87,34,0.3)",
                }
              : {
                  background: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-secondary)",
                }
          }
        >
          <Sparkles className="w-4 h-4" strokeWidth={2.4} />
          Dashboard
        </button>
      </div>

      {/* New project */}
      <div className="px-4 pt-3">
        <button
          onClick={createProject}
          disabled={creating || atLimit}
          title={atLimit ? `Max ${projectLimit} projects` : "Create new project"}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all hover:translate-x-0.5 disabled:opacity-50"
          style={{
            background: atLimit
              ? "rgba(255,87,34,0.06)"
              : "rgba(255,87,34,0.1)",
            border: "1px solid rgba(255,87,34,0.3)",
            color: "var(--color-orange)",
          }}
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" strokeWidth={2.6} />}
          New project
          <span
            className="ml-auto font-mono text-[10px]"
            style={{ color: "var(--color-text-muted)" }}
          >
            {projects.length}/{projectLimit}
          </span>
        </button>
      </div>

      {/* Search */}
      <div className="px-4 pt-3 pb-2">
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
          }}
        >
          <Search className="w-3.5 h-3.5" style={{ color: "var(--color-text-muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="flex-1 bg-transparent outline-none text-xs text-[var(--color-text-primary)]"
          />
        </div>
      </div>

      {/* Projects list — sized to content; inner list scrolls if overflow */}
      <div className="px-4 pt-3 flex flex-col">
        <div
          className="flex items-center gap-2 px-2 mb-2 font-mono text-[10px] uppercase tracking-[0.18em] font-bold"
          style={{ color: "var(--color-text-muted)" }}
        >
          <Folder className="w-3 h-3" />
          Projects
        </div>
        <div className="space-y-1 pr-1 overflow-y-auto" style={{ maxHeight: "40vh" }}>
          {filtered.length === 0 && (
            <div
              className="px-3 py-4 text-center text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              {search.trim() ? "No matches" : "No projects yet"}
            </div>
          )}
          {filtered.map((p) => {
            const isActive = activeProjectId === p.id;
            const isRenaming = renamingId === p.id;
            const isMenuOpen = openMenuId === p.id;
            return (
              <div key={p.id} className="relative" ref={isMenuOpen ? menuRef : null}>
                {/*
                  div+role="button" instead of <button> so we can nest the
                  Project Menu <button> inside without violating HTML nesting
                  rules (which trigger a hydration error). a11y preserved via
                  role + tabIndex + Enter/Space keyboard handler.
                */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onViewChange({ kind: "project", projectId: p.id })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onViewChange({ kind: "project", projectId: p.id });
                    }
                  }}
                  className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-bold transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-orange)]"
                  style={
                    isActive
                      ? {
                          background: "rgba(255,87,34,0.12)",
                          color: "var(--color-orange)",
                        }
                      : { color: "var(--color-text-secondary)" }
                  }
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{
                      background: isActive
                        ? "linear-gradient(135deg, #ff6a1a 0%, #ff4d00 100%)"
                        : "var(--color-bg-card)",
                      border: isActive ? "none" : "1px solid var(--color-border)",
                    }}
                  >
                    <Folder
                      className="w-3.5 h-3.5"
                      strokeWidth={2.4}
                      style={{ color: isActive ? "white" : "var(--color-text-muted)" }}
                    />
                  </div>

                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => saveRename(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveRename(p.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 min-w-0 bg-transparent outline-none border-b border-[var(--color-orange)] text-sm text-[var(--color-text-primary)]"
                    />
                  ) : (
                    <span className="flex-1 min-w-0 text-left truncate">{p.name}</span>
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(isMenuOpen ? null : p.id);
                    }}
                    className="w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                    style={{
                      background: isMenuOpen ? "rgba(255,255,255,0.08)" : "transparent",
                      color: "var(--color-text-muted)",
                    }}
                    aria-label="Project menu"
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>
                </div>

                {isMenuOpen && (
                  <div
                    className="absolute right-2 top-12 z-20 w-36 rounded-lg overflow-hidden"
                    style={{
                      background: "var(--color-bg-card)",
                      border: "1px solid var(--color-border)",
                      boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
                    }}
                  >
                    <button
                      onClick={() => {
                        setRenamingId(p.id);
                        setRenameValue(p.name);
                        setOpenMenuId(null);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold hover:bg-[var(--color-bg)]"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Rename
                    </button>
                    <button
                      onClick={() => deleteProject(p.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold hover:bg-[var(--color-bg)]"
                      style={{ color: "#ef4444" }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Account nav — Billing / Credit / Usage */}
      <div
        className="px-4 pt-3 pb-2 border-t"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div
          className="flex items-center gap-2 px-2 mt-2 mb-2 font-mono text-[10px] uppercase tracking-[0.18em] font-bold"
          style={{ color: "var(--color-text-muted)" }}
        >
          Account
        </div>
        {(
          [
            { kind: "billing" as const, label: "Billing", Icon: CreditCard },
            { kind: "credit" as const, label: "Top Up Credit", Icon: Wallet },
            { kind: "usage" as const, label: "Usage", Icon: Activity },
            { kind: "saved-prompts" as const, label: "Saved Prompts", Icon: Bookmark },
          ]
        ).map(({ kind, label, Icon }) => {
          const isActive = view.kind === kind;
          return (
            <button
              key={kind}
              onClick={() => onViewChange({ kind })}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold transition-all"
              style={
                isActive
                  ? {
                      background: "rgba(255,87,34,0.12)",
                      color: "var(--color-orange)",
                    }
                  : { color: "var(--color-text-secondary)" }
              }
            >
              <Icon
                className="w-4 h-4 flex-shrink-0"
                strokeWidth={2.4}
                style={{
                  color: isActive ? "var(--color-orange)" : "var(--color-text-muted)",
                }}
              />
              {label}
            </button>
          );
        })}

        {/* External link — WhatsApp discussion group. Themed in green to
            match WhatsApp brand and stand out as a non-nav item. */}
        <a
          href="https://chat.whatsapp.com/Ftz5oImqGJ17s9q39X3EdS?mode=gi_t"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold transition-all hover:bg-emerald-500/10"
          style={{ color: "var(--color-text-secondary)" }}
        >
          <MessageCircle
            className="w-4 h-4 flex-shrink-0"
            strokeWidth={2.4}
            style={{ color: "#22c55e" }}
          />
          <span>Join Discussion WhatsApp</span>
          <ArrowUpRight
            className="w-3.5 h-3.5 ml-auto opacity-60"
            strokeWidth={2.4}
          />
        </a>
      </div>

      {/* Credit pill + subscription status */}
      <div className="px-4 pb-3 pt-3 space-y-2">
        <div
          className="relative overflow-hidden rounded-2xl p-4 border"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,87,34,0.08) 0%, rgba(255,183,0,0.04) 100%)",
            borderColor: "rgba(255,87,34,0.3)",
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-3.5 h-3.5" style={{ color: "var(--color-orange)" }} />
            <span
              className="font-mono text-[10px] uppercase tracking-widest font-bold"
              style={{ color: "var(--color-orange)" }}
            >
              Credit Balance
            </span>
          </div>
          <div className="font-display font-extrabold text-2xl tracking-tight text-[var(--color-text-primary)]">
            {credits.toFixed(2)}
          </div>
          <button
            onClick={() => onViewChange({ kind: "credit" })}
            className="mt-2 w-full py-2 rounded-lg text-xs font-extrabold transition-transform hover:scale-[1.02]"
            style={{
              background:
                "linear-gradient(90deg, var(--color-orange) 0%, #ff6a1a 100%)",
              color: "white",
              boxShadow: "0 4px 14px rgba(255,87,34,0.3)",
            }}
          >
            + Top Up
          </button>
        </div>

        <SubStatusPill
          planActive={planActive}
          planExpiresAt={planExpiresAt}
          onClick={() => onViewChange({ kind: "billing" })}
        />
      </div>

      {/* User card */}
      <div
        className="px-4 pb-4 pt-2 border-t"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-3 px-1 py-2 mb-2">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 font-display font-extrabold text-sm text-white"
            style={{
              background: "linear-gradient(135deg, #ff6a1a 0%, #ff4d00 100%)",
              boxShadow: "0 0 0 2px var(--color-bg-card), 0 4px 12px rgba(255,87,34,0.3)",
            }}
          >
            {(name || email || "U").trim().charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold truncate text-[var(--color-text-primary)]">
              {name || "User"}
            </div>
            <div className="text-[10px] text-[var(--color-text-muted)] truncate">
              {email}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => onViewChange({ kind: "settings" })}
            className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-colors hover:opacity-80"
            style={{
              background: "rgba(255,87,34,0.08)",
              border: "1px solid rgba(255,87,34,0.25)",
              color: "var(--color-orange)",
            }}
          >
            <Settings className="w-3.5 h-3.5" />
            Settings
          </button>
          <LogoutButton compact />
        </div>
      </div>
    </aside>
  );
}

// Subscription status pill shown under the Credit Balance card. Three
// states: active (green dot, days-remaining), expired (red, expired-date),
// no-plan (orange, prompt to subscribe). Tap routes to Billing.
function SubStatusPill({
  planActive,
  planExpiresAt,
  onClick,
}: {
  planActive: boolean;
  planExpiresAt: string | null;
  onClick: () => void;
}) {
  // ALL date-derived text in this pill is deferred until after hydration.
  // Both Date.now() (for daysLeft ceil math) and toLocaleDateString (for the
  // human-readable expiry) can disagree between server (UTC, Vercel Node ICU)
  // and client (user's timezone, browser ICU) by enough to trigger React
  // hydration error #418. Server renders a stable shell ("Pro" or "No active
  // plan") and the effect fills in the dynamic strings post-mount.
  const [daysLeft, setDaysLeft] = useState<number | null>(null);
  const [expDateStr, setExpDateStr] = useState<string | null>(null);
  useEffect(() => {
    if (!planExpiresAt) {
      setDaysLeft(null);
      setExpDateStr(null);
      return;
    }
    const exp = new Date(planExpiresAt);
    setDaysLeft(Math.max(0, Math.ceil((exp.getTime() - Date.now()) / 86400000)));
    setExpDateStr(
      exp.toLocaleDateString("ms-MY", { day: "numeric", month: "short", year: "numeric" })
    );
  }, [planExpiresAt]);
  const daysLeftStr = daysLeft === null ? "" : ` · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;

  let dotColor = "#888";
  let labelColor = "var(--color-text-secondary)";
  let title = "No active plan";
  let sub = "Subscribe Pro Plan";

  if (planActive) {
    dotColor = "#22c55e";
    labelColor = "#22c55e";
    title = `Pro${daysLeftStr}`;
    sub = expDateStr ? `Expires ${expDateStr}` : "Active";
  } else if (planExpiresAt) {
    dotColor = "#ef4444";
    labelColor = "#ef4444";
    title = "Subscription expired";
    sub = expDateStr ? `Expired ${expDateStr}` : "Expired";
  }

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl p-3 border transition-colors hover:opacity-90"
      style={{
        background: "var(--color-bg-card)",
        borderColor: "var(--color-border)",
      }}
    >
      <div className="flex items-center gap-2 mb-0.5">
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: dotColor, boxShadow: planActive ? `0 0 0 3px ${dotColor}33` : "none" }}
        />
        <span
          className="font-mono text-[10px] uppercase tracking-widest font-bold"
          style={{ color: labelColor }}
        >
          {title}
        </span>
      </div>
      <div className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
        {sub}
      </div>
    </button>
  );
}
