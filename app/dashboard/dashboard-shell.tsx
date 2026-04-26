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
} from "lucide-react";
import ImageTab from "./tabs/image";
import VideoTab from "./tabs/video";
import CinemaTab from "./tabs/cinema";
import CloneTab from "./tabs/clone";
import AutoContentTab from "./tabs/auto-content";
import HistoryGrid from "./sections/history-grid";
import BillingSection from "./sections/billing";
import CreditSection from "./sections/credit";
import UsageSection from "./sections/usage";
import SettingsSection from "./sections/settings";
import Sidebar, { type Project, type SidebarView } from "./sidebar";

type TabKey = "image" | "video" | "cinema" | "clone" | "auto";

const TABS: { key: TabKey; label: string; icon: any; tag: string }[] = [
  { key: "image", label: "Image", icon: ImageIcon, tag: "01" },
  { key: "video", label: "UGC", icon: Video, tag: "02" },
  { key: "cinema", label: "Cinema", icon: Film, tag: "03" },
  { key: "clone", label: "Clone Prompt", icon: Layers, tag: "04" },
  { key: "auto", label: "Auto Content", icon: Wand2, tag: "05" },
];

export default function DashboardShell({
  email,
  name,
  credits,
  planActive,
  planExpiresAt,
}: {
  email: string;
  name: string;
  credits: number;
  planActive: boolean;
  planExpiresAt: string | null;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectLimit, setProjectLimit] = useState(4);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [view, setView] = useState<SidebarView>({ kind: "tool", toolId: "url-to-ad" });
  const [activeTab, setActiveTab] = useState<TabKey>("image");

  // Initial fetch — list projects only. Don't auto-select; the user picks
  // which project to open from the sidebar.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/projects", { cache: "no-store" });
        const d = await r.json();
        if (r.ok && d?.ok) {
          setProjects(d.projects || []);
          if (typeof d.limit === "number") setProjectLimit(d.limit);
        }
      } finally {
        setProjectsLoaded(true);
      }
    })();
  }, []);

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

      <div className="relative z-10 flex min-h-screen items-stretch">
        <Sidebar
          email={email}
          name={name}
          credits={credits}
          planActive={planActive}
          planExpiresAt={planExpiresAt}
          projects={projects}
          projectLimit={projectLimit}
          onProjectsChange={setProjects}
          view={view}
          onViewChange={setView}
        />

        {/* MAIN */}
        <main className="flex-1 min-w-0 flex flex-col">
          {/* Mobile project picker (no sidebar on mobile) */}
          <div
            className="lg:hidden flex gap-2 px-5 py-3 overflow-x-auto border-b"
            style={{
              background: "var(--color-bg)",
              borderColor: "var(--color-border)",
            }}
          >
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
                            "linear-gradient(90deg, var(--color-orange) 0%, #ff6a1a 100%)",
                          color: "white",
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

          {/* Tool view — Url to Ad placeholder, also default landing */}
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
          {view.kind === "usage" && (
            <SectionWrap>
              <UsageSection email={email} />
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
    </div>
  );
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
      {/* Project header */}
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

      {/* Tab pills — Image / UGC / Cinema / Clone / Auto Content. When the
          subscription is inactive every click routes to Billing instead. */}
      <div className="px-5 lg:px-10 pt-2">
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
                          "linear-gradient(135deg, #ff6a1a 0%, #ff4d00 100%)",
                        color: "white",
                        boxShadow: "0 4px 14px rgba(255,87,34,0.3)",
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
              <HistoryGrid tab="cinema" title={`Cinema — ${project.name}`} projectId={project.id} />
            </>
          )}
          {activeTab === "clone" && (
            <div className="max-w-5xl mx-auto w-full">
              <CloneTab projectId={project.id} />
            </div>
          )}
          {activeTab === "auto" && (
            <>
              <div className="max-w-5xl mx-auto w-full">
                <AutoContentTab projectId={project.id} />
              </div>
              <HistoryGrid tab="auto" title={`Auto Content — ${project.name}`} projectId={project.id} />
            </>
          )}
        </div>
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
              : "Subscribe Pro Plan untuk unlock semua features — Image AI, UGC, Cinema, Clone Prompt, Auto Content. RM75/bulan, cancel bila-bila."}
          </p>
          <button
            onClick={onGotoBilling}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-extrabold text-sm transition-transform hover:-translate-y-0.5"
            style={{
              background: "linear-gradient(90deg, #ff6a1a 0%, #ff4d00 100%)",
              color: "white",
              boxShadow: "0 8px 24px rgba(255,87,34,0.35)",
            }}
          >
            {wasOnce ? "Renew now" : "Subscribe RM75/bulan"}
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
                "linear-gradient(90deg, var(--color-orange) 0%, #ff6a1a 100%)",
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
