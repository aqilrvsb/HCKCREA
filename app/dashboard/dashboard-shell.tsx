"use client";

import { useState } from "react";
import Link from "next/link";
import { useEffect } from "react";
import {
  Sparkles,
  Wallet,
  CreditCard,
  Activity,
  ImageIcon,
  Video,
  Layers,
  Wand2,
  Mic,
  Settings,
} from "lucide-react";
import LogoutButton from "./logout-button";
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

type SectionKey =
  | "image"
  | "video"
  | "ugc"
  | "clone"
  | "auto"
  | "billing"
  | "credit"
  | "usage"
  | "settings";

const SECTIONS: { key: SectionKey; label: string; icon: any; tag: string }[] = [
  { key: "image", label: "Image", icon: ImageIcon, tag: "01" },
  { key: "video", label: "Video", icon: Video, tag: "02" },
  { key: "ugc", label: "UGC", icon: Mic, tag: "03" },
  { key: "clone", label: "Clone", icon: Layers, tag: "04" },
  { key: "auto", label: "Auto Content", icon: Wand2, tag: "05" },
  { key: "billing", label: "Billing", icon: CreditCard, tag: "06" },
  { key: "credit", label: "Top Up", icon: Wallet, tag: "07" },
  { key: "usage", label: "Usage", icon: Activity, tag: "08" },
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
  const [section, setSection] = useState<SectionKey>("image");

  // Listen for cross-tab navigation (e.g. UGC builder's "Use in Video" button)
  useEffect(() => {
    const onGoto = (e: any) => {
      const target = e?.detail as SectionKey | undefined;
      if (target && SECTIONS.find((s) => s.key === target)) {
        setSection(target);
      }
    };
    window.addEventListener("dashboard:goto", onGoto);
    return () => window.removeEventListener("dashboard:goto", onGoto);
  }, []);
  const active = SECTIONS.find((s) => s.key === section)!;

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="bg-sky" />
      <div
        className="bg-soft-glow"
        style={{
          background: "radial-gradient(circle, #ffd4b8, transparent 70%)",
          width: 600,
          height: 600,
          top: -200,
          right: -200,
        }}
      />

      <div className="relative z-10 flex min-h-screen">
        {/* SIDEBAR — dark canvas + orange brand-color labels, bigger text */}
        <aside
          className="hidden lg:flex flex-col w-[280px] flex-shrink-0 border-r"
          style={{
            background: "var(--color-bg)",
            borderColor: "var(--color-border)",
          }}
        >
          {/* Logo */}
          <Link
            href="/dashboard"
            className="flex items-center gap-3 px-7 py-7 border-b"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-orange-400 via-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/30 flex-shrink-0">
              <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <div className="font-display font-extrabold text-2xl tracking-tight leading-none text-[var(--color-text-primary)]">
                PeningLab
              </div>
              <div
                className="font-mono text-[10px] uppercase tracking-widest mt-1.5 font-bold"
                style={{ color: "var(--color-orange)" }}
              >
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
                  className="group relative w-full flex items-center gap-4 px-5 py-4 rounded-xl font-bold text-base transition-all hover:translate-x-0.5"
                  style={
                    isActive
                      ? { color: "white" }
                      : { color: "var(--color-orange)", background: "transparent" }
                  }
                  onMouseEnter={(e) => {
                    if (!isActive)
                      e.currentTarget.style.background = "rgba(255,87,34,0.08)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "transparent";
                  }}
                >
                  {/* Gradient active pill */}
                  {isActive && (
                    <div
                      className="absolute inset-0 rounded-xl"
                      style={{
                        background:
                          "linear-gradient(135deg, #ff6a1a 0%, #ff4d00 100%)",
                        boxShadow:
                          "0 8px 24px rgba(255, 77, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.2)",
                      }}
                    />
                  )}
                  <span className="relative flex items-center gap-4 w-full">
                    <Icon className="w-5 h-5" strokeWidth={2.4} />
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

          {/* Credit pill — dark variant with orange accent */}
          <div className="px-5 pb-3">
            <div
              className="relative overflow-hidden rounded-2xl p-4 border"
              style={{
                background:
                  "linear-gradient(135deg, rgba(255,87,34,0.08) 0%, rgba(255,183,0,0.04) 100%)",
                borderColor: "rgba(255,87,34,0.3)",
              }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <Wallet className="w-3.5 h-3.5" style={{ color: "var(--color-orange)" }} />
                <span
                  className="font-mono text-[10px] uppercase tracking-widest font-bold"
                  style={{ color: "var(--color-orange)" }}
                >
                  Credit Balance
                </span>
              </div>
              <div className="font-display font-extrabold text-3xl tracking-tight text-[var(--color-text-primary)]">
                {credits.toFixed(2)}
              </div>
              <button
                onClick={() => setSection("credit")}
                className="mt-3 w-full py-2 rounded-lg text-xs font-extrabold transition-transform hover:scale-[1.02]"
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
          </div>

          {/* User card */}
          <div
            className="px-5 pb-5 pt-3 border-t"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="flex items-center gap-3 px-2 py-2 mb-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-display font-extrabold text-sm text-white"
                style={{
                  background: "linear-gradient(135deg, #ff6a1a 0%, #ff4d00 100%)",
                  boxShadow: "0 0 0 2px var(--color-bg-card), 0 4px 12px rgba(255,87,34,0.3)",
                }}
              >
                {(name || email || "U").trim().charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate text-[var(--color-text-primary)]">
                  {name || "User"}
                </div>
                <div className="text-xs text-[var(--color-text-muted)] truncate">
                  {email}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => setSection("settings")}
                className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-colors hover:opacity-80"
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

        {/* MAIN */}
        <main className="flex-1 min-w-0 flex flex-col">
          {/* Mobile header */}
          <div
            className="lg:hidden flex items-center justify-between px-5 py-4 border-b"
            style={{
              background: "var(--color-bg)",
              borderColor: "var(--color-border)",
            }}
          >
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-400 via-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/30">
                <Sparkles className="w-4 h-4 text-white" strokeWidth={2.5} />
              </div>
              <span className="font-display font-extrabold text-lg text-[var(--color-text-primary)]">
                PeningLab
              </span>
            </Link>
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{
                background: "rgba(255,87,34,0.1)",
                border: "1px solid rgba(255,87,34,0.3)",
              }}
            >
              <Wallet className="w-3.5 h-3.5" style={{ color: "var(--color-orange)" }} />
              <span className="text-xs font-extrabold" style={{ color: "var(--color-orange)" }}>
                {credits.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Mobile section pills */}
          <div
            className="lg:hidden flex gap-2 px-5 py-3 overflow-x-auto border-b"
            style={{
              background: "var(--color-bg)",
              borderColor: "var(--color-border)",
            }}
          >
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const isActive = section === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setSection(s.key)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all"
                  style={
                    isActive
                      ? {
                          background:
                            "linear-gradient(90deg, var(--color-orange) 0%, #ff6a1a 100%)",
                          color: "white",
                          boxShadow: "0 4px 14px rgba(255,87,34,0.3)",
                        }
                      : {
                          background: "var(--color-bg-card)",
                          border: "1px solid var(--color-border)",
                          color: "var(--color-orange)",
                        }
                  }
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
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold"
                  style={{ color: "var(--color-orange)" }}
                >
                  ─ {active.tag}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-muted)] font-bold">
                  {active.label}
                </span>
              </div>
              <h1 className="font-display font-extrabold text-4xl tracking-tight leading-none text-[var(--color-text-primary)]">
                Welcome back,{" "}
                <span
                  style={{
                    background:
                      "linear-gradient(135deg, #ff6a1a 0%, #ff4d00 60%, #d63800 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {name}
                </span>
              </h1>
              <p className="text-sm text-[var(--color-text-secondary)] mt-2">
                {email}
              </p>
            </div>
          </header>

          {/* Body — form on top (capped width), history grid full-width below */}
          <div className="flex-1 px-5 lg:px-10 pb-10 lg:pb-12 space-y-6">
            {section === "image" && (
              <>
                <div className="max-w-3xl mx-auto w-full">
                  <ImageTab />
                </div>
                <HistoryGrid tab="image" title="Image" />
              </>
            )}
            {section === "video" && (
              <>
                <section className="card max-w-3xl mx-auto w-full">
                  <VideoTab />
                </section>
                <HistoryGrid tab="video" title="Video" />
              </>
            )}
            {section === "ugc" && (
              <section className="card max-w-3xl mx-auto w-full">
                <UgcTab />
              </section>
            )}
            {section === "clone" && (
              <>
                <section className="card max-w-3xl mx-auto w-full">
                  <CloneTab />
                </section>
                <HistoryGrid tab="clone" title="Clone" />
              </>
            )}
            {section === "auto" && (
              <>
                <section className="card max-w-3xl mx-auto w-full">
                  <AutoContentTab />
                </section>
                <HistoryGrid tab="auto" title="Auto Content" />
              </>
            )}
            {section === "billing" && <BillingSection />}
            {section === "credit" && <CreditSection credits={credits} />}
            {section === "usage" && <UsageSection email={email} />}
            {section === "settings" && (
              <SettingsSection email={email} name={name} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
