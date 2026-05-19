"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  Users,
  ShoppingCart,
  CheckCircle2,
  TrendingUp,
  DollarSign,
  Megaphone,
  Bot,
} from "lucide-react";
import { localDateStr } from "@/lib/date-util";

type Stats = {
  ok: boolean;
  range: { start: string; end: string };
  visitors: number;
  page_views: number;
  bot_visitors: number;
  bot_page_views: number;
  checkouts: number;
  purchases: number;
  revenue_myr: number;
  cvr_v2c: number | null;
  cvr_c2p: number | null;
  cvr_v2p: number | null;
};

export default function AdminAds() {
  const [start, setStart] = useState(localDateStr());
  const [end, setEnd] = useState(localDateStr());
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end]);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/admin/ads/stats?start=${start}&end=${end}`,
        { cache: "no-store" }
      );
      const d = await r.json();
      if (d?.ok) setStats(d);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Megaphone className="w-6 h-6 text-sky-600" />
          <h1 className="font-display font-extrabold text-2xl tracking-tight">
            Ads Performance
          </h1>
          <span className="ml-2 px-2 py-0.5 rounded-md bg-sky-100 text-sky-700 text-[10px] font-bold uppercase tracking-widest">
            Paid traffic only
          </span>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Visitors → Checkouts → Purchases dari Meta ads sahaja (organic
          tak direkod). Masa Malaysia (UTC+8).
        </p>
      </div>

      {/* Date range */}
      <div className="card p-5 mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-1 block">
              Start (MY time)
            </label>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-1 block">
              End (MY time)
            </label>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="input"
            />
          </div>
        </div>

        {/* Quick presets — Today / Yesterday / 7d / Month-to-date.
            Same shape as /admin/usage so the muscle memory carries over. */}
        <div className="flex gap-2 mt-4 flex-wrap">
          {[
            { label: "Today", days: 0 },
            { label: "Yesterday", days: -2 },
            { label: "7d", days: 6 },
            { label: "30d", days: 29 },
            { label: "Month", days: -1 },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => {
                const today = localDateStr();
                if (p.days === -1) {
                  const d = new Date();
                  setStart(localDateStr(new Date(d.getFullYear(), d.getMonth(), 1)));
                  setEnd(today);
                } else if (p.days === -2) {
                  const d = new Date();
                  d.setDate(d.getDate() - 1);
                  const y = localDateStr(d);
                  setStart(y);
                  setEnd(y);
                } else if (p.days === 0) {
                  setStart(today);
                  setEnd(today);
                } else {
                  const d = new Date();
                  d.setDate(d.getDate() - p.days);
                  setStart(localDateStr(d));
                  setEnd(today);
                }
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-transform hover:-translate-y-0.5"
              style={{
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading || !stats ? (
        <div className="card p-12 text-center">
          <Loader2 className="w-5 h-5 animate-spin inline text-orange" />
        </div>
      ) : (
        <>
          {/* Funnel — three big KPI cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <KpiCard
              icon={<Users className="w-5 h-5 text-sky-600" />}
              label="Visitors"
              value={stats.visitors}
              hint={`${stats.page_views} page views · ${stats.bot_visitors} bots filtered`}
              tint="sky"
            />
            <KpiCard
              icon={<ShoppingCart className="w-5 h-5 text-orange" />}
              label="Checkouts"
              value={stats.checkouts}
              hint="clicked Bayar RM75 button"
              tint="orange"
            />
            <KpiCard
              icon={<CheckCircle2 className="w-5 h-5 text-emerald-600" />}
              label="Purchases"
              value={stats.purchases}
              hint={`RM ${stats.revenue_myr.toFixed(2)} revenue`}
              tint="emerald"
            />
          </div>

          {/* Conversion rates — three smaller cards in a row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <CvrCard
              label="Visit → Checkout"
              value={stats.cvr_v2c}
              tone="What % of visitors clicked the pay button"
            />
            <CvrCard
              label="Checkout → Purchase"
              value={stats.cvr_c2p}
              tone="What % of clicks completed payment"
            />
            <CvrCard
              label="Visit → Purchase"
              value={stats.cvr_v2p}
              tone="End-to-end conversion (your real ads CVR)"
              highlight
            />
          </div>

          {/* Bot info — quiet card, just for transparency */}
          {stats.bot_visitors > 0 && (
            <div className="card p-4 mb-4 border border-amber-100 bg-amber-50/30">
              <div className="flex items-start gap-2 text-sm">
                <Bot className="w-4 h-4 text-amber-600 mt-0.5" />
                <div className="text-amber-900">
                  <strong>{stats.bot_visitors}</strong> bot sessions filtered
                  ({stats.bot_page_views} bot page views). These are excluded
                  from Visitor count via UA heuristic.
                </div>
              </div>
            </div>
          )}

          {/* Quick interpretation hint */}
          <div className="card p-5 border border-sky-100 bg-sky-50/30">
            <div className="flex items-start gap-2.5">
              <TrendingUp className="w-5 h-5 text-sky-600 mt-0.5" />
              <div className="text-sm text-sky-900 space-y-1.5">
                <div>
                  <strong>Reading this dashboard:</strong> A healthy paid-ads
                  funnel for Malaysian SaaS at RM75 typically shows{" "}
                  <strong>1-3% Visit → Purchase</strong>. If yours is below 0.5%,
                  the landing page or targeting needs work; above 3% means
                  you can scale spend aggressively.
                </div>
                <div className="text-xs text-sky-700">
                  Hanya direkod: visitor dari ad links (URL ada utm_source).
                  Organic visit, logged-in dashboard, /admin — semua di-skip.
                  Purchase count hanya purchase yang originate dari ads link
                  (cookie utm carry through ke checkout).
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  tint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint: string;
  tint: "sky" | "orange" | "emerald";
}) {
  const borderClass =
    tint === "sky"
      ? "border-sky-100"
      : tint === "orange"
        ? "border-orange-100"
        : "border-emerald-100";
  return (
    <div className={`card p-5 border-2 ${borderClass}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold">
          {label}
        </span>
      </div>
      <div className="font-display font-extrabold text-4xl tracking-tight mb-1">
        {value.toLocaleString()}
      </div>
      <div className="text-xs text-[var(--color-text-secondary)]">{hint}</div>
    </div>
  );
}

function CvrCard({
  label,
  value,
  tone,
  highlight,
}: {
  label: string;
  value: number | null;
  tone: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`card p-5 ${
        highlight ? "border-2 border-emerald-200 bg-emerald-50/40" : ""
      }`}
    >
      <div className="text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
        {label}
      </div>
      <div className="font-display font-extrabold text-3xl tracking-tight mb-1 flex items-baseline gap-1">
        {value === null ? "—" : <>{value.toFixed(1)}<span className="text-lg">%</span></>}
      </div>
      <div className="text-xs text-[var(--color-text-secondary)]">{tone}</div>
    </div>
  );
}
