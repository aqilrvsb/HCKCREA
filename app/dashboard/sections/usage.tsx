"use client";

import { useState } from "react";
import {
  Activity,
  ImageIcon,
  Video,
  Wand2,
  Layers,
  Send,
  Filter,
  Calendar,
  TrendingDown,
} from "lucide-react";

type Filter = "all" | "image" | "video" | "auto" | "clone" | "post";

const FILTER_TABS: {
  key: Filter;
  label: string;
  icon: any;
  match?: (m: string) => boolean;
}[] = [
  { key: "all", label: "All", icon: Activity },
  {
    key: "image",
    label: "Image",
    icon: ImageIcon,
    match: (m) => m.startsWith("image"),
  },
  {
    key: "video",
    label: "Video",
    icon: Video,
    match: (m) => m.startsWith("video"),
  },
  {
    key: "auto",
    label: "Auto",
    icon: Wand2,
    match: (m) => m.startsWith("auto"),
  },
  {
    key: "clone",
    label: "Clone",
    icon: Layers,
    match: (m) => m.startsWith("clone"),
  },
  {
    key: "post",
    label: "Post",
    icon: Send,
    match: (m) => m.startsWith("post"),
  },
];

export default function UsageSection({ email }: { email: string }) {
  const [filter, setFilter] = useState<Filter>("all");

  // Mock summary stats — replace with real data from history table once wired
  const STATS = [
    { label: "Total spend", value: "0.00", suffix: "credits", accent: "violet" },
    { label: "Images", value: "0", suffix: "generated", accent: "blue" },
    { label: "Videos", value: "0", suffix: "generated", accent: "pink" },
    { label: "Auto plans", value: "0", suffix: "batches", accent: "amber" },
  ];

  const ACCENT: Record<string, string> = {
    violet: "text-violet-600",
    blue: "text-blue-600",
    pink: "text-pink-600",
    amber: "text-amber-600",
  };

  return (
    <div className="space-y-6">
      {/* Stats summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {STATS.map((s, i) => (
          <div key={i} className="card relative overflow-hidden">
            <div
              className="absolute"
              style={{
                top: -30,
                right: -30,
                width: 100,
                height: 100,
                borderRadius: "50%",
                background: `radial-gradient(circle, ${
                  s.accent === "violet"
                    ? "rgba(139,92,246,0.12)"
                    : s.accent === "blue"
                    ? "rgba(59,130,246,0.12)"
                    : s.accent === "pink"
                    ? "rgba(236,72,153,0.12)"
                    : "rgba(245,158,11,0.12)"
                }, transparent 70%)`,
              }}
            />
            <div className="relative">
              <div className="text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-2">
                {s.label}
              </div>
              <div className={`font-display font-extrabold text-3xl tracking-tight ${ACCENT[s.accent]}`}>
                {s.value}
              </div>
              <div className="text-xs text-[var(--color-text-muted)] mt-1">
                {s.suffix}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--color-border)] flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[var(--color-text-muted)]" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] font-bold">
              Filter
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTER_TABS.map((f) => {
              const Icon = f.icon;
              const isActive = filter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  style={
                    isActive
                      ? {
                          background: "var(--color-lime)",
                          color: "#0a0a0a",
                          boxShadow: "0 2px 8px rgba(200,245,62,0.3)",
                        }
                      : {
                          background: "var(--color-bg-card)",
                          border: "1px solid var(--color-border)",
                          color: "var(--color-text-secondary)",
                        }
                  }
                >
                  <Icon className="w-3 h-3" />
                  {f.label}
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <Calendar className="w-3.5 h-3.5" />
            <span>All time</span>
          </div>
        </div>

        {/* Table header */}
        <div
          className="hidden md:flex px-6 py-3 border-b border-[var(--color-border)] text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold"
          style={{ background: "rgba(200,245,62,0.04)" }}
        >
          <span className="flex-1">Action</span>
          <span className="flex-1">Description</span>
          <span className="w-32">Date</span>
          <span className="w-20 text-right">Credit</span>
          <span className="w-20 text-right">Balance</span>
        </div>

        {/* Empty state */}
        <div className="px-6 py-20 text-center">
          <div
            className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
            }}
          >
            <TrendingDown className="w-7 h-7 text-[var(--color-text-muted)]" />
          </div>
          <p className="text-[var(--color-text-secondary)] font-medium mb-1">
            Belum ada usage history.
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">
            Setiap kali generate image / video, deduction akan dicatat di sini.
          </p>
        </div>
      </div>
    </div>
  );
}
