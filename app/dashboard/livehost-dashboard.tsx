"use client";

import { useState } from "react";
import { Radio, CreditCard, LayoutDashboard, MessageCircle, ArrowUpRight, ScrollText, Package, BarChart3, Paperclip, HeartHandshake, Send } from "lucide-react";
import LogoutButton from "./logout-button";
import BillingSection from "./sections/billing";
import AttachmentsSection from "./sections/attachments";
import LivehostStudio, { type LiveView } from "./livehost-studio";
import LivehostGreetings from "./livehost-greetings";
import LivehostInteractions from "./livehost-interactions";
import LivehostTiktok from "./livehost-tiktok";

// Livehost community WhatsApp group. Hardcoded here (client component) —
// the canonical value also lives in lib/whatsapp.ts (server-only) as
// WHATSAPP_GROUP_LIVEHOST; keep them in sync.
const WHATSAPP_GROUP_LIVEHOST = "https://chat.whatsapp.com/JIj9Ppto73mIIfitWikCgO";

// Livehost gets a SEPARATE, minimal dashboard — intentionally blank for
// now ("designed later"). It only exposes a placeholder home + Billing
// (which itself shows ONLY the Livehost package for these users) + sign
// out. None of the generation tabs / sidebar perks appear here.

type View = "home" | "billing" | "livehost" | "scripts" | "products" | "usage" | "attachment" | "greetings" | "tiktok";

const STUDIO_VIEWS: View[] = ["livehost", "scripts", "products", "usage"];

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
          {navItem("livehost", "Livehost", Radio)}
          {navItem("scripts", "Scripts", ScrollText)}
          {navItem("products", "Products", Package)}
          {navItem("attachment", "Attachment", Paperclip)}
          {navItem("greetings", "Greetings", HeartHandshake)}
          {navItem("usage", "Usage", BarChart3)}
          {navItem("billing", "Billing", CreditCard)}
          {/* Colourful highlighted CTA — install/connect the extension */}
          <button
            onClick={() => setView("tiktok")}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-extrabold text-white transition-transform hover:-translate-y-0.5"
            style={{
              background: "linear-gradient(135deg, #16a34a, #22c55e, #4ade80)",
              boxShadow: view === "tiktok" ? "0 4px 18px rgba(34,197,94,0.5)" : "0 4px 14px rgba(34,197,94,0.3)",
              border: view === "tiktok" ? "1px solid #bbf7d0" : "1px solid transparent",
            }}
          >
            <Send className="w-4 h-4 flex-shrink-0" />
            TikTok Live
          </button>
          <a
            href={WHATSAPP_GROUP_LIVEHOST}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-bold transition-colors"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <MessageCircle className="w-4 h-4 flex-shrink-0" style={{ color: "#22c55e" }} />
            <span>Join Livehost Group</span>
            <ArrowUpRight className="w-3.5 h-3.5 ml-auto opacity-60" />
          </a>
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

      {/* Main — studio views go edge-to-edge (no blank padding) */}
      <main className={`flex-1 min-w-0 ${STUDIO_VIEWS.includes(view) ? "p-2" : "p-6 md:p-10"}`}>
        {/* Studio is ALWAYS mounted (hidden when not active) so the WebRTC
            stream + script playback survive navigation between views. */}
        <div style={{ display: STUDIO_VIEWS.includes(view) ? undefined : "none" }} className="h-full">
          <LivehostStudio view={(view === "livehost" ? "live" : view) as LiveView} />
        </div>
        {view === "billing" ? (
          <div className="max-w-5xl">
            <BillingSection />
          </div>
        ) : view === "attachment" ? (
          <div className="max-w-6xl">
            <AttachmentsSection />
          </div>
        ) : view === "greetings" ? (
          <div className="lh-studio max-w-4xl"><LivehostGreetings /></div>
        ) : view === "tiktok" ? (
          <LivehostTiktok email={email} />
        ) : STUDIO_VIEWS.includes(view) ? null : (
          /* DASHBOARD (home) = live interaction analytics */
          <div className="lh-studio max-w-6xl">
            <div className="mb-5">
              <h1 className="font-display font-extrabold text-2xl tracking-tight">Dashboard</h1>
              <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                Selamat datang, {name} — interaksi penonton TikTok LIVE anda secara real-time.
              </p>
            </div>
            <LivehostInteractions />
          </div>
        )}
      </main>
    </div>
  );
}
