"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  Wallet,
  HardDrive,
  Settings,
  Search,
  Plus,
  Folder,
  MoreVertical,
  Pencil,
  Trash2,
  Loader2,
  CreditCard,
  Users,
  Activity,
  BarChart3,
  Bookmark,
  MessageCircle,
  ArrowUpRight,
  Download,
  X,
  Send,
  Terminal,
  Image as ImageIcon,
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
  | { kind: "attachments" }
  | { kind: "billing" }
  | { kind: "credit" }
  | { kind: "affiliate" }
  // Reporting Affiliate lives under ACCOUNT, not the project tabs: transfers
  // are recorded per USER, so the report spans every project.
  | { kind: "affiliate-report" }
  // Manage Users — scoped reseller "Add/Edit User" for the allowlisted team.
  | { kind: "manage-users" }
  | { kind: "usage" }
  | { kind: "saved-prompts" }
  | { kind: "storage" }
  | { kind: "settings" };

export type SidebarTab = {
  key: string;
  label: string;
  icon: any;
  tag: string;
};

export default function Sidebar({
  email,
  name,
  credits,
  plan,
  planActive,
  planExpiresAt,
  projects,
  projectLimit,
  onProjectsChange,
  view,
  onViewChange,
  tabs,
  activeTab,
  onTabChange,
  mobileOpen,
  onMobileClose,
  isAffiliate = false,
  affiliateMode = false,
  canManageUsers: canMngUsers = false,
}: {
  email: string;
  name: string;
  credits: number;
  /** Raw plan key (free / starter / standard / pro / premium / legacy).
   *  Drives the Top Up Credit nav row visibility — only shown on Pro
   *  and Premium plans where the perk is part of the tier. */
  plan: string;
  planActive: boolean;
  planExpiresAt: string | null;
  projects: Project[];
  projectLimit: number;
  onProjectsChange: (p: Project[]) => void;
  view: SidebarView;
  onViewChange: (v: SidebarView) => void;
  /** True for users with an approved affiliate_applications row. Routes
   *  them to the affiliate-only WhatsApp group instead of the public one. */
  isAffiliate?: boolean;
  /** Affiliate MODE (Settings toggle) — shows the Reporting Affiliate nav. */
  affiliateMode?: boolean;
  /** Allowlisted reseller — shows the Manage Users nav. */
  canManageUsers?: boolean;
  // Project tabs (Image / UGC / Auto Content / etc.) — rendered inside the
  // sidebar when a project is active. Replaces the top tab pills so mobile
  // users can navigate from the same drawer they use for everything else.
  tabs: SidebarTab[];
  activeTab: string;
  onTabChange: (k: string) => void;
  // Mobile drawer state — controlled by parent. On lg+ the sidebar is
  // always visible so these become no-ops.
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Install-SOP modal for the Auto Post TikTok extension. Lazy-fetched
  // version + download URL from /api/extension/info on first open.
  const [autoPostModalOpen, setAutoPostModalOpen] = useState(false);
  const [extInfo, setExtInfo] = useState<{ version: string; download_url: string } | null>(null);

  // Storage stats fetch removed — the Storage sidebar entry is hidden
  // now that every generation auto-rehosts to peninglab-content with a
  // 30-day B2 lifecycle. No more user-curated quota UX.

  async function openAutoPostModal() {
    setAutoPostModalOpen(true);
    if (!extInfo) {
      try {
        const r = await fetch("/api/extension/info", { cache: "no-store" });
        const d = await r.json();
        setExtInfo({
          version: String(d?.version || ""),
          download_url: String(d?.download_url || ""),
        });
      } catch {
        setExtInfo({ version: "", download_url: "" });
      }
    }
  }
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
    <>
      {/* Sidebar hover-animation styles. Applied to .sidebar-row buttons:
          smooth slide-right on hover + soft tint background + icon scale.
          Cubic-bezier mimics natural easing. Reduced motion prefs are
          respected so users with vestibular issues see only the static
          colour change. */}
      <style>{`
        .sidebar-row {
          transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1),
                      background-color 200ms cubic-bezier(0.4, 0, 0.2, 1),
                      box-shadow 200ms cubic-bezier(0.4, 0, 0.2, 1),
                      color 200ms cubic-bezier(0.4, 0, 0.2, 1);
        }
        .sidebar-row:hover {
          transform: translateX(3px);
          background: rgba(255, 87, 34, 0.08);
          box-shadow: inset 2px 0 0 var(--color-orange);
          color: var(--color-text-primary);
        }
        .sidebar-row:hover .sidebar-row-icon {
          color: var(--color-orange) !important;
          transform: scale(1.1);
        }
        .sidebar-row-icon {
          transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1),
                      color 200ms cubic-bezier(0.4, 0, 0.2, 1);
        }
        @media (prefers-reduced-motion: reduce) {
          .sidebar-row, .sidebar-row-icon { transition: color 200ms ease; }
          .sidebar-row:hover { transform: none; }
          .sidebar-row:hover .sidebar-row-icon { transform: none; }
        }
      `}</style>
      {/* Mobile backdrop — only shown when drawer is open. Click closes. */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={onMobileClose}
        />
      )}
      <aside
        className={
          "flex flex-col w-[280px] flex-shrink-0 border-r overflow-y-auto " +
          // Mobile: fixed slide-in drawer. Desktop: sticky in-flow column.
          "fixed inset-y-0 left-0 z-50 transform transition-transform " +
          (mobileOpen ? "translate-x-0 " : "-translate-x-full ") +
          "lg:translate-x-0 lg:static lg:z-auto lg:sticky lg:top-0 lg:self-start lg:max-h-screen"
        }
        style={{
          background: "var(--color-bg)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Mobile-only close button (top-right of drawer) */}
        <button
          onClick={onMobileClose}
          aria-label="Close menu"
          className="lg:hidden absolute top-3 right-3 z-10 w-9 h-9 rounded-lg flex items-center justify-center"
          style={{
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-secondary)",
          }}
        >
          <X className="w-4 h-4" />
        </button>
      {/* Logo */}
      <Link
        href="/dashboard"
        className="flex items-center gap-3 px-6 py-6 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div
          className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg flex-shrink-0"
          style={{
            background: "linear-gradient(135deg, #fde047 0%, #facc15 100%)",
            boxShadow: "0 8px 24px rgba(250, 204, 21, 0.35)",
          }}
        >
          <Sparkles className="w-5 h-5 text-black" strokeWidth={2.5} />
        </div>
        <div>
          <div
            className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold"
            style={{ color: "var(--color-text-muted)" }}
          >
            PeningLab
          </div>
          <div className="font-display font-extrabold text-lg tracking-tight leading-none text-[var(--color-text-primary)]">
            Studio
          </div>
        </div>
      </Link>

      {/* Dashboard landing */}
      <div className="px-4 pt-4">
        <button
          onClick={() => {
            onViewChange({ kind: "dashboard" });
            // Strip residual ?p={id} (or other params) from the URL when
            // the user navigates back to the dashboard root. Without
            // this, a URL stamped by an earlier session (or by an "Open
            // in new tab" project link) would persist as ?p=... even
            // after the user clicks Dashboard, which looks broken.
            if (typeof window !== "undefined" && window.location.search) {
              window.history.replaceState(null, "", "/dashboard");
            }
          }}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all"
          style={
            view.kind === "dashboard"
              ? {
                  background:
                    "linear-gradient(90deg, var(--color-orange) 0%, #facc15 100%)",
                  color: "#000",
                  boxShadow: "0 4px 14px rgba(250,204,21,0.3)",
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
            // Real anchor href so the browser's native right-click /
            // middle-click / Ctrl+click → "Open in new tab" works.
            // Left-click is intercepted and routed through SPA state.
            const projectHref = `/dashboard?p=${encodeURIComponent(p.id)}`;
            return (
              <div key={p.id} className="group relative" ref={isMenuOpen ? menuRef : null}>
                <a
                  href={projectHref}
                  onClick={(e) => {
                    // Only intercept plain left-click; let
                    // Ctrl/Cmd/middle/shift click fall through so the
                    // browser opens / focuses a new tab natively.
                    if (
                      e.button !== 0 ||
                      e.ctrlKey ||
                      e.metaKey ||
                      e.shiftKey ||
                      e.altKey
                    ) {
                      return;
                    }
                    e.preventDefault();
                    onViewChange({ kind: "project", projectId: p.id });
                    // URL push removed per user direction 2026-06-08 —
                    // left-click on a project keeps the URL clean
                    // (/dashboard, no ?p= param). The HREF on the anchor
                    // still drives right-click / middle-click / Ctrl+
                    // click "Open in new tab" since those skip the
                    // preventDefault() path above.
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-bold transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-orange)] no-underline"
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
                        ? "linear-gradient(135deg, #facc15 0%, #eab308 100%)"
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
                    <span className="flex-1 min-w-0 text-left truncate pr-7">{p.name}</span>
                  )}
                </a>

                {/* Menu button — absolute-positioned sibling so it sits
                    on top of the <a> without HTML-nesting an interactive
                    element inside a link. */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpenMenuId(isMenuOpen ? null : p.id);
                  }}
                  className="absolute top-1/2 right-2 -translate-y-1/2 w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition z-10"
                  style={{
                    background: isMenuOpen ? "rgba(255,255,255,0.08)" : "transparent",
                    color: "var(--color-text-muted)",
                  }}
                  aria-label="Project menu"
                >
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>

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

      {/* Project tabs (mobile-only) — Image / UGC / Auto Content / Story /
          Cinema / Clone Prompt. Only renders when a project is active AND
          on mobile, where the top tab pill bar is hidden. Desktop keeps
          its top tab pills intact (zero behavioural change for desktop). */}
      {view.kind === "project" && tabs.length > 0 && (
        <div
          className="lg:hidden px-4 pt-3 pb-2 border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div
            className="flex items-center gap-2 px-2 mt-2 mb-2 font-mono text-[10px] uppercase tracking-[0.18em] font-bold"
            style={{ color: "var(--color-text-muted)" }}
          >
            Tools
          </div>
          {tabs.map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => {
                  onTabChange(t.key);
                  onMobileClose();
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold transition-all"
                style={
                  isActive
                    ? {
                        background:
                          "linear-gradient(135deg, rgba(250,204,21,0.18), rgba(234,179,8,0.10))",
                        color: "var(--color-orange)",
                      }
                    : { color: "var(--color-text-secondary)" }
                }
              >
                <Icon className="w-4 h-4 flex-shrink-0" strokeWidth={2.4} />
                <span className="flex-1 text-left">{t.label}</span>
                <span
                  className="font-mono text-[10px] tracking-wider"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {t.tag}
                </span>
              </button>
            );
          })}
        </div>
      )}

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
            // Attachments nav hidden per user direction 2026-06-28 (still
            // reachable via pickers; re-enable by uncommenting).
            // { kind: "attachments" as const, label: "Attachments", Icon: ImageIcon },
            // Billing nav hidden per user direction — subscriptions are being
            // wound down (no new subscribe / resubscribe from the menu). Top Up
            // Credit stays. Re-enable by uncommenting this line.
            // { kind: "billing" as const, label: "Billing", Icon: CreditCard },
            // Top Up Credit nav — visible ONLY for Pro + Premium plan
            // holders (the tiers that include the perk per the pricing
            // grid's "Access Top Up Credit" highlighted line). Free /
            // Starter / Standard users don't see it at all.
            ...(planActive && (plan === "pro" || plan === "premium")
              ? [{ kind: "credit" as const, label: "Top Up Credit", Icon: Wallet }]
              : []),
            // Affiliate nav — same Pro/Premium gate. AFFILIATE_TIERS
            // in lib/plans.ts is the source of truth; sidebar mirrors
            // it inline to avoid pulling the constant into a server
            // boundary unnecessarily.
            ...(planActive && (plan === "pro" || plan === "premium")
              ? [{ kind: "affiliate" as const, label: "Affiliate", Icon: Users }]
              : []),
            // Reporting Affiliate — only when Affiliate mode is toggled on in
            // Settings. Account-level (not per project) because a transfer is
            // recorded against the USER, so the report covers all projects.
            ...(affiliateMode
              ? [{ kind: "affiliate-report" as const, label: "Reporting Affiliate", Icon: BarChart3 }]
              : []),
            // Manage Users — only for allowlisted reseller accounts (nl team).
            ...(canMngUsers
              ? [{ kind: "manage-users" as const, label: "Manage Users", Icon: Users }]
              : []),
            { kind: "usage" as const, label: "Usage", Icon: Activity },
            // Saved Prompts hidden — per-tab agents now persist their
            // own prompt history, so the standalone library page is
            // redundant. Re-enable if we bring back manual prompt curation.
            // { kind: "saved-prompts" as const, label: "Saved Prompts", Icon: Bookmark },
            // Storage tab hidden — every generation now auto-rehosts to
            // peninglab-content B2 bucket at settle time, so the manual
            // "Save" UX is no longer needed. Files live for 30 days via
            // B2 lifecycle rule. Re-enable this entry if we ever bring
            // back user-curated permanent saves.
            // { kind: "storage" as const, label: "Storage", Icon: HardDrive },
          ]
        ).map(({ kind, label, Icon }) => {
          const isActive = view.kind === kind;
          // Affiliate row gets a soft pulse glow to draw attention to the
          // referral program. Pauses on hover (via CSS) so user interaction
          // state stays visible. Pause also when the row is the active
          // view — the orange active highlight + the gold pulse would
          // fight each other visually.
          const isAffiliate = kind === "affiliate";
          const shineClass = isAffiliate && !isActive ? "sidebar-affiliate-shine" : "";
          return (
            <button
              key={kind}
              onClick={() => {
                onViewChange({ kind });
                onMobileClose();
              }}
              className={`sidebar-row group w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold ${shineClass}`}
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
                className="sidebar-row-icon w-4 h-4 flex-shrink-0"
                strokeWidth={2.4}
                style={{
                  color: isActive ? "var(--color-orange)" : "var(--color-text-muted)",
                }}
              />
              <span className="flex-1 text-left truncate">{label}</span>
            </button>
          );
        })}

        {/* MCP API Key page — for Pro + Premium users who want to use
            peninglab's image/video generation from external AI agents
            (Claude Desktop, Cursor, etc.) via the @peninglab/mcp npm
            package. Real /dashboard/mcp Next.js page (not a view-kind
            state), so we use a Link. Same Pro/Premium gate as Top Up
            Credit + Affiliate. */}
        {/* MCP API Key nav hidden per user direction 2026-06-28. Page still
            exists at /dashboard/mcp; re-enable by restoring the gate below. */}
        {false && planActive && (plan === "pro" || plan === "premium") && (
          <Link
            href="/dashboard/mcp"
            onClick={() => onMobileClose()}
            className="sidebar-row w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <Terminal
              className="sidebar-row-icon w-4 h-4 flex-shrink-0"
              strokeWidth={2.4}
              style={{ color: "var(--color-text-muted)" }}
            />
            <span className="flex-1 text-left truncate">MCP API Key</span>
          </Link>
        )}

        {/* PeningLab GPT — external Custom GPT (generate video inside
            ChatGPT). Visible to EVERY package as an upsell; login inside
            the GPT itself gates Pro/Premium. */}
        <a
          href="https://chatgpt.com/g/g-6a48ae23dcd481918004d50a91ea51f2-pening-lab-gpt"
          target="_blank"
          rel="noopener noreferrer"
          className="sidebar-row w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold"
          style={{ color: "var(--color-text-secondary)" }}
        >
          <Sparkles
            className="sidebar-row-icon w-4 h-4 flex-shrink-0"
            strokeWidth={2.4}
            style={{ color: "#8b5cf6" }}
          />
          <span>PeningLab GPT</span>
          <ArrowUpRight className="w-3.5 h-3.5 ml-auto opacity-60" strokeWidth={2.4} />
        </a>

        {/* Auto Post TikTok — opens install SOP modal (matches the
            Hack Creative Extension SOP style). Click pulls the current
            extension version + download URL from /api/extension/info.
            Visible to Standard / Pro / Premium (AUTO_POST_TIERS in
            lib/plans.ts). Hidden for Starter + free + expired so the
            extension feels like a deliberate upgrade perk. */}
        {planActive &&
          (plan === "standard" || plan === "pro" || plan === "premium") && (
            <button
              type="button"
              onClick={() => void openAutoPostModal()}
              className="sidebar-row w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold"
              style={{ color: "var(--color-text-secondary)" }}
            >
              <Send
                className="sidebar-row-icon w-4 h-4 flex-shrink-0"
                strokeWidth={2.4}
                style={{ color: "var(--color-orange)" }}
              />
              Auto Post TikTok
            </button>
          )}

        {/* External link — WhatsApp Group. Visible for active Pro and
            Premium users (per user direction 2026-06-08). Each tier
            gets its own group invite so Premium stays a curated VIP
            community while Pro gets the broader paid-customer group.
            Affiliate users always see the affiliate-only variant
            regardless of plan tier. */}
        {planActive && (plan === "pro" || plan === "premium") && (
          <a
            href={
              isAffiliate
                ? "https://chat.whatsapp.com/CRp8ctg8Y40IBrtlPbuCQ2"
                : plan === "premium"
                  ? "https://chat.whatsapp.com/D0rL4xE5qspKIoEDpCaiFd"
                  : "https://chat.whatsapp.com/BPORSI7khdIEOGZzWYBwbS"
            }
            target="_blank"
            rel="noopener noreferrer"
            className="sidebar-row w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <MessageCircle
              className="sidebar-row-icon w-4 h-4 flex-shrink-0"
              strokeWidth={2.4}
              style={{ color: "#22c55e" }}
            />
            <span>
              {isAffiliate
                ? "Affiliate WhatsApp Group"
                : plan === "premium"
                  ? "Join Group VIP"
                  : "Join Pro Group"}
            </span>
            <ArrowUpRight
              className="w-3.5 h-3.5 ml-auto opacity-60"
              strokeWidth={2.4}
            />
          </a>
        )}
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
            onClick={() => onViewChange({ kind: "billing" })}
            className="mt-2 w-full py-2 rounded-lg text-xs font-extrabold transition-transform hover:scale-[1.02]"
            style={{
              background:
                "linear-gradient(90deg, var(--color-orange) 0%, #facc15 100%)",
              color: "#000",
              boxShadow: "0 4px 14px rgba(250,204,21,0.3)",
            }}
          >
            Subscribe
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
              background: "linear-gradient(135deg, #facc15 0%, #eab308 100%)",
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

      {/* Auto Post TikTok install SOP — full-screen modal with the
          download button + step-by-step "Load Unpacked" instructions.
          Visual port of the Hack Creative Extension SOP. */}
      {autoPostModalOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setAutoPostModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-md max-h-[92vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Orange-gradient header */}
            <div
              className="px-6 py-5 flex items-center justify-between text-white rounded-t-2xl"
              style={{
                background:
                  "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
              }}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-xl">🎬</span>
                <h3 className="font-display font-extrabold text-base">
                  PeningLab Auto Post — SOP
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setAutoPostModalOpen(false)}
                className="text-white/80 hover:text-white"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 text-gray-900">
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-orange-700 text-sm"
                  style={{ background: "#fed7aa" }}
                >
                  1
                </div>
                <h4 className="font-display font-extrabold text-lg">
                  Install Extension
                </h4>
              </div>

              <p className="text-sm font-bold mb-4" style={{ color: "#ea580c" }}>
                Current Version: v{extInfo?.version || "…"}
              </p>

              <ul className="space-y-3 text-sm leading-relaxed">
                <li className="flex items-start gap-2.5">
                  <span
                    className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: "#ea580c" }}
                  />
                  <div>
                    <div>Download extension</div>
                    {extInfo?.download_url ? (
                      <a
                        href={extInfo.download_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 mt-2 px-4 py-2 rounded-lg font-bold text-sm transition-transform hover:-translate-y-0.5"
                        style={{
                          background: "#fff7ed",
                          border: "1px solid #fdba74",
                          color: "#ea580c",
                        }}
                      >
                        <Download className="w-4 h-4" />
                        Download Extension <ArrowUpRight className="w-3.5 h-3.5" />
                      </a>
                    ) : (
                      <div className="text-xs text-gray-500 italic mt-1">
                        Admin belum sediakan link download. Hubungi support.
                      </div>
                    )}
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span
                    className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: "#ea580c" }}
                  />
                  <div>Extract Folder</div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span
                    className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: "#ea580c" }}
                  />
                  <div>
                    Open Chrome, type{" "}
                    <span className="font-mono font-bold bg-gray-100 px-1.5 py-0.5 rounded">
                      chrome://extensions/
                    </span>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span
                    className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: "#ea580c" }}
                  />
                  <div>
                    Enable <span className="font-bold">Developer Mode</span>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span
                    className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: "#ea580c" }}
                  />
                  <div>
                    Click <span className="font-bold">Load Unpacked</span>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span
                    className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: "#ea580c" }}
                  />
                  <div>Select the extracted extension folder</div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}
      </aside>
    </>
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
