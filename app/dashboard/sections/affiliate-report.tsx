"use client";

// Reporting Affiliate — per-email breakdown of every video transferred to an
// affiliate, with a date filter. Read-only: this is the accounting view of the
// Transfer Affiliate tab, not another place to move videos.
//
// Grouping key is metadata.affiliate_email; the date is
// metadata.affiliate_transfer_date (KL, YYYY-MM-DD) with a fallback to
// affiliate_transferred_at for rows transferred before that field existed.

import { useMemo, useState } from "react";
import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";

type Row = {
  id: string;
  output_url: string | null;
  thumbnail_url: string | null;
  caption: string | null;
  created_at: string;
  metadata: Record<string, any> | null;
};

/** YYYY-MM-DD for a Date in KL. */
function klDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/** The KL transfer date for a row, whatever era it was written in. */
function rowDate(r: Row): string {
  const m = r.metadata || {};
  if (typeof m.affiliate_transfer_date === "string" && m.affiliate_transfer_date) {
    return m.affiliate_transfer_date;
  }
  const iso = m.affiliate_transferred_at || r.created_at;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : klDate(d);
}

/** Cover thumbnail. Deliberately does NOT fall back to history.thumbnail_url —
 *  that column holds the .mp4 itself, so an <img> on it always renders broken.
 *  A dead cover URL (old covers sat on an expiring provider CDN) falls back to
 *  a placeholder instead of the browser's broken-image icon. */
function Thumb({ url }: { url?: string | null }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <span className="grid h-11 w-[26px] shrink-0 place-items-center rounded bg-white/5 text-[10px] text-white/30">
        🎬
      </span>
    );
  }
  return (
    <img src={url} alt="" onError={() => setBroken(true)}
      className="h-11 w-[26px] shrink-0 rounded object-cover" />
  );
}

