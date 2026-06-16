"use client";

import { useState, useEffect } from "react";
import { Radio, CreditCard, LayoutDashboard, MessageCircle, ArrowUpRight, ScrollText, Package, BarChart3, Paperclip, HeartHandshake, Send, LayoutTemplate, Image as ImageIcon, Wallet } from "lucide-react";
import LogoutButton from "./logout-button";
import BillingSection from "./sections/billing";
import StudioSection from "./sections/studio";
import LivehostTopup from "./sections/livehost-topup";
import AttachmentsSection from "./sections/attachments";
import LivehostStudio, { type LiveView } from "./livehost-studio";
import LivehostGreetings from "./livehost-greetings";
import LivehostInteractions from "./livehost-interactions";
import LivehostTiktok from "./livehost-tiktok";

// Livehost community WhatsApp group. Hardcoded here (client component) —
// the canonical value also lives in lib/whatsapp.ts (server-only) as
// WHATSAPP_GROUP_LIVEHOST; keep them in sync.
const WHATSAPP_GROUP_LIVEHOST = "https://chat.whatsapp.com/JIj9Ppto73mIIfitWikCgO";

// Shared nav data — rendered in the desktop sidebar AND the mobile top bar.
// `step` (+ its colour) marks the recommended setup order shown as a numbered
// badge to guide new clients: 1 Template → 2 Scripts → 3 Knowledge → 4 Greetings.
const NAV: { key: View; label: string; Icon: any; step?: number; stepColor?: string }[] = [
  { key: "home", label: "Dashboard", Icon: LayoutDashboard },
  { key: "livehost", label: "Livehost", Icon: Radio },
  { key: "template", label: "Template", Icon: LayoutTemplate, step: 1, stepColor: "#8b5cf6" },
  { key: "scripts", label: "Scripts", Icon: ScrollText, step: 2, stepColor: "#3b82f6" },
  { key: "products", label: "Knowledge", Icon: Package, step: 3, stepColor: "#f59e0b" },
  { key: "greetings", label: "Greetings", Icon: HeartHandshake, step: 4, stepColor: "#ec4899" },
  { key: "avatar", label: "Avatar", Icon: ImageIcon },
  { key: "attachment", label: "Attachment", Icon: Paperclip },
  { key: "usage", label: "Usage", Icon: BarChart3 },
  { key: "billing", label: "Billing", Icon: CreditCard },
];

// Livehost gets a SEPARATE, minimal dashboard — intentionally blank for
// now ("designed later"). It only exposes a placeholder home + Billing
// (which itself shows ONLY the Livehost package for these users) + sign
// out. None of the generation tabs / sidebar perks appear here.

type View = "home" | "billing" | "livehost" | "template" | "scripts" | "products" | "usage" | "attachment" | "greetings" | "avatar" | "tiktok";

const STUDIO_VIEWS: View[] = ["livehost", "template", "scripts", "products", "usage"];

