"use client";

import { useEffect, useState } from "react";
import {
  ImageIcon,
  Video,
  Layers,
  Wand2,
  Folder,
  Loader2,
  Plus,
  Film,
  BookOpen,
  Zap,
} from "lucide-react";
import ImageTab from "./tabs/image";
import VideoTab from "./tabs/video";
import CinemaTab from "./tabs/cinema";
import GrokTab from "./tabs/grok";
import Sora2Tab from "./tabs/sora2";
import OriginalVideoTab from "./tabs/original-video";
import SeedanceTab from "./tabs/seedance";
import CloneTab from "./tabs/clone";
import AutoContentTab from "./tabs/auto-content";
import FairytaleTab from "./tabs/fairytale";
import HistoryGrid from "./sections/history-grid";
import BillingSection from "./sections/billing";
import CreditSection from "./sections/credit";
import AffiliateSection from "./sections/affiliate";
import UsageSection from "./sections/usage";
import SettingsSection from "./sections/settings";
import DashboardOverview from "./sections/dashboard-overview";
import SavedPromptsSection from "./sections/saved-prompts";
import StorageSection from "./sections/storage";
import AttachmentsSection from "./sections/attachments";
import ActivityFeed from "./sections/activity-feed";
import QAChatPanel, { type QATab } from "./sections/qa-chat-panel";
import { SopButton } from "./sections/sop-modal";
import { SOP_CONTENT } from "@/lib/sop-content";
import Sidebar, { type Project, type SidebarView } from "./sidebar";

type TabKey =
  | "image"
  | "video"
  | "cinema"
  | "grok"
  | "sora2"
  | "seedance"
  | "clone"
  | "auto"
  | "fairytale"
  | "original-video";

// Tab order: Image → UGC → Auto Content → Story → Cinema (Seedance) →
// Clone Prompt → Fairytale. "Story" keeps the legacy "cinema" key + the
// /api/agent/cinema route paths internally so we don't have to rename
// agent-cinema.ts.
// "Viral" tab (key: "cinema") was previously hidden as "Story" — now back
// with a model selector (Grok / Veo). Backend route paths still use the
// "cinema" key internally so we don't have to rename agent-cinema.ts.
const TABS: { key: TabKey; label: string; icon: any; tag: string }[] = [
  { key: "image",     label: "Image",        icon: ImageIcon, tag: "01" },
  // UGC tab hidden per user direction 2026-06-08. Route + VideoTab
  // component kept so existing UGC history rows still render via the
  // history grid + admin tooling. Re-enable by uncommenting.
  // { key: "video",     label: "UGC",          icon: Video,     tag: "02" },
  { key: "auto",      label: "Auto Content", icon: Wand2,     tag: "03" },
  // Seedance/Cinema tab hidden per user direction. Route + import kept
  // so existing seedance history rows still render via their cards in
  // the Sora 2 / Viral grids if shared. Re-enable by uncommenting.
  // { key: "seedance",  label: "Cinema",       icon: Film,      tag: "04" },
  { key: "original-video", label: "Original Video", icon: Film, tag: "04" },
  { key: "clone",     label: "Clone Prompt", icon: Layers,    tag: "05" },
  { key: "fairytale", label: "Storytelling", icon: BookOpen,  tag: "06" },
  { key: "cinema",    label: "Viral",        icon: Film,      tag: "07" },
  // Grok hidden per user direction (server unstable).
  // Sora 2 standalone tab hidden — Original Video (04) now exposes
  // Sora 2 as a provider option alongside Veo + Grok, making the
  // dedicated tab redundant. Existing Sora 2 history rows still
  // render under the Original Video / cinema history grid via
  // shared metadata.modelChoice='sora2' detection.
  // { key: "grok",   label: "Grok",         icon: Zap,       tag: "08" },
  // { key: "sora2",  label: "Sora 2",       icon: Zap,       tag: "08" },
];

