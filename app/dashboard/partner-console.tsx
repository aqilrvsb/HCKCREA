"use client";

// Partner Console — the WHOLE surface a partner MANAGER (e.g. HQNL) gets.
// Partners don't generate content; they manage clients + set tabs/pricing +
// watch usage. Rendered by app/dashboard/page.tsx when isPartnerManager(email),
// so DashboardShell (projects, generation tabs) is never mounted for them.
//
// Layout mirrors the Admin Console: a fixed left sidebar (brand + nav + logout)
// and a content pane that swaps the active section.

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Sparkles, SlidersHorizontal, Users, Activity, LogOut } from "lucide-react";
import PartnerSettings from "./sections/partner-settings";
import ManageUsersSection from "./sections/manage-users";
import PartnerUsage from "./sections/partner-usage";

type Tab = "partner-settings" | "manage-users" | "usage";

const NAV: { id: Tab; label: string; icon: any }[] = [
  { id: "partner-settings", label: "Partner Settings", icon: SlidersHorizontal },
  { id: "manage-users", label: "Manage Users", icon: Users },
  { id: "usage", label: "Usage", icon: Activity },
];

export default function PartnerConsole({ name, email }: { name: string; email: string }) {
  const [tab, setTab] = useState<Tab>("partner-settings");

  async function logout() {
    try {
      const sb = createClient();
      await sb.auth.signOut();
    } catch { /* ignore */ }
    window.location.href = "/login";
  }

  const NavBtn = ({ id, label, icon: Icon, mobile }: { id: Tab; label: string; icon: any; mobile?: boolean }) => {
    const on = tab === id;
    if (mobile) {
      return (
        <button onClick={() => setTab(id)}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold"
          style={{
            background: on ? "rgba(255,87,34,0.14)" : "var(--color-bg-card)",
            border: `1px solid ${on ? "rgba(255,87,34,0.4)" : "var(--color-border)"}`,
            color: "var(--color-orange)",
          }}>
          <Icon className="h-3.5 w-3.5" /> {label}
        </button>
      );
    }
    return (
      <button onClick={() => setTab(id)}
        className="group flex w-full items-center gap-4 rounded-xl px-5 py-4 text-base font-bold transition-all hover:translate-x-0.5"
        style={{
          background: on ? "rgba(255,87,34,0.12)" : "transparent",
          border: `1px solid ${on ? "rgba(255,87,34,0.3)" : "transparent"}`,
          color: "var(--color-orange)",
        }}>
        <Icon className="h-5 w-5" strokeWidth={2.4} />
        {label}
      </button>
    );
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="bg-sky" />

      <div className="relative z-10 flex min-h-screen">
        {/* Left sidebar (desktop) */}
        <aside className="hidden w-[280px] flex-shrink-0 flex-col border-r lg:flex"
          style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
          <div className="flex items-center gap-3 border-b px-7 py-7" style={{ borderColor: "var(--color-border)" }}>
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl shadow-lg"
              style={{ background: "linear-gradient(135deg, #fde047 0%, #facc15 100%)", boxShadow: "0 8px 24px rgba(250, 204, 21, 0.35)" }}>
              <Sparkles className="h-5 w-5 text-black" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <div className="font-display text-2xl font-extrabold leading-none tracking-tight text-[var(--color-text-primary)]">
                PeningLab
              </div>
              <div className="mt-1.5 font-mono text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--color-orange)" }}>
                Partner Console
              </div>
            </div>
          </div>

          <nav className="space-y-1.5 px-3 pt-6">
            {NAV.map((item) => <NavBtn key={item.id} {...item} />)}
          </nav>

          <div className="flex-1" />

          {/* Who's signed in + logout */}
          <div className="border-t px-5 py-4" style={{ borderColor: "var(--color-border)" }}>
            <div className="mb-3 min-w-0">
              <div className="truncate text-sm font-bold text-[var(--color-text-primary)]">{name}</div>
              <div className="truncate text-[11px] text-[var(--color-text-secondary)]">{email}</div>
            </div>
            <button onClick={logout}
              className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-all hover:translate-x-0.5"
              style={{ background: "rgba(255, 87, 34, 0.1)", border: "1px solid rgba(255, 87, 34, 0.3)", color: "var(--color-orange)" }}>
              <LogOut className="h-4 w-4" /> Log keluar
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-x-hidden px-5 py-6 lg:overflow-x-visible lg:px-10 lg:py-10">
          {/* Mobile nav + logout */}
          <div className="mb-5 flex items-center gap-2 overflow-x-auto lg:hidden">
            {NAV.map((item) => <NavBtn key={item.id} {...item} mobile />)}
            <button onClick={logout}
              className="ml-auto flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold"
              style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", color: "var(--color-orange)" }}>
              <LogOut className="h-3.5 w-3.5" /> Keluar
            </button>
          </div>

          {tab === "partner-settings" && (
            <div className="mx-auto w-full max-w-5xl">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-white">Partner Settings</h2>
                <p className="text-xs text-white/45">
                  Harga per-model untuk client anda (tak boleh lebih rendah dari harga asas admin). Tab pula diset per-client di Manage Users.
                </p>
              </div>
              <PartnerSettings />
            </div>
          )}

          {tab === "manage-users" && (
            <div className="mx-auto w-full max-w-5xl">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-white">Manage Users</h2>
                <p className="text-xs text-white/45">Tambah &amp; edit client (Premium 1 tahun). Client tak nampak tab Billing.</p>
              </div>
              <ManageUsersSection />
            </div>
          )}

          {tab === "usage" && (
            <div className="mx-auto w-full max-w-5xl">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-white">Usage</h2>
                <p className="text-xs text-white/45">Penggunaan &amp; kos generation — semua client anda.</p>
              </div>
              <PartnerUsage />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
