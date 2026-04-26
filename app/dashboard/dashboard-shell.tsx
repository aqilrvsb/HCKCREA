"use client";

import { useEffect, useState } from "react";
import {
  ImageIcon,
  Video,
  Layers,
  Wand2,
  Mic,
  Folder,
  Loader2,
  Plus,
} from "lucide-react";
import ImageTab from "./tabs/image";
import VideoTab from "./tabs/video";
import UgcTab from "./tabs/ugc";
import CloneTab from "./tabs/clone";
import AutoContentTab from "./tabs/auto-content";
import HistoryGrid from "./sections/history-grid";
import BillingSection from "./sections/billing";
import CreditSection from "./sections/credit";
import UsageSection from "./sections/usage";
import SettingsSection from "./sections/settings";
import Sidebar, { type Project, type SidebarView } from "./sidebar";

type TabKey = "image" | "video" | "ugc" | "clone" | "auto";

const TABS: { key: TabKey; label: string; icon: any; tag: string }[] = [
  { key: "image", label: "Image", icon: ImageIcon, tag: "01" },
  { key: "video", label: "Video", icon: Video, tag: "02" },
  { key: "ugc", label: "UGC", icon: Mic, tag: "03" },
  { key: "clone", label: "Clone", icon: Layers, tag: "04" },
  { key: "auto", label: "Auto Content", icon: Wand2, tag: "05" },
];

export default function DashboardShell({
  email,
  name,
  credits,
}: {
  email: string;
  name: string;
  credits: number;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectLimit, setProjectLimit] = useState(4);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [view, setView] = useState<SidebarView>({ kind: "tool", toolId: "url-to-ad" });
  const [activeTab, setActiveTab] = useState<TabKey>("image");

  // Initial fetch — auto-select first project if any
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/projects", { cache: "no-store" });
        const d = await r.json();
        if (r.ok && d?.ok) {
          setProjects(d.projects || []);
          if (typeof d.limit === "number") setProjectLimit(d.limit);
          if (d.projects?.length) {
            setView({ kind: "project", projectId: d.projects[0].id });
          }
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
    <div className="relative min-h-screen overflow-hidden">
      <div className="bg-sky" />

      <div className="relative z-10 flex min-h-screen">
        <Sidebar
          email={email}
          name={name}
          credits={credits}
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
}: {
  project: Project;
  activeTab: TabKey;
  onTabChange: (t: TabKey) => void;
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

      {/* Tab pills — Image / Video / UGC / Clone / Auto Content */}
      <div className="px-5 lg:px-10 pt-2">
        <div
          className="flex gap-2 overflow-x-auto pb-2 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => onTabChange(t.key)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold whitespace-nowrap transition-all"
                style={
                  isActive
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
                      }
                }
              >
                <Icon className="w-4 h-4" strokeWidth={2.4} />
                {t.label}
                <span
                  className="font-mono text-[10px] tracking-wider"
                  style={{
                    color: isActive ? "rgba(255,255,255,0.7)" : "var(--color-text-muted)",
                  }}
                >
                  {t.tag}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab body — keyed on project.id so state resets per project */}
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
            <section className="card max-w-3xl mx-auto w-full">
              <VideoTab projectId={project.id} />
            </section>
            <HistoryGrid tab="video" title={`Video — ${project.name}`} projectId={project.id} />
          </>
        )}
        {activeTab === "ugc" && (
          <section className="card max-w-3xl mx-auto w-full">
            <UgcTab />
          </section>
        )}
        {activeTab === "clone" && (
          <>
            <section className="card max-w-3xl mx-auto w-full">
              <CloneTab projectId={project.id} />
            </section>
            <HistoryGrid tab="clone" title={`Clone — ${project.name}`} projectId={project.id} />
          </>
        )}
        {activeTab === "auto" && (
          <>
            <section className="card max-w-3xl mx-auto w-full">
              <AutoContentTab projectId={project.id} />
            </section>
            <HistoryGrid tab="auto" title={`Auto Content — ${project.name}`} projectId={project.id} />
          </>
        )}
      </div>
    </>
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