export default function DashboardShell({
  email,
  name,
  credits: initialCredits,
  plan,
  planActive,
  planExpiresAt,
  isAffiliate = false,
}: {
  email: string;
  name: string;
  credits: number;
  /** Raw plan key from profiles.plan (free / starter / standard / pro
   *  / premium / legacy values). Forwarded to Sidebar so it can gate
   *  the Top Up Credit nav row on the right tiers. */
  plan: string;
  planActive: boolean;
  planExpiresAt: string | null;
  /** True if this user has an approved affiliate_applications row.
   *  Used to swap the sidebar's WhatsApp join link to the affiliate-only
   *  group. */
  isAffiliate?: boolean;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectLimit, setProjectLimit] = useState(4);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [view, setView] = useState<SidebarView>({ kind: "dashboard" });
  const [activeTab, setActiveTab] = useState<TabKey>("image");
  // Mobile drawer state — controls whether the sidebar is slid in. Closes
  // automatically when the user picks a tab / view from inside the drawer.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Live credit balance — initialised from the server-rendered prop, then
  // refreshed via /api/me/credits. Triggers:
  //   1. ON MOUNT — handles fresh-login case where the server-rendered prop
  //      raced with a webhook deduction/topup that just landed.
  //   2. `history:refresh` event — dispatched by retry / submit / approve.
  //   3. 30s interval backstop — catches webhook-driven settlements that
  //      happen with no front-end action.
  //   4. POST-PAYMENT BURST — when ?topup=success or ?payment=success lands
  //      (Chip success_redirect from credit topup / subscribe), we poll
  //      /api/me/credits every 2s for 30s so the new balance appears the
  //      moment the Chip webhook lands, instead of waiting for the 30s tick.
  const [credits, setCredits] = useState<number>(initialCredits);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const r = await fetch("/api/me/credits", { cache: "no-store" });
        const d = await r.json();
        if (!cancelled && r.ok && d?.ok) setCredits(Number(d.credits || 0));
      } catch {
        // Silent — stale display is fine until the next tick.
      }
    };
    void refresh(); // hydrate immediately on mount

    // Post-payment burst — Chip's webhook can lag a few seconds behind the
    // user's success_redirect, so poll aggressively to catch the moment it
    // commits. Detected via ?topup=success or ?payment=success on the URL.
    let burstInterval: number | null = null;
    let burstStop: number | null = null;
    if (typeof window !== "undefined") {
      const qp = new URLSearchParams(window.location.search);
      if (qp.get("topup") === "success" || qp.get("payment") === "success") {
        burstInterval = window.setInterval(refresh, 2_000);
        burstStop = window.setTimeout(() => {
          if (burstInterval) window.clearInterval(burstInterval);
        }, 30_000);
      }
    }

    window.addEventListener("history:refresh", refresh);
    const id = setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.removeEventListener("history:refresh", refresh);
      clearInterval(id);
      if (burstInterval) window.clearInterval(burstInterval);
      if (burstStop) window.clearTimeout(burstStop);
    };
  }, []);

  // Initial fetch — list projects only. Don't auto-select; the user picks
  // which project to open from the sidebar. EXCEPTION: if the URL has
  // ?p={projectId}, jump straight to that project once the list lands.
  // This is what makes right-click → "Open in new tab" on a project
  // tile produce a tab that opens directly to that project.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/projects", { cache: "no-store" });
        const d = await r.json();
        if (r.ok && d?.ok) {
          const list: Project[] = d.projects || [];
          setProjects(list);
          if (typeof d.limit === "number") setProjectLimit(d.limit);
          if (typeof window !== "undefined") {
            const qp = new URLSearchParams(window.location.search);
            const pid = qp.get("p");
            if (pid && list.some((p) => p.id === pid)) {
              setView({ kind: "project", projectId: pid });
            } else if (pid) {
              // Stale ?p={id} pointing at a project that no longer
              // exists (deleted, or wrong account, or browser history
              // residue). Strip it so the URL matches the actual view
              // (dashboard root) instead of looking broken.
              window.history.replaceState(null, "", "/dashboard");
            }
          }
        }
      } finally {
        setProjectsLoaded(true);
      }
    })();
  }, []);

  // Browser back/forward — keep view in sync with the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      const qp = new URLSearchParams(window.location.search);
      const pid = qp.get("p");
      if (pid && projects.some((p) => p.id === pid)) {
        setView({ kind: "project", projectId: pid });
      } else if (!pid) {
        setView({ kind: "dashboard" });
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [projects]);

  // UGC's "Use in Video" still works inside a project — just switch the active tab
  useEffect(() => {
    const onGoto = (e: any) => {
      const target = e?.detail as TabKey | undefined;
      if (target && TABS.find((t) => t.key === target)) {
        setActiveTab(target);
      }
    };
    window.addEventListener("dashboard:goto", onGoto);
    return () => window.removeEventListener("dashboard:goto", onGoto);
  }, []);

  const activeProject =
    view.kind === "project" ? projects.find((p) => p.id === view.projectId) : null;

  return (
    <div className="relative min-h-screen">
      <div className="bg-sky" />

      {/* Live activity feed (right edge) — social proof for every signed-in
          user. Names anonymized server-side, previews watermarked. */}
      <ActivityFeed />

      <div className="relative z-10 flex min-h-screen items-stretch">
        <Sidebar
          email={email}
          name={name}
          credits={credits}
          plan={plan}
          planActive={planActive}
          planExpiresAt={planExpiresAt}
          isAffiliate={isAffiliate}
          projects={projects}
          projectLimit={projectLimit}
          onProjectsChange={setProjects}
          view={view}
          onViewChange={setView}
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={(k) => {
            // If subscription is inactive, route ALL tab clicks to billing
            // — same gate the old top-pill bar enforced.
            if (!planActive) {
              setView({ kind: "billing" });
              return;
            }
            setActiveTab(k as TabKey);
          }}
          mobileOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
        />

        {/* MAIN */}
        <main className="flex-1 min-w-0 flex flex-col">
          {/* Mobile top bar — hamburger opens sidebar drawer + horizontally
              scrolling project chips. Sidebar is hidden by default on mobile;
              this is the only entry point to nav. */}
          <div
            className="lg:hidden flex items-center gap-2 px-3 py-3 overflow-x-auto scrollbar-hide border-b"
            style={{
              background: "var(--color-bg)",
              borderColor: "var(--color-border)",
            }}
          >
            <button
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open menu"
              className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
              style={{
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            >
              {/* Inline hamburger so we don't depend on another lucide import */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            {projects.map((p) => {
              const isActive = view.kind === "project" && view.projectId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setView({ kind: "project", projectId: p.id })}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all"
                  style={
                    isActive
                      ? {
                          background:
                            "linear-gradient(90deg, var(--color-orange) 0%, #facc15 100%)",
                          color: "#000",
                        }
                      : {
                          background: "var(--color-bg-card)",
                          border: "1px solid var(--color-border)",
                          color: "var(--color-orange)",
                        }
                  }
                >
                  <Folder className="w-3.5 h-3.5" />
                  {p.name}
                </button>
              );
            })}
          </div>

          {/* PROJECT VIEW — header + horizontal tab pills + body */}
          {view.kind === "project" && activeProject && (
            <ProjectView
              project={activeProject}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              planActive={planActive}
              planExpiresAt={planExpiresAt}
              onGotoBilling={() => setView({ kind: "billing" })}
            />
          )}

          {/* Project picked but missing (deleted in another tab) */}
          {view.kind === "project" && !activeProject && projectsLoaded && (
            <EmptyState
              title="Project not found"
              hint="Pick another project from the sidebar."
            />
          )}

          {/* Dashboard landing — production summary with date filter */}
          {view.kind === "dashboard" && (
            <DashboardOverview name={name} />
          )}

          {/* Tool view — future Url to Ad placeholder */}
          {view.kind === "tool" && view.toolId === "url-to-ad" && (
            <ToolPlaceholder
              title="Url to Ad"
              hint={
                projects.length === 0 && projectsLoaded
                  ? "Create a project from the sidebar to get started."
                  : "Coming soon — paste a product URL and turn it into an ad."
              }
              showCreateProject={projects.length === 0 && projectsLoaded}
            />
          )}

          {view.kind === "attachments" && <AttachmentsSection />}
          {view.kind === "billing" && (
            <SectionWrap>
              <BillingSection />
            </SectionWrap>
          )}
          {view.kind === "credit" && (
            <SectionWrap>
              <CreditSection credits={credits} />
            </SectionWrap>
          )}
          {view.kind === "affiliate" && (
            <SectionWrap>
              {planActive && (plan === "pro" || plan === "premium") ? (
                <AffiliateSection />
              ) : (
                <PerkUpgradeNotice
                  perkLabel="Affiliate program"
                  description="Affiliate program (20% referral commission) termasuk dalam plan Pro (RM 120) dan Premium (RM 200) sahaja. Subscribe untuk dapat referral code anda + dashboard commission tracking."
                  onGotoBilling={() => setView({ kind: "billing" })}
                />
              )}
            </SectionWrap>
          )}
          {view.kind === "usage" && (
            <SectionWrap>
              <UsageSection email={email} />
            </SectionWrap>
          )}
          {view.kind === "saved-prompts" && <SavedPromptsSection />}
          {view.kind === "storage" && (
            <SectionWrap>
              <StorageSection />
            </SectionWrap>
          )}
          {view.kind === "settings" && (
            <SectionWrap>
              <SettingsSection email={email} name={name} />
            </SectionWrap>
          )}

          {!projectsLoaded && (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--color-orange)]" />
            </div>
          )}
        </main>
      </div>

      {/* Floating SOP help button — mounts once globally, picks the
          right SOP page based on current view / activeTab. Returns null
          (renders nothing) for pages that don't have SOP content yet. */}
      <SopButton sop={resolveActiveSop(view, activeTab)} />
    </div>
  );
}

