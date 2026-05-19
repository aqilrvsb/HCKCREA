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
  MessageCircle,
  Mail,
  Clock,
  AlertCircle,
} from "lucide-react";
import { localDateStr } from "@/lib/date-util";

type DetailRow = {
  id: string;
  name: string | null;
  email: string | null;
  whatsapp: string | null;
  amount: number;
  created_at: string;
  paid_at: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
};

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
  abandoned: DetailRow[];
  purchased: DetailRow[];
};

// Render a MY-local "DD MMM HH:mm" so the admin doesn't have to do UTC
// math. The browser auto-uses MY locale because the admin is in MY.
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Strip the "+" prefix for wa.me links (it wants raw digits, no +).
function waLink(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}`;
}

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
          <div className="card p-5 mb-6 border border-sky-100 bg-sky-50/30">
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

          {/* ─────────────── Abandoned carts ─────────────── */}
          {/* High-priority follow-up list — these clicked Bayar RM75 but
              never paid. WhatsApp them within an hour or two for best
              conversion ("nak tolong checkout?" reactivation message). */}
          <div className="card p-5 mb-6 border-2 border-amber-100">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="w-5 h-5 text-amber-600" />
              <h2 className="font-display font-bold text-lg">
                Abandoned Checkouts
              </h2>
              <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-widest">
                {stats.abandoned.length} leads
              </span>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)] mb-4">
              Clicked Bayar RM75 button tapi tak complete payment. WhatsApp
              dia dalam 1-2 jam untuk recover sale.
            </p>
            {stats.abandoned.length === 0 ? (
              <div className="text-sm text-[var(--color-text-muted)] py-4 text-center">
                Tiada abandoned checkout dalam tempoh ini. 🎉
              </div>
            ) : (
              <DetailTable rows={stats.abandoned} kind="abandoned" />
            )}
          </div>

          {/* ─────────────── Paid purchases ─────────────── */}
          <div className="card p-5 border-2 border-emerald-100">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <h2 className="font-display font-bold text-lg">
                Paid Purchases
              </h2>
              <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-widest">
                {stats.purchased.length} sales · RM{stats.revenue_myr.toFixed(2)}
              </span>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)] mb-4">
              Customer yang complete payment dari ads. Login info dah
              auto-sent via WhatsApp.
            </p>
            {stats.purchased.length === 0 ? (
              <div className="text-sm text-[var(--color-text-muted)] py-4 text-center">
                Belum ada paid purchase dari ads dalam tempoh ini.
              </div>
            ) : (
              <DetailTable rows={stats.purchased} kind="purchased" />
            )}
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

function DetailTable({
  rows,
  kind,
}: {
  rows: DetailRow[];
  kind: "abandoned" | "purchased";
}) {
  return (
    <div className="overflow-x-auto -mx-5 px-5">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th className="text-left py-2 pr-3 text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold">
              Customer
            </th>
            <th className="text-left py-2 px-3 text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold">
              Contact
            </th>
            <th className="text-left py-2 px-3 text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold">
              Source
            </th>
            <th className="text-right py-2 px-3 text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold">
              {kind === "abandoned" ? "Abandoned at" : "Paid at"}
            </th>
            <th className="text-right py-2 pl-3 text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const wa = waLink(r.whatsapp);
            return (
              <tr
                key={r.id}
                className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg)]/40 transition-colors"
              >
                <td className="py-3 pr-3">
                  <div className="font-semibold text-[var(--color-text-primary)]">
                    {r.name || "—"}
                  </div>
                  <div className="text-[10px] font-mono text-[var(--color-text-muted)] mt-0.5">
                    {r.id.slice(0, 8)}
                  </div>
                </td>
                <td className="py-3 px-3">
                  <div className="flex flex-col gap-1">
                    {r.whatsapp && (
                      <a
                        href={wa || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-emerald-700 hover:text-emerald-800 font-semibold text-xs"
                        title="Open in WhatsApp"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        {r.whatsapp}
                      </a>
                    )}
                    {r.email && (
                      <a
                        href={`mailto:${r.email}`}
                        className="inline-flex items-center gap-1.5 text-sky-700 hover:text-sky-800 text-xs"
                        title="Send email"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        {r.email}
                      </a>
                    )}
                  </div>
                </td>
                <td className="py-3 px-3">
                  <div className="text-xs">
                    <div className="font-semibold text-[var(--color-text-primary)]">
                      {r.utm_source || "—"}
                    </div>
                    {r.utm_campaign && (
                      <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                        {r.utm_campaign}
                      </div>
                    )}
                    {r.utm_content && (
                      <div className="text-[10px] text-[var(--color-text-muted)] truncate max-w-[180px]">
                        {r.utm_content}
                      </div>
                    )}
                  </div>
                </td>
                <td className="py-3 px-3 text-right">
                  <div className="inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
                    <Clock className="w-3 h-3" />
                    {fmtTime(kind === "purchased" ? r.paid_at : r.created_at)}
                  </div>
                </td>
                <td className="py-3 pl-3 text-right font-mono font-bold text-[var(--color-text-primary)]">
                  RM{r.amount.toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