export default function LivehostDashboard({
  name,
  email,
  planExpiresAt,
  credits,
}: {
  name: string;
  email: string;
  planExpiresAt: string | null;
  credits: number;
}) {
  const [view, setView] = useState<View>("home");

  // Deep-link support so right-click → "Open in new tab" works: each view has a
  // ?tab=<key> URL. On load we read it; switching views keeps the URL in sync.
  const ALL_VIEWS: View[] = ["home", "livehost", "template", "scripts", "products", "greetings", "avatar", "attachment", "usage", "billing", "tiktok"];
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t && (ALL_VIEWS as string[]).includes(t)) setView(t as View);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const hrefFor = (key: View) => (key === "home" ? "/dashboard" : `/dashboard?tab=${key}`);
  const go = (key: View) => {
    setView(key);
    try { window.history.replaceState(null, "", hrefFor(key)); } catch {}
  };
  // Live wallet balance (credits − all-time livehost spend) so the sidebar
  // "Credit Balance" tallies with the Usage "Baki kredit". Falls back to the
  // raw credits prop until the billing API responds.
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLow, setBalanceLow] = useState(false);
  useEffect(() => {
    let stop = false;
    // Show the last-known balance instantly (cache) so refresh doesn't flash the
    // raw credits, then refresh from the API.
    try {
      const c = localStorage.getItem("livehost_balance_cache");
      if (c != null && c !== "") setBalance(Number(c));
      if (localStorage.getItem("livehost_balance_low") === "1") setBalanceLow(true);
    } catch {}
    const load = () => fetch("/api/livehost/session")
      .then((r) => r.json())
      .then((d) => {
        if (stop || !d?.balance) return;
        setBalance(d.balance.available);
        setBalanceLow(!!d.balance.low);
        try {
          localStorage.setItem("livehost_balance_cache", String(d.balance.available));
          localStorage.setItem("livehost_balance_low", d.balance.low ? "1" : "0");
        } catch {}
      })
      .catch(() => {});
    load();
    const t = setInterval(load, 30000); // refresh so it reflects usage as it accrues
    return () => { stop = true; clearInterval(t); };
  }, []);

  // Default Livehost attachments (stock hosts + templates) — shown read-only
  // in the Attachment tab so it tallies with the Template-tab pickers.
  const [attachPresets, setAttachPresets] = useState<
    { id: string; name: string; public_url: string; category: "product" | "avatar" }[]
  >([]);
  useEffect(() => {
    Promise.all([
      fetch("/avatars/manifest.json").then((r) => r.json()).catch(() => []),
      fetch("/overlays/manifest.json").then((r) => r.json()).catch(() => []),
    ]).then(([avatars, overlays]) => {
      const a = (avatars as { id: string; file: string; label: string }[]).map((s) => ({
        id: `stock:${s.id}`, name: s.label, public_url: `/avatars/${s.file}`, category: "avatar" as const,
      }));
      const o = (overlays as { file: string; label: string }[]).map((t) => ({
        id: `ovl:${t.file}`, name: t.label, public_url: `/overlays/${t.file}`, category: "product" as const,
      }));
      setAttachPresets([...a, ...o]);
    }).catch(() => {});
  }, []);

  // Plan days-left + expiry — deferred to post-mount (Date.now()/locale differ
  // between server & client → hydration mismatch otherwise).
  const [daysLeft, setDaysLeft] = useState<number | null>(null);
  const [expDateStr, setExpDateStr] = useState<string | null>(null);
  useEffect(() => {
    if (!planExpiresAt) { setDaysLeft(null); setExpDateStr(null); return; }
    const exp = new Date(planExpiresAt);
    setDaysLeft(Math.max(0, Math.ceil((exp.getTime() - Date.now()) / 86400000)));
    setExpDateStr(exp.toLocaleDateString("ms-MY", { day: "numeric", month: "short", year: "numeric" }));
  }, [planExpiresAt]);
  const planActive = !!planExpiresAt;

  const navItem = (key: View, label: string, Icon: any, step?: number, stepColor?: string) => (
    <a
      href={hrefFor(key)}
      onClick={(e) => {
        // let the browser handle modifier/middle clicks → opens in a new tab
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
        e.preventDefault();
        go(key);
      }}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-bold transition-colors no-underline"
      style={{
        background: view === key ? "rgba(96,165,250,0.14)" : "transparent",
        color: view === key ? "#93c5fd" : "var(--color-text-secondary)",
        border: `1px solid ${view === key ? "rgba(96,165,250,0.3)" : "transparent"}`,
      }}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span>{label}</span>
      {step && (
        <span
          className="ml-auto flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-extrabold text-white"
          style={{ background: stepColor, boxShadow: `0 2px 8px ${stepColor}66` }}
        >
          {step}
        </span>
      )}
    </a>
  );

  return (
    <div className="min-h-screen flex" style={{ background: "var(--color-bg)" }}>
      {/* Sidebar */}
      <aside
        className="w-[260px] flex-shrink-0 hidden lg:flex flex-col gap-2 px-3 py-3 border-r sticky top-0 h-screen overflow-hidden self-start"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2.5 px-2 py-1">
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

        <div className="space-y-0.5 flex-1 overflow-y-auto min-h-0 -mr-1 pr-1">
          {NAV.map((n) => <div key={n.key}>{navItem(n.key, n.label, n.Icon, n.step, n.stepColor)}</div>)}
          {/* Install/connect the extension — plain nav item, yellow icon only */}
          <a
            href={hrefFor("tiktok")}
            onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return; e.preventDefault(); go("tiktok"); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-bold transition-colors no-underline"
            style={{
              background: view === "tiktok" ? "rgba(96,165,250,0.14)" : "transparent",
              color: view === "tiktok" ? "#93c5fd" : "var(--color-text-secondary)",
              border: `1px solid ${view === "tiktok" ? "rgba(96,165,250,0.3)" : "transparent"}`,
            }}
          >
            <Send className="w-4 h-4 flex-shrink-0" style={{ color: "#facc15" }} />
            TikTok Live
          </a>
          <a
            href={WHATSAPP_GROUP_LIVEHOST}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-bold transition-colors"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <MessageCircle className="w-4 h-4 flex-shrink-0" style={{ color: "#22c55e" }} />
            <span>Join Livehost Group</span>
            <ArrowUpRight className="w-3.5 h-3.5 ml-auto opacity-60" />
          </a>
        </div>

        <div className="flex-shrink-0 space-y-2">
          {/* Credit balance + plan — ONE compact card (balance left, Subscribe
              right, thin plan line below) to keep the footer minimal. */}
          <div
            className="relative overflow-hidden rounded-xl p-2.5 border"
            style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.1), rgba(245,158,11,0.03))", borderColor: "rgba(245,158,11,0.3)" }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Wallet className="w-3 h-3" style={{ color: "#fbbf24" }} />
                  <span className="font-mono text-[9px] uppercase tracking-widest font-bold" style={{ color: "#fbbf24" }}>Credit Balance</span>
                </div>
                <div className="font-display font-extrabold text-xl leading-none mt-0.5 tracking-tight" style={{ color: balanceLow ? "#f87171" : "#fcd34d" }}>{Number(balance ?? credits).toFixed(2)}</div>
              </div>
              <button
                onClick={() => setView("billing")}
                className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold whitespace-nowrap transition-transform hover:scale-[1.03]"
                style={{ background: "linear-gradient(90deg,#f59e0b,#facc15)", color: "#000", boxShadow: "0 4px 14px rgba(250,204,21,0.3)" }}
              >Subscribe</button>
            </div>
            <button
              onClick={() => setView("billing")}
              className="w-full flex items-center gap-1.5 mt-2 pt-2 border-t"
              style={{ borderColor: "rgba(245,158,11,0.2)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: planActive ? "#22c55e" : "#888" }} />
              <span className="font-mono text-[9px] uppercase tracking-widest font-bold" style={{ color: planActive ? "#22c55e" : "var(--color-text-secondary)" }}>
                {planActive ? `LIVEHOST${daysLeft != null ? ` · ${daysLeft}d left` : ""}` : "No active plan"}
              </span>
              {expDateStr && <span className="text-[9px] ml-auto" style={{ color: "var(--color-text-muted)" }}>Exp {expDateStr}</span>}
            </button>
          </div>

          {/* User card + sign out */}
          <div className="pt-1.5 border-t" style={{ borderColor: "var(--color-border)" }}>
            <div className="flex items-center gap-2.5 px-1 py-1 mb-1.5">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 font-display font-extrabold text-xs text-white"
                style={{ background: "linear-gradient(135deg,#facc15,#eab308)", boxShadow: "0 0 0 2px var(--color-bg-card), 0 4px 12px rgba(245,158,11,0.3)" }}
              >
                {(name || email || "U").trim().charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold truncate text-[var(--color-text-primary)]">{name || "User"}</div>
                <div className="text-[10px] text-[var(--color-text-muted)] truncate">{email}</div>
              </div>
            </div>
            <LogoutButton compact />
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top nav — the sidebar is desktop-only (lg+). */}
        <div
          className="lg:hidden flex items-center gap-2 px-3 py-2.5 border-b overflow-x-auto"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)" }}
          >
            <Radio className="w-4 h-4 text-white" />
          </div>
          {NAV.map((n) => {
            const active = view === n.key;
            return (
              <a
                key={n.key}
                href={hrefFor(n.key)}
                onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return; e.preventDefault(); go(n.key); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap flex-shrink-0 no-underline"
                style={{
                  background: active ? "rgba(96,165,250,0.16)" : "transparent",
                  color: active ? "#93c5fd" : "var(--color-text-secondary)",
                  border: `1px solid ${active ? "rgba(96,165,250,0.35)" : "var(--color-border)"}`,
                }}
              >
                <n.Icon className="w-3.5 h-3.5" />
                {n.label}
                {n.step && (
                  <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-extrabold text-white"
                    style={{ background: n.stepColor }}>{n.step}</span>
                )}
              </a>
            );
          })}
          <a
            href={hrefFor("tiktok")}
            onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return; e.preventDefault(); go("tiktok"); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap flex-shrink-0 no-underline"
            style={{
              background: view === "tiktok" ? "rgba(96,165,250,0.16)" : "transparent",
              color: view === "tiktok" ? "#93c5fd" : "var(--color-text-secondary)",
              border: `1px solid ${view === "tiktok" ? "rgba(96,165,250,0.35)" : "var(--color-border)"}`,
            }}
          >
            <Send className="w-3.5 h-3.5" style={{ color: "#facc15" }} />
            TikTok Live
          </a>
        </div>

        {/* Content — full width. Studio views go edge-to-edge. */}
        <div className={`flex-1 min-w-0 ${STUDIO_VIEWS.includes(view) ? "p-2" : "p-4 sm:p-6 md:p-8"}`}>
          {/* Studio is ALWAYS mounted (hidden when not active) so the WebRTC
              stream + script playback survive navigation between views. */}
          <div style={{ display: STUDIO_VIEWS.includes(view) ? undefined : "none" }} className="h-full">
            <LivehostStudio view={(view === "livehost" ? "live" : view) as LiveView} />
          </div>
          {view === "billing" ? (
            <div className="space-y-8">
              <BillingSection initialPlan="livehost" />
              <LivehostTopup credits={credits} />
            </div>
          ) : view === "avatar" ? (
            <StudioSection only="image" />
          ) : view === "attachment" ? (
            <AttachmentsSection presets={attachPresets} productLabel="Template" pngOnly />
          ) : view === "greetings" ? (
            <div className="lh-studio"><LivehostGreetings /></div>
          ) : view === "tiktok" ? (
            <LivehostTiktok email={email} />
          ) : STUDIO_VIEWS.includes(view) ? null : (
            /* DASHBOARD (home) = live interaction analytics */
            <div className="lh-studio">
              <div className="mb-5">
                <h1 className="font-display font-extrabold text-2xl tracking-tight">Dashboard</h1>
                <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                  Selamat datang, {name} — interaksi penonton TikTok LIVE anda secara real-time.
                </p>
              </div>
              <LivehostInteractions />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