// Map dashboard view+tab to a SOP page key. Tab keys aren't 1:1 with
// SOP keys ("video" tab is shown as "UGC", "cinema" tab is "Story",
// "seedance" tab is "Cinema") so we translate explicitly.
function resolveActiveSop(view: SidebarView, activeTab: TabKey) {
  let key: string | null = null;
  if (view.kind === "project") {
    const map: Record<TabKey, string> = {
      image: "image",
      video: "ugc",
      auto: "auto-content",
      cinema: "story",
      grok: "story",
      sora2: "story", // Sora 2 reuses Story SOP content
      seedance: "cinema",
      clone: "clone-prompt",
      fairytale: "fairytale",
      // Original Video reuses Story SOP for now (no dedicated SOP yet).
      "original-video": "story",
    };
    key = map[activeTab];
  } else if (view.kind === "billing") key = "billing";
  else if (view.kind === "credit") key = "top-up";
  else if (view.kind === "usage") key = "usage";
  else if (view.kind === "saved-prompts") key = "saved-prompts";
  else if (view.kind === "settings") key = "settings";
  else if (view.kind === "dashboard") key = "dashboard";
  return key ? SOP_CONTENT[key] || null : null;
}

function ProjectView({
  project,
  activeTab,
  onTabChange,
  planActive,
  planExpiresAt,
  onGotoBilling,
}: {
  project: Project;
  activeTab: TabKey;
  onTabChange: (t: TabKey) => void;
  planActive: boolean;
  planExpiresAt: string | null;
  onGotoBilling: () => void;
}) {
  const active = TABS.find((t) => t.key === activeTab)!;
  return (
    <>
      {/* Project header — desktop unchanged (lg+ only) + mobile gets a
          compact version below the hamburger bar. */}
      <header className="hidden lg:flex items-end justify-between px-10 pt-8 pb-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Folder className="w-3.5 h-3.5" style={{ color: "var(--color-orange)" }} />
            <span
              className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold"
              style={{ color: "var(--color-orange)" }}
            >
              Project
            </span>
          </div>
          <h1 className="font-display font-extrabold text-3xl tracking-tight leading-none text-[var(--color-text-primary)]">
            {project.name}
          </h1>
        </div>
      </header>

      {/* Mobile project header — slimmer, hidden on desktop */}
      <header className="lg:hidden flex items-center gap-2 px-5 pt-4 pb-2">
        <Folder className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--color-orange)" }} />
        <h1 className="font-display font-extrabold text-lg tracking-tight leading-none text-[var(--color-text-primary)] truncate">
          {project.name}
        </h1>
      </header>

      {/* Tab pills — desktop-only (hidden on mobile, where tabs live in
          sidebar Tools section instead). Behaviour preserved 1:1 with the
          pre-mobile-pass version. */}
      <div className="hidden lg:block px-5 lg:px-10 pt-2">
        <div
          className="flex gap-2 overflow-x-auto pb-2 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.key;
            const locked = !planActive;
            return (
              <button
                key={t.key}
                onClick={() => (locked ? onGotoBilling() : onTabChange(t.key))}
                title={locked ? "Subscribe to unlock" : t.label}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold whitespace-nowrap transition-all"
                style={
                  isActive && !locked
                    ? {
                        background:
                          "linear-gradient(135deg, #facc15 0%, #eab308 100%)",
                        color: "#000",
                        boxShadow: "0 4px 14px rgba(250,204,21,0.3)",
                      }
                    : {
                        background: "var(--color-bg-card)",
                        border: "1px solid var(--color-border)",
                        color: "var(--color-text-secondary)",
                        opacity: locked ? 0.6 : 1,
                      }
                }
              >
                <Icon className="w-4 h-4" strokeWidth={2.4} />
                {t.label}
                <span
                  className="font-mono text-[10px] tracking-wider"
                  style={{
                    color: isActive && !locked ? "rgba(255,255,255,0.7)" : "var(--color-text-muted)",
                  }}
                >
                  {locked ? "🔒" : t.tag}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mobile inactive-subscription notice — desktop's locked path is
          handled by the tab pill onClick routing to billing. */}
      {!planActive && (
        <button
          onClick={onGotoBilling}
          className="lg:hidden mx-5 mb-2 px-4 py-2 rounded-lg text-xs font-bold"
          style={{
            background: "rgba(255,87,34,0.12)",
            color: "var(--color-orange)",
            border: "1px solid rgba(255,87,34,0.3)",
          }}
        >
          🔒 Subscription inactive — tap to renew
        </button>
      )}

      {/* Locked state — show a single Renew CTA in place of the tab body */}
      {!planActive && (
        <div className="flex-1 px-5 lg:px-10 pt-10 pb-12">
          <SubscriptionLocked
            expiresAt={planExpiresAt}
            onGotoBilling={onGotoBilling}
          />
        </div>
      )}

      {/* Tab body — only rendered when subscription is active */}
      {planActive && (
        <div key={project.id} className="flex-1 px-5 lg:px-10 pt-6 pb-10 lg:pb-12 space-y-6">
          {activeTab === "image" && (
            <>
              <div className="max-w-5xl mx-auto w-full">
                <ImageTab projectId={project.id} />
              </div>
              <HistoryGrid tab="image" title={`Image — ${project.name}`} projectId={project.id} />
            </>
          )}
          {activeTab === "video" && (
            <>
              <div className="max-w-5xl mx-auto w-full">
                <VideoTab projectId={project.id} />
              </div>
              <HistoryGrid tab="video" title={`UGC — ${project.name}`} projectId={project.id} />
            </>
          )}
          {activeTab === "cinema" && (
            <>
              <div className="max-w-5xl mx-auto w-full">
                <CinemaTab projectId={project.id} />
              </div>
              <HistoryGrid tab="cinema" title={`Viral — ${project.name}`} projectId={project.id} />
            </>
          )}
          {activeTab === "grok" && (
            <>
              <div className="max-w-5xl mx-auto w-full">
                <GrokTab projectId={project.id} />
              </div>
              <HistoryGrid tab="grok" title={`Grok — ${project.name}`} projectId={project.id} />
            </>
          )}
          {activeTab === "original-video" && (
            <>
              <div className="max-w-5xl mx-auto w-full">
                <OriginalVideoTab projectId={project.id} />
              </div>
              {/* Original Video posts to /api/generate/cinema with
                  feature='original-video'; the route stamps the row
                  with tab='original-video' so this history grid query
                  picks up only Original Video rows (not legacy Viral
                  rows that still carry tab='cinema'). */}
              <HistoryGrid
                tab="original-video"
                title={`Original Video — ${project.name}`}
                projectId={project.id}
              />
            </>
          )}
          {activeTab === "sora2" && (
            <>
              <div className="max-w-5xl mx-auto w-full">
                <Sora2Tab projectId={project.id} />
              </div>
              <HistoryGrid tab="sora2" title={`Sora 2 — ${project.name}`} projectId={project.id} />
            </>
          )}
          {activeTab === "seedance" && (
            <>
              <div className="max-w-5xl mx-auto w-full">
                <SeedanceTab projectId={project.id} />
              </div>
              <HistoryGrid tab="seedance" title={`Cinema — ${project.name}`} projectId={project.id} />
            </>
          )}
          {activeTab === "clone" && (
            <>
              <div className="max-w-5xl mx-auto w-full">
                <CloneTab projectId={project.id} />
              </div>
              <HistoryGrid tab="clone" title={`Clone — ${project.name}`} projectId={project.id} />
            </>
          )}
          {activeTab === "auto" && (
            <>
              <div className="max-w-5xl mx-auto w-full">
                <AutoContentTab projectId={project.id} />
              </div>
              <HistoryGrid tab="auto" title={`Auto Content — ${project.name}`} projectId={project.id} />
            </>
          )}
          {activeTab === "fairytale" && (
            <>
              <div className="max-w-6xl mx-auto w-full">
                <FairytaleTab projectId={project.id} />
              </div>
              <HistoryGrid tab="fairytale" title={`Storytelling — ${project.name}`} projectId={project.id} />
            </>
          )}
        </div>
      )}

      {/* PeningLab Live Chat — unified knowledge panel. Per user direction
          (2026-06-08), the panel uses ONE knowledge base covering every
          visible tab + MCP API + Auto Post TikTok extension + plans &
          billing, regardless of which tab is active. Renders on EVERY
          visible tab + the special clone / original-video routes so new
          customers can ask anything from anywhere. The `tab` prop is now
          purely cosmetic (used for the panel header label) — knowledge
          comes from getUnifiedKnowledge() in lib/qa-knowledge.ts. */}
      {planActive && (
        <QAChatPanel
          tab={
            (activeTab === "video"
              ? "ugc"
              : activeTab === "auto"
                ? "auto"
                : activeTab === "fairytale"
                  ? "fairytale"
                  : activeTab === "sora2"
                    ? "sora2"
                    : activeTab === "original-video"
                      ? "cinema"
                      : activeTab === "clone"
                        ? "image"
                        : activeTab === "grok"
                          ? "cinema"
                          : activeTab) as QATab
          }
        />
      )}
    </>
  );
}

