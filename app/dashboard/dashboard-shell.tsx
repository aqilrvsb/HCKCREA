"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  Wallet,
  CreditCard,
  Activity,
  LayoutGrid,
  Settings,
} from "lucide-react";
import LogoutButton from "./logout-button";
import StudioSection from "./sections/studio";
import BillingSection from "./sections/billing";
import CreditSection from "./sections/credit";
import UsageSection from "./sections/usage";

type SectionKey = "studio" | "billing" | "credit" | "usage";

const SECTIONS: { key: SectionKey; label: string; icon: any; tag: string }[] = [
  { key: "studio", label: "Studio", icon: LayoutGrid, tag: "01" },
  { key: "billing", label: "Billing", icon: CreditCard, tag: "02" },
  { key: "credit", label: "Top Up", icon: Wallet, tag: "03" },
  { key: "usage", label: "Usage", icon: Activity, tag: "04" },
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
  const [section, setSection] = useState<SectionKey>("studio");
  const active = SECTIONS.find((s) => s.key === section)!;

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="bg-sky" />
      <div
        className="bg-soft-glow"
        style={{
          background: "radial-gradient(circle, #c4b5fd, transparent 70%)",
          width: 600,
          height: 600,
          top: -200,
          right: -200,
        }}
      />

      <div className="relative z-10 flex min-h-screen">
        {/* SIDEBAR — distinctive: glass blur + gradient active state + mono accents */}
        <aside className="hidden lg:flex flex-col w-[272px] flex-shrink-0 border-r border-white/40 bg-white/55 backdrop-blur-2xl">
          {/* Logo */}
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 px-7 py-6 border-b border-white/40"
          >
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-400 via-violet-500 to-blue-500 flex items-center justify-center shadow-lg shadow-violet-500/40">
              <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <div className="font-display font-extrabold text-xl tracking-tight leading-none">
                PeningLab
              </div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mt-1">
                Studio v1.0
              </div>
            </div>
          </Link>

          {/* Section heading */}
          <div className="px-7 pt-6 pb-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-muted)] font-bold">
              ─── Workspace
            </div>
          </div>

          {/* Nav items */}
          <nav className="px-3 space-y-1.5">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const isActive = section === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setSection(s.key)}
                  className={`group relative w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-sm transition-all ${
                    isActive
                      ? "text-white"
                      : "text-[var(--color-text-secondary)] hover:bg-white/60"
                  }`}
                >
                  {/* Gradient active pill */}
                  {isActive && (
                    <div
                      className="absolute inset-0 rounded-xl"
                      style={{
                        background:
                          "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)",
                        boxShadow:
                          "0 8px 24px rgba(139, 92, 246, 0.35), inset 0 1px 0 rgba(255,255,255,0.2)",
                      }}
                    />
                  )}
                  <span className="relative flex items-center gap-3 w-full">
                    <Icon
                      className={`w-4 h-4 ${isActive ? "" : "text-[var(--color-text-muted)] group-hover:text-violet-600"}`}
                      strokeWidth={2.2}
                    />
                    <span className="flex-1 text-left">{s.label}</span>
                    <span
                      className={`font-mono text-[10px] tracking-wider ${
                        isActive ? "text-white/70" : "text-[var(--color-text-muted)]"
                      }`}
                    >
                      {s.tag}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Credit pill — distinctive treatment */}
          <div className="px-5 pb-3">
            <div className="relative overflow-hidden rounded-2xl p-4 bg-gradient-to-br from-violet-50 via-white to-blue-50 border border-violet-100">
              <div className="flex items-center gap-2 mb-1">
                <Wallet className="w-3.5 h-3.5 text-violet-600" />
                <span className="font-mono text-[10px] uppercase tracking-widest text-violet-700 font-bold">
                  Credit Balance
                </span>
              </div>
              <div className="font-display font-extrabold text-3xl tracking-tight">
                {credits.toFixed(2)}
              </div>
              <button
                onClick={() => setSection("credit")}
                className="mt-3 w-full py-2 rounded-lg bg-gradient-to-r from-violet-500 to-blue-500 text-white text-xs font-bold hover:scale-[1.02] transition-transform"
              >
                + Top Up
              </button>
            </div>
          </div>

          {/* User card */}
          <div className="px-5 pb-5 pt-2 border-t border-white/40">
            <div className="flex items-center gap-3 px-2 py-2 mb-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-300 to-blue-400 flex-shrink-0 ring-2 ring-white" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{name}</div>
                <div className="text-xs text-[var(--color-text-muted)] truncate">
                  {email}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white/70 border border-[var(--color-border)] text-xs font-medium hover:border-violet-300 transition">
                <Settings className="w-3.5 h-3.5" />
                Settings
              </button>
              <LogoutButton compact />
            </div>
          </div>
        </aside>

        {/* MAIN */}
        <main className="flex-1 min-w-0 flex flex-col">
          {/* Mobile header */}
          <div className="lg:hidden flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] bg-white/70 backdrop-blur-md">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-400 via-violet-500 to-blue-500 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" strokeWidth={2.5} />
              </div>
              <span className="font-display font-extrabold text-lg">PeningLab</span>
            </Link>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-50 border border-violet-100">
              <Wallet className="w-3.5 h-3.5 text-violet-600" />
              <span className="text-xs font-bold text-violet-700">
                {credits.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Mobile section pills */}
          <div className="lg:hidden flex gap-2 px-5 py-3 overflow-x-auto border-b border-[var(--color-border)] bg-white/40 backdrop-blur-md">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const isActive = section === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setSection(s.key)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap ${
                    isActive
                      ? "bg-gradient-to-r from-violet-500 to-blue-500 text-white"
                      : "bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)]"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Section header — desktop */}
          <header className="hidden lg:flex items-end justify-between px-10 pt-8 pb-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-violet-600 font-bold">
                  ─ {active.tag}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-muted)] font-bold">
                  {active.label}
                </span>
              </div>
              <h1 className="font-display font-extrabold text-4xl tracking-tight leading-none">
                Welcome back, <span className="gradient-text-violet">{name}</span>
              </h1>
              <p className="text-sm text-[var(--color-text-secondary)] mt-2">
                {email}
              </p>
            </div>
          </header>

          {/* Body */}
          <div className="flex-1 px-5 lg:px-10 pb-10 lg:pb-12">
            {section === "studio" && <StudioSection />}
            {section === "billing" && <BillingSection />}
            {section === "credit" && <CreditSection credits={credits} />}
            {section === "usage" && <UsageSection email={email} />}
          </div>
        </main>
      </div>
    </div>
  );
}