export default function AffiliateReport({ projectId }: { projectId?: string | null }) {
  // Default window: the last 30 days, inclusive.
  const today = klDate(new Date());
  const monthAgo = klDate(new Date(Date.now() - 29 * 86400_000));
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [openEmail, setOpenEmail] = useState<string | null>(null);
  const [resending, setResending] = useState<Set<string>>(new Set());

  const { data: rows = [], isLoading, mutate } = useSWR<Row[]>(
    ["affiliate-report", projectId || "-"],
    async () => {
      const sb = createClient();
      let q = sb
        .from("history")
        .select("id, output_url, thumbnail_url, caption, created_at, metadata")
        .eq("type", "video")
        .filter("metadata->>affiliate_transferred", "eq", "true")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (projectId) q = q.eq("project_id", projectId);
      const { data } = await q;
      return (data || []) as Row[];
    },
    { revalidateOnFocus: false }
  );

  // Date filter → per-email groups.
  const { groups, totals } = useMemo(() => {
    const inRange = rows.filter((r) => {
      const d = rowDate(r);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    const map = new Map<string, { email: string; name: string; rows: Row[]; sent: number; failed: number }>();
    for (const r of inRange) {
      const m = r.metadata || {};
      const email = String(m.affiliate_email || "—").toLowerCase();
      if (!map.has(email)) {
        map.set(email, { email, name: String(m.affiliate_name || email.split("@")[0]), rows: [], sent: 0, failed: 0 });
      }
      const g = map.get(email)!;
      g.rows.push(r);
      if (m.affiliate_ingest_ok === true) g.sent++;
      else if (m.affiliate_ingest_ok === false) g.failed++;
    }
    const groups = [...map.values()].sort((a, b) => b.rows.length - a.rows.length);
    return {
      groups,
      totals: {
        videos: inRange.length,
        affiliates: groups.length,
        sent: groups.reduce((s, g) => s + g.sent, 0),
        failed: groups.reduce((s, g) => s + g.failed, 0),
      },
    };
  }, [rows, from, to]);

  // Re-push a video that failed to reach the affiliate's platform. The ingest
  // is idempotent on source_id, so this can never create a duplicate there.
  async function resend(r: Row) {
    const m = r.metadata || {};
    const email = String(m.affiliate_email || "");
    if (!email) return;
    setResending((s) => new Set(s).add(r.id));
    try {
      await fetch("/api/editor/transfer-affiliate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history_ids: [r.id], email, name: m.affiliate_name || "" }),
      });
      await mutate();
    } finally {
      setResending((s) => { const n = new Set(s); n.delete(r.id); return n; });
    }
  }

  function exportCsv() {
    const head = ["date", "affiliate_name", "affiliate_email", "history_id", "caption", "cover_title", "cover_subtitle", "video_url", "ingest"];
    const lines = [head.join(",")];
    for (const g of groups) {
      for (const r of g.rows) {
        const m = r.metadata || {};
        const cell = (v: any) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
        lines.push([
          rowDate(r), g.name, g.email, r.id, r.caption ?? m.caption ?? "",
          m.cover_title ?? "", m.cover_subtitle ?? "", r.output_url ?? "",
          m.affiliate_ingest_ok === true ? "sent" : m.affiliate_ingest_ok === false ? "failed" : "—",
        ].map(cell).join(","));
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `affiliate-report-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const preset = (days: number) => {
    setTo(klDate(new Date()));
    setFrom(klDate(new Date(Date.now() - (days - 1) * 86400_000)));
  };

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
        <div className="ml-auto flex gap-2">
          <button onClick={() => void mutate()}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10">
            ↻ Refresh
          </button>
          <button onClick={exportCsv} disabled={!totals.videos}
            className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-40">
            ⬇ CSV
          </button>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Jumlah video", value: totals.videos, tone: "text-white" },
          { label: "Affiliate", value: totals.affiliates, tone: "text-white" },
          { label: "Berjaya hantar", value: totals.sent, tone: "text-emerald-300" },
          { label: "Gagal hantar", value: totals.failed, tone: "text-rose-300" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-[11px] text-white/50">{s.label}</div>
            <div className={`text-2xl font-semibold ${s.tone}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Per-email breakdown */}
      {isLoading ? (
        <div className="py-10 text-center text-sm text-white/40">Memuatkan…</div>
      ) : !groups.length ? (
        <div className="rounded-xl border border-white/10 bg-white/5 py-10 text-center text-sm text-white/40">
          Tiada transfer affiliate dalam julat tarikh ini.
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const open = openEmail === g.email;
            return (
              <div key={g.email} className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
                <button onClick={() => setOpenEmail(open ? null : g.email)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-sm text-emerald-300">
                    {g.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-white">{g.name}</span>
                    <span className="block truncate text-[11px] text-white/45">{g.email}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-lg font-semibold text-white">{g.rows.length}</span>
                    <span className="block text-[10px] text-white/45">video</span>
                  </span>
                  {g.failed > 0 && (
                    <span className="shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300">
                      {g.failed} gagal
                    </span>
                  )}
                  <span className="shrink-0 text-white/30">{open ? "▲" : "▼"}</span>
                </button>

                {open && (
                  <div className="border-t border-white/10">
                    {g.rows.map((r) => {
                      const m = r.metadata || {};
                      const ok = m.affiliate_ingest_ok;
                      return (
                        <div key={r.id} className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5 last:border-b-0">
                          <span className="w-[86px] shrink-0 text-[11px] text-white/45">{rowDate(r)}</span>
                          <Thumb url={m.cover_thumbnail_url} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs text-white/80">
                              {m.cover_title || r.caption || m.caption || "—"}
                            </span>
                            <span className="block truncate text-[10px] text-white/40">
                              {m.cover_subtitle || r.id.slice(0, 8)}
                            </span>
                          </span>
                          {ok === true ? (
                            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                              ✓ dihantar{m.affiliate_ingest_id ? ` #${m.affiliate_ingest_id}` : ""}
                            </span>
                          ) : ok === false ? (
                            <>
                              <span className="shrink-0 max-w-[180px] truncate rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300"
                                title={String(m.affiliate_ingest_error || "")}>
                                ✗ {String(m.affiliate_ingest_error || "gagal")}
                              </span>
                              <button onClick={() => void resend(r)} disabled={resending.has(r.id)}
                                className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/70 hover:bg-white/10 disabled:opacity-40">
                                {resending.has(r.id) ? "…" : "Hantar semula"}
                              </button>
                            </>
                          ) : (
                            <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-white/40">
                              tiada rekod hantar
                            </span>
                          )}
                          {r.output_url && (
                            <a href={r.output_url} target="_blank" rel="noreferrer"
                              className="shrink-0 text-[11px] text-sky-300 hover:underline">video ↗</a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
