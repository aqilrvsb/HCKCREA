"use client";

// Partner Usage — aggregate credit spend across a partner's clients (HQNL).
// A partner-scoped version of the admin Usage view: team totals + per-type
// (image/video/auto) + a per-client table. Reads /api/partner/usage.

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

type ClientRow = { id: string; name: string; email: string; balance: number; cost: number; gens: number };
type Data = {
  from: string; to: string;
  totals: { cost: number; gens: number; clients: number };
  byType: Record<string, { cost: number; gens: number }>;
  clients: ClientRow[];
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function PartnerUsage() {
  const today = ymd(new Date());
  const monthAgo = ymd(new Date(Date.now() - 29 * 86400_000));
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/partner/usage?from=${from}&to=${to}`, { cache: "no-store" });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) { setErr(d?.error || "Gagal muat usage."); setData(null); return; }
      setData(d);
    } catch (e: any) { setErr(e?.message || "Gagal muat usage."); } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const preset = (days: number) => {
    setTo(ymd(new Date()));
    setFrom(ymd(new Date(Date.now() - (days - 1) * 86400_000)));
  };

  const TYPE_META = [
    { key: "image", label: "Image", tone: "#fbbf24" },
    { key: "video", label: "Video", tone: "#60a5fa" },
    { key: "auto", label: "Auto", tone: "#c084fc" },
    { key: "other", label: "Other", tone: "#94a3b8" },
  ];

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
        <div>
          <label className="mb-1 block text-[11px] text-white/50">Dari</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-sm text-white" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-white/50">Hingga</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-sm text-white" />
        </div>
        <div className="flex gap-1.5">
          {[[7, "7 hari"], [30, "30 hari"], [90, "90 hari"]].map(([d, label]) => (
            <button key={String(d)} onClick={() => preset(d as number)}
              className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/10">
              {label as string}
            </button>
          ))}
        </div>
        <button onClick={() => void load()}
          className="ml-auto rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10">
          ↻ Refresh
        </button>
      </div>

      {err && <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">{err}</div>}

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: "Jumlah kos (RM)", value: `RM ${(data?.totals.cost ?? 0).toFixed(2)}`, tone: "text-emerald-300" },
          { label: "Jumlah generation", value: String(data?.totals.gens ?? 0), tone: "text-white" },
          { label: "Client aktif", value: String(data?.totals.clients ?? 0), tone: "text-white" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-[11px] text-white/50">{s.label}</div>
            <div className={`text-2xl font-semibold ${s.tone}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* By type */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TYPE_META.map((t) => {
          const v = data?.byType?.[t.key] || { cost: 0, gens: 0 };
          return (
            <div key={t.key} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: t.tone }}>{t.label}</div>
              <div className="text-lg font-semibold text-white">RM {v.cost.toFixed(2)}</div>
              <div className="text-[11px] text-white/40">{v.gens} generation</div>
            </div>
          );
        })}
      </div>

      {/* Per-client */}
      <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
        <div className="border-b border-white/10 px-4 py-3 text-sm font-semibold text-white">Pecahan per client</div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-white/40">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuatkan…
          </div>
        ) : !data?.clients.length ? (
          <div className="py-10 text-center text-sm text-white/40">Tiada client lagi.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-white/40">
                  <th className="px-4 py-2 font-semibold">Client</th>
                  <th className="px-4 py-2 text-right font-semibold">Generation</th>
                  <th className="px-4 py-2 text-right font-semibold">Kos (RM)</th>
                  <th className="px-4 py-2 text-right font-semibold">Baki kredit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.clients.map((c) => (
                  <tr key={c.id} className="hover:bg-white/5">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-white">{c.name || "—"}</div>
                      <div className="text-[11px] text-white/40">{c.email}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-white/80">{c.gens}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-emerald-300">RM {c.cost.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right text-white/70">{c.balance.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