// Locked state when the subscription is missing/expired. Replaces the tab
// body with a single CTA that routes to Billing.
function SubscriptionLocked({
  expiresAt,
  onGotoBilling,
}: {
  expiresAt: string | null;
  onGotoBilling: () => void;
}) {
  const expiredOn = expiresAt
    ? new Date(expiresAt).toLocaleDateString("ms-MY", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;
  const wasOnce = !!expiresAt;
  return (
    <div className="max-w-2xl mx-auto w-full">
      <div
        className="rounded-3xl p-8 md:p-10 relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, #1a0a05 0%, #2d1208 50%, #4d1f0a 100%)",
        }}
      >
        <div
          className="absolute"
          style={{
            top: -120,
            right: -120,
            width: 360,
            height: 360,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(255, 87, 34, 0.35), transparent 70%)",
            filter: "blur(60px)",
          }}
        />
        <div className="relative">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 border border-white/20 text-xs font-bold uppercase tracking-wider text-white mb-4">
            🔒 {wasOnce ? "Subscription expired" : "No active plan"}
          </div>
          <h2 className="font-display font-extrabold text-4xl md:text-5xl tracking-tight text-white mb-3">
            {wasOnce ? "Renew Pro Plan" : "Subscribe Pro Plan"}
          </h2>
          <p className="text-white/80 text-base mb-6 max-w-lg">
            {wasOnce
              ? `Subscription habis tempoh pada ${expiredOn}. Renew untuk akses balik Image, UGC, Cinema, Clone Prompt, dan Auto Content.`
              : "Pilih plan untuk unlock semua features — Image AI, UGC, Cinema, Clone Prompt, Auto Content. Starter RM 35 sampai Premium RM 200 · termasuk credits."}
          </p>
          <button
            onClick={onGotoBilling}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-extrabold text-sm transition-transform hover:-translate-y-0.5"
            style={{
              background: "linear-gradient(90deg, #facc15 0%, #eab308 100%)",
              color: "#000",
              boxShadow: "0 8px 24px rgba(250,204,21,0.35)",
            }}
          >
            {wasOnce ? "Renew now" : "Pilih Plan"}
            →
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 px-5 lg:px-10 pt-8 pb-10 lg:pb-12">{children}</div>
  );
}

