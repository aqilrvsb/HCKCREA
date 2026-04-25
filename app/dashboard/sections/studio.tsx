"use client";

import { useState } from "react";
import { Wand2, ImageIcon, Video, Layers, Send, History } from "lucide-react";
import AutoContentTab from "../tabs/auto-content";
import ImageTab from "../tabs/image";
import VideoTab from "../tabs/video";
import CloneTab from "../tabs/clone";
import AutoPostTab from "../tabs/auto-post";

type TabKey = "auto" | "image" | "video" | "clone" | "post";

const TABS: { key: TabKey; label: string; icon: any; color: string }[] = [
  { key: "auto", label: "Auto Content", icon: Wand2, color: "violet" },
  { key: "image", label: "Image", icon: ImageIcon, color: "blue" },
  { key: "video", label: "Video", icon: Video, color: "pink" },
  { key: "clone", label: "Clone", icon: Layers, color: "amber" },
  { key: "post", label: "Auto Post", icon: Send, color: "emerald" },
];

const COLOR_MAP: Record<string, { bg: string; text: string }> = {
  violet: { bg: "bg-violet-50", text: "text-violet-700" },
  blue: { bg: "bg-blue-50", text: "text-blue-700" },
  pink: { bg: "bg-pink-50", text: "text-pink-700" },
  amber: { bg: "bg-amber-50", text: "text-amber-700" },
  emerald: { bg: "bg-emerald-50", text: "text-emerald-700" },
};

export default function StudioSection() {
  const [tab, setTab] = useState<TabKey>("auto");
  const active = TABS.find((t) => t.key === tab)!;

  return (
    <div>
      {/* Tab strip */}
      <div className="flex flex-wrap gap-2 p-1.5 bg-white border border-[var(--color-border)] rounded-2xl shadow-sm w-fit mb-5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.key;
          const c = COLOR_MAP[t.color];
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition ${
                isActive
                  ? `${c.bg} ${c.text}`
                  : "text-[var(--color-text-secondary)] hover:bg-gray-50"
              }`}
            >
              <Icon className="w-4 h-4" strokeWidth={2.2} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 50/50 split */}
      <div className="grid lg:grid-cols-2 gap-5 min-h-[600px]">
        <section className="card flex flex-col">
          {tab === "auto" && <AutoContentTab />}
          {tab === "image" && <ImageTab />}
          {tab === "video" && <VideoTab />}
          {tab === "clone" && <CloneTab />}
          {tab === "post" && <AutoPostTab />}
        </section>

        <section className="card flex flex-col">
          <div className="flex items-center justify-between mb-5 pb-4 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-[var(--color-text-muted)]" />
              <h2 className="font-display font-bold text-xl">
                History — {active.label}
              </h2>
            </div>
            <span className="text-xs text-[var(--color-text-muted)] font-mono">
              0 items
            </span>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mb-4">
              <History className="w-7 h-7 text-gray-300" />
            </div>
            <p className="text-[var(--color-text-secondary)] font-medium mb-1">
              Belum ada history.
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">
              Generate sesuatu dahulu, output akan muncul di sini.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
