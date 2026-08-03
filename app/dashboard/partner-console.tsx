"use client";

// Partner Console — the WHOLE surface a partner MANAGER (e.g. HQNL) gets.
// Partners don't generate content; they manage clients + set tabs/pricing. So
// instead of the client generation dashboard (projects, tabs, Top Up, Subscribe)
// they land here: just Partner Settings + Manage Users + logout. Rendered by
// app/dashboard/page.tsx when isPartnerManager(email) — DashboardShell is never
// mounted for them, so there's no way to reach a generation tab.

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SlidersHorizontal, Users, LogOut } from "lucide-react";
import PartnerSettings from "./sections/partner-settings";
import ManageUsersSection from "./sections/manage-users";

export default function PartnerConsole({ name }: { name: string }) {
  const [tab, setTab] = useState<"partner-settings" | "manage-users">("partner-settings");

  async function logout() {
    try {
      const sb = createClient();
      await sb.auth.signOut();
    } catch { /* ignore */ }
    window.location.href = "/login";
  }

  const TabBtn = ({ id, icon: Icon, label }: { id: typeof tab; icon: any; label: string }) => {
    const on = tab === id;
    return (
      <button onClick={() => setTab(id)}
        className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-colors"
        style={{
          background: on ? "linear-gradient(135deg,#f59e0b,#ea580c)" : "var(--color-bg-card)",
          color: on ? "#111" : "var(--color-text-secondary)",
          border: `1px solid ${on ? "transparent" : "var(--color-border)"}`,
        }}>
        <Icon className="h-4 w-4" /> {label}
      </button>
    );
  };

  return (
    <div className="min-h-screen" style={{ background: "var(--color-bg)" }}>
      {/* Header + logout — the only chrome a partner gets. */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6"
        style={{ background: "var(--color-bg)", borderBottom: "1px solid var(--color-border)" }}>
        <div className="min-w-0">
          <div className="font-display text-[15px] font-extrabold leading-tight text-[var(--color-text-primary)]">
            Partner Console — {name}
          </div>
          <div className="text-[12px] leading-tight text-[var(--color-text-secondary)]">
            Urus client, tab &amp; harga. Akaun partner — tiada generation.
          </div>
        </div>
        <button onClick={logout}
          className="inline-flex flex-shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition hover:brightness-110"
          style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}>
          <LogOut className="h-4 w-4" /> Log keluar
        </button>
      </div>

      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap gap-2">
          <TabBtn id="partner-settings" icon={SlidersHorizontal} label="Partner Settings" />
          <TabBtn id="manage-users" icon={Users} label="Manage Users" />
        </div>

        {tab === "partner-settings" ? (
          <div>
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-white">Partner Settings</h2>
              <p className="text-xs text-white/45">
                Kawal tab yang client anda nampak + harga per-model (tak boleh lebih rendah dari harga asas admin).
              </p>
            </div>
            <PartnerSettings />
          </div>
        ) : (
          <div>
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-white">Manage Users</h2>
              <p className="text-xs text-white/45">Tambah &amp; edit client (Premium 1 tahun). Client tak nampak tab Billing.</p>
            </div>
            <ManageUsersSection />
          </div>
        )}
      </div>
    </div>
  );
}
