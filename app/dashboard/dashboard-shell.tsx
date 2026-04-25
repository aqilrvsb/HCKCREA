"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  Wallet,
  Wand2,
  ImageIcon,
  Video,
  Layers,
  Send,
  Settings,
  History,
} from "lucide-react";
import LogoutButton from "./logout-button";
import AutoContentTab from "./tabs/auto-content";
import ImageTab from "./tabs/image";
import VideoTab from "./tabs/video";
import CloneTab from "./tabs/clone";
import AutoPostTab from "./tabs/auto-post";

type TabKey = "auto" | "image" | "video" | "clone" | "post";

const TABS: { key: TabKey; label: string; icon: any; accent: string }[] = [
  { key: "auto", label: "Auto Content", icon: Wand2, accent: "violet" },
  { key: "image", label: "Image", icon: ImageIcon, accent: "blue" },
  { key: "video", label: "Video", icon: Video, accent: "pink" },
  { key: "clone", label: "Clone", icon: Layers, accent: "amber" },
  { key: "post", label: "Auto Post", icon: Send, accent: "emerald" },
];

const ACCENT_MAP: Record<string, { bg: string; border: string; text: string; ring: string }> = {
  violet: { bg: "bg-violet-50", border: "border-violet-200", text: "text-violet-600", ring: "ring-violet-300" },
  blue: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-600", ring: "ring-blue-300" },
  pink: { bg: "bg-pink-50", border: "border-pink-200", text: "text-pink-600", ring: "ring-pink-300" },
  amber: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-600", ring: "ring-amber-300" },
  emerald: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-600", ring: "ring-emerald-300" },
};

export default function DashboardShell({
  email,
  name,
  credits,
}: {
  email: string;
  name: string;
  credits: number;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("auto");

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="bg-sky" />

      {/* Top nav */}
      <nav className="relative z-20 mx-auto max-w-[1600px] px-6 py-5 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-400 via-violet-500 to-blue-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
            <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-display font-extrabold text-2xl tracking-tight">
            PeningLab
          </span>
        </Link>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white border border-[var(--color-border)] shadow-sm">
            <Wallet className="w-4 h-4 text-violet-600" />
            <span className="text-sm font-semibold">{credits} kredit</span>
          </div>
          <button className="w-10 h-10 rounded-full bg-white border border-[var(--color-border)] flex items-center justify-center shadow-sm hover:border-violet-300 transition">
            <Settings className="w-4 h-4 text-[var(--color-text-secondary)]" />
          </button>
          <LogoutButton />
        </div>
      </nav>

      {/* Greeting */}
      <div className="relative z-10 mx-auto max-w-[1600px] px-6 mb-6">
        <p className="text-sm text-[var(--color-text-muted)] mb-1">
          Welcome back,
        </p>
        <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight">
          {name}
        </h1>
      </div>

      {/* Tab nav */}
      <div className="relative z-10 mx-auto max-w-[1600px] px-6 mb-5">
        <div className="flex flex-wrap gap-2 p-1.5 bg-white border border-[var(--color-border)] rounded-2xl shadow-sm w-fit">
          {TABS.map((t) => {
            const Icon = t.icon;
            const a = ACCENT_MAP[t.accent];
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition ${
                  isActive
                    ? `${a.bg} ${a.text}`
                    : "text-[var(--color-text-secondary)] hover:bg-gray-50"
                }`}
              >
                <Icon className="w-4 h-4" strokeWidth={2.2} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 50/50 split — workspace left, history right */}
      <main className="relative z-10 mx-auto max-w-[1600px] px-6 pb-12">
        <div className="grid lg:grid-cols-2 gap-5 min-h-[600px]">
          {/* LEFT — Workspace */}
          <section className="card flex flex-col">
            {activeTab === "auto" && <AutoContentTab />}
            {activeTab === "image" && <ImageTab />}
            {activeTab === "video" && <VideoTab />}
            {activeTab === "clone" && <CloneTab />}
            {activeTab === "post" && <AutoPostTab />}
          </section>

          {/* RIGHT — History */}
          <section className="card flex flex-col">
            <div className="flex items-center justify-between mb-5 pb-4 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-[var(--color-text-muted)]" />
                <h2 className="font-display font-bold text-xl">
                  History — {TABS.find((t) => t.key === activeTab)?.label}
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
      </main>
    </div>
  );
}