function ToolPlaceholder({
  title,
  hint,
  showCreateProject,
}: {
  title: string;
  hint: string;
  showCreateProject?: boolean;
}) {
  async function quickCreate() {
    const r = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Project 1" }),
    });
    if (r.ok) window.location.reload();
  }
  return (
    <div className="flex-1 flex items-center justify-center px-5 py-16">
      <div className="text-center max-w-md">
        <div
          className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)",
            boxShadow: "0 12px 32px rgba(236,72,153,0.3)",
          }}
        >
          <Wand2 className="w-7 h-7 text-white" strokeWidth={2.4} />
        </div>
        <h2 className="font-display font-extrabold text-2xl mb-2 text-[var(--color-text-primary)]">
          {title}
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)] mb-6">{hint}</p>
        {showCreateProject && (
          <button
            onClick={quickCreate}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl font-extrabold text-sm text-white transition-transform hover:-translate-y-0.5"
            style={{
              background:
                "linear-gradient(90deg, var(--color-orange) 0%, #facc15 100%)",
              boxShadow: "0 4px 14px rgba(255,87,34,0.3)",
            }}
          >
            <Plus className="w-4 h-4" />
            Create your first project
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex-1 flex items-center justify-center px-5 py-16">
      <div className="text-center max-w-md">
        <Folder
          className="w-12 h-12 mx-auto mb-4"
          style={{ color: "var(--color-text-muted)" }}
        />
        <h2 className="font-display font-extrabold text-xl mb-2 text-[var(--color-text-primary)]">
          {title}
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)]">{hint}</p>
      </div>
    </div>
  );
}

