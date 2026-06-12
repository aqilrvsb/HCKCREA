"use client";

import { useState } from "react";
import { Radio, CreditCard, LayoutDashboard } from "lucide-react";
import LogoutButton from "./logout-button";
import BillingSection from "./sections/billing";

// Livehost gets a SEPARATE, minimal dashboard — intentionally blank for
// now ("designed later"). It only exposes a placeholder home + Billing
// (which itself shows ONLY the Livehost package for these users) + sign
// out. None of the generation tabs / sidebar perks appear here.

type View = "home" | "billing";

export default function LivehostDashboard({
  name,
  email,
  planExpiresAt,
}: {
  name: string;
  email: string;
  planExpiresAt: string | null;
}) {
  const [view, setView] = useState<View>("home");

  const expiry = planExpiresAt
    ? new Date(planExpiresAt).toLocaleDateString("ms-MY", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  const navItem = (key: View, label: string, Icon: any) => (
    <button
      onClick={() => setView(key)}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-bold transition-colors"
      style={{
        background: view === key ? "rgba(96,165,250,0.14)" : "transparent",
        color: view === key ? "#93c5fd" : "var(--color-text-secondary)",
        border: `1px solid ${view === key ? "rgba(96,165,250,0.3)" : "transparent"}`,
      }}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      {label}
    </button>
  );

  return (
    <div className="min-h-screen flex" style={{ background: "var(--color-bg)" }}>
      {/* Sidebar */}
      <aside
        className="w-[260px] flex-shrink-0 hidden lg:flex flex-col gap-4 p-4 border-r"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2.5 px-2 py-2">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)" }}
          >
            <Radio className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-display font-extrabold leading-tight">PeningLab</div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Livehost
            </div>
          </div>
        </div>

        <div className="space-y-1">
          {navItem("home", "Dashboard", LayoutDashboard)}
          {navItem("billing", "Billing", CreditCard)}
        </div>

        <div className="mt-auto space-y-2">
          <div
            className="rounded-xl p-3 text-xs"
            style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border)" }}
          >
            <div className="font-bold text-[var(--color-text-primary)] truncate">{name}</div>
            <div className="text-[var(--color-text-muted)] truncate">{email}</div>
            {expiry && (
              <div className="mt-1 text-[var(--color-text-muted)]">Sah hingga {expiry}</div>
            )}
          </div>
          <LogoutButton compact />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 p-6 md:p-10">
        {view === "billing" ? (
          <div className="max-w-5xl">
            <BillingSection />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center min-h-[60vh]">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
              style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)" }}
            >
              <Radio className="w-8 h-8 text-white" />
            </div>
            <h1 className="font-display font-extrabold text-3xl tracking-tight mb-2">
              Livehost Dashboard
            </h1>
            <p className="text-[var(--color-text-secondary)] max-w-md">
              Dashboard Livehost sedang dalam pembinaan — tools akan keluar tak lama
              lagi. Sementara tu, anda boleh urus langganan di{" "}
              <button
                onClick={() => setView("billing")}
                className="font-bold underline"
                style={{ color: "#60a5fa" }}
              >
                Billing
              </button>
              .
            </p>
            {/* Mobile nav (sidebar hidden on small screens) */}
            <div className="flex gap-2 mt-6 lg:hidden">
              {navItem("billing", "Billing", CreditCard)}
              <LogoutButton compact />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