// Generic "this perk is gated to higher tiers" panel. Used when a
// Starter / Standard user lands on a dashboard view that only
// Pro / Premium can use (e.g. Affiliate). Renders the same upgrade
// CTA layout the MCP page uses.
function PerkUpgradeNotice({
  perkLabel,
  description,
  onGotoBilling,
}: {
  perkLabel: string;
  description: string;
  onGotoBilling: () => void;
}) {
  return (
    <div className="max-w-2xl mx-auto w-full">
      <div
        className="card p-8 border-2"
        style={{
          background: "rgba(250, 204, 21, 0.05)",
          borderColor: "rgba(250, 204, 21, 0.35)",
        }}
      >
        <div className="text-center mb-6">
          <div
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-widest mb-4"
            style={{
              background: "linear-gradient(90deg, #facc15 0%, #eab308 100%)",
              color: "#000",
            }}
          >
            Pro / Premium only
          </div>
          <h2 className="font-display font-extrabold text-2xl mb-3">
            Upgrade untuk akses {perkLabel}
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)] max-w-md mx-auto">
            {description}
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 mb-6">
          <div
            className="p-4 rounded-xl"
            style={{
              background: "var(--color-bg-elev)",
              border: "1px solid var(--color-border)",
            }}
          >
            <div className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-text-muted)] mb-1">
              Pro
            </div>
            <div className="font-display font-extrabold text-2xl">RM 120</div>
            <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
              /30 hari + RM 50 credits
            </div>
          </div>
          <div
            className="p-4 rounded-xl"
            style={{
              background: "var(--color-bg-elev)",
              border: "1px solid var(--color-border)",
            }}
          >
            <div className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-text-muted)] mb-1">
              Premium
            </div>
            <div className="font-display font-extrabold text-2xl">RM 200</div>
            <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
              /30 hari + RM 100 credits
            </div>
          </div>
        </div>
        <button
          onClick={onGotoBilling}
          className="w-full py-3 rounded-xl text-sm font-extrabold inline-flex items-center justify-center"
          style={{
            background: "linear-gradient(90deg, #facc15 0%, #eab308 100%)",
            color: "#000",
          }}
        >
          Pergi ke Billing → Upgrade
        </button>
      </div>
    </div>
  );
}
