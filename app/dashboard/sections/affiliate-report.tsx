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
  const [openRow, setOpenRow] = useState<Row | null>(null);
  const [resending, setResending] = useState<Set<string>>(new Set());
  const [undoing, setUndoing] = useState<Set<string>>(new Set());
  // Per-affiliate WhatsApp notify: which date to report, and who's sending.
  const [notifyDate, setNotifyDate] = useState<Record<string, string>>({});
  const [notifying, setNotifying] = useState<Set<string>>(new Set());

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

  // Undo Transfer — send the video back to the Editor. The endpoint's undo path
  // only strips the affiliate_* flags and flips in_editor back on, so Text,
  // Cover and Frame all survive untouched. The affiliate's own copy is NOT
  // withdrawn (their API has no delete) — this is a local move.
  async function undoTransfer(r: Row) {
    if (!confirm("Hantar balik video ni ke Editor?\n\nText / Cover / Frame semua kekal. Nota: video yang dah masuk Pending Post affiliate tak boleh ditarik balik dari sistem diorang.")) return;
    setUndoing((s) => new Set(s).add(r.id));
    try {
      const res = await fetch("/api/editor/transfer-affiliate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history_ids: [r.id], undo: true }),
      });
      if (!res.ok) { alert("Undo gagal."); return; }
      setOpenRow(null);
      await mutate();
    } finally {
      setUndoing((s) => { const n = new Set(s); n.delete(r.id); return n; });
    }
  }

  // WhatsApp the affiliate a "your videos have landed" notice for one date.
  // The server counts the videos itself, so the total can't be spoofed here.
  async function notifyAffiliate(email: string, date: string) {
    if (!date) return;
    setNotifying((s) => new Set(s).add(email));
    try {
      const res = await fetch("/api/affiliate/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, date }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { alert(d?.error || "Notifikasi gagal."); return; }
      alert(`✅ WhatsApp dihantar ke ${d.sent_to}\n${d.total} video · ${d.date}`);
    } catch (e: any) {
      alert(e?.message || "Notifikasi gagal.");
    } finally {
      setNotifying((s) => { const n = new Set(s); n.delete(email); return n; });
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
                <div className="flex w-full flex-wrap items-center gap-3 px-4 py-3">
                  {/* Toggle area — kept as its own button so the date input and
                      notify button aren't nested inside a <button>. */}
                  <button onClick={() => setOpenEmail(open ? null : g.email)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80">
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
                  </button>

                  {/* Notify — pick a date, WhatsApp the affiliate how many
                      videos landed that day. Defaults to their latest transfer. */}
                  <input type="date"
                    value={notifyDate[g.email] ?? (g.rows.length ? rowDate(g.rows[0]) : to)}
                    onChange={(e) => setNotifyDate((m) => ({ ...m, [g.email]: e.target.value }))}
                    title="Tarikh untuk notifikasi"
                    className="shrink-0 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white" />
                  <button
                    onClick={() => void notifyAffiliate(g.email, notifyDate[g.email] ?? (g.rows.length ? rowDate(g.rows[0]) : to))}
                    disabled={notifying.has(g.email)}
                    title={`WhatsApp ${g.name} — beritahu video untuk tarikh ni dah masuk`}
                    className="shrink-0 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-40">
                    {notifying.has(g.email) ? "…" : "📱 WhatsApp"}
                  </button>
                  <button onClick={() => setOpenEmail(open ? null : g.email)}
                    className="shrink-0 px-1 text-white/30 hover:text-white/60">{open ? "▲" : "▼"}</button>
                </div>

                {open && (
                  <div className="border-t border-white/10">
                    {g.rows.map((r) => {
                      const m = r.metadata || {};
                      const ok = m.affiliate_ingest_ok;
                      return (
                        <div key={r.id} onClick={() => setOpenRow(r)}
                          className="flex cursor-pointer items-center gap-3 border-b border-white/5 px-4 py-2.5 last:border-b-0 hover:bg-white/5">
                          <span className="w-[86px] shrink-0 text-[11px] text-white/45">{rowDate(r)}</span>
                          <span className="relative shrink-0">
                            <Thumb url={m.cover_thumbnail_url} />
                            {r.output_url && (
                              <span className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] text-white drop-shadow">▶</span>
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            {/* Main + Sub text (the cover copy), then the caption. */}
                            <span className="block truncate text-xs font-medium text-white/85">
                              {m.cover_title || <span className="text-white/35">tiada Main Text</span>}
                            </span>
                            <span className="block truncate text-[10px] text-white/45">
                              {m.cover_subtitle || <span className="text-white/25">tiada Sub Text</span>}
                            </span>
                            <span className="block truncate text-[10px] text-white/35">
                              {r.caption || m.caption
                                ? `📝 ${r.caption || m.caption}`
                                : "📝 tiada caption"}
                            </span>
                          </span>
                          {/* Which pieces this video actually carries. */}
                          <span className="hidden shrink-0 gap-1 sm:flex">
                            {[
                              { k: "T", on: !!(r.caption || m.caption || m.cover_title), t: "Text" },
                              { k: "C", on: !!m.cover_thumbnail_url, t: "Cover" },
                              { k: "F", on: !!m.framed_from, t: "Frame" },
                            ].map((b) => (
                              <span key={b.k} title={`${b.t}: ${b.on ? "ada" : "tiada"}`}
                                className={`grid h-5 w-5 place-items-center rounded text-[9px] font-bold ${
                                  b.on ? "bg-emerald-500/20 text-emerald-300" : "bg-white/5 text-white/25"
                                }`}>
                                {b.k}
                              </span>
                            ))}
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
                              <button onClick={(e) => { e.stopPropagation(); void resend(r); }} disabled={resending.has(r.id)}
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
                            <a href={r.output_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                              className="shrink-0 text-[11px] text-sky-300 hover:underline">↗</a>
                          )}
                          {/* Undo Transfer — back to the Editor, Text/Cover/Frame intact. */}
                          <button onClick={(e) => { e.stopPropagation(); void undoTransfer(r); }}
                            disabled={undoing.has(r.id)}
                            title="Undo Transfer — hantar balik ke Editor (Text/Cover/Frame kekal)"
                            className="shrink-0 rounded-lg border border-violet-400/30 bg-violet-400/10 px-2 py-1 text-[11px] text-violet-200 hover:bg-violet-400/20 disabled:opacity-40">
                            {undoing.has(r.id) ? "…" : "↩"}
                          </button>
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

      {/* Detail — plays the exact video the affiliate received, beside the
          exact cover + text that went with it. */}
      {openRow && (() => {
        const m = openRow.metadata || {};
        return (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.8)" }} onClick={() => setOpenRow(null)}>
            <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-[#111] p-5"
              onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-white">
                    {m.affiliate_name || m.affiliate_email || "—"}
                  </div>
                  <div className="text-[11px] text-white/45">
                    {m.affiliate_email} · {rowDate(openRow)}
                  </div>
                </div>
                <button onClick={() => setOpenRow(null)}
                  className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/60 hover:bg-white/10">
                  ✕
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                <div>
                  {openRow.output_url ? (
                    <video src={openRow.output_url} controls playsInline
                      className="max-h-[60vh] w-full rounded-xl bg-black" />
                  ) : (
                    <div className="grid h-40 place-items-center rounded-xl bg-white/5 text-xs text-white/40">
                      Tiada video
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-white/35">Cover</div>
                    {m.cover_thumbnail_url ? (
                      <img src={m.cover_thumbnail_url} alt="cover"
                        className="w-full rounded-lg border border-white/10" />
                    ) : (
                      <div className="grid h-28 place-items-center rounded-lg bg-white/5 text-[11px] text-white/35">
                        Tiada cover
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-white/35">Main Text</div>
                    <div className="text-xs text-white/85">{m.cover_title || <span className="text-white/30">—</span>}</div>
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-white/35">Sub Text</div>
                    <div className="text-xs text-white/70">{m.cover_subtitle || <span className="text-white/30">—</span>}</div>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-white/35">Caption</div>
                <div className="whitespace-pre-wrap rounded-lg bg-white/5 p-3 text-xs text-white/75">
                  {openRow.caption || m.caption || <span className="text-white/30">Tiada caption</span>}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                {m.affiliate_ingest_ok === true ? (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
                    ✓ dihantar{m.affiliate_ingest_id ? ` #${m.affiliate_ingest_id}` : ""}
                  </span>
                ) : m.affiliate_ingest_ok === false ? (
                  <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-rose-300">
                    ✗ {String(m.affiliate_ingest_error || "gagal")}
                  </span>
                ) : (
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-white/40">tiada rekod hantar</span>
                )}
                {openRow.output_url && (
                  <a href={openRow.output_url} target="_blank" rel="noreferrer"
                    className="text-sky-300 hover:underline">Buka video ↗</a>
                )}
                <button onClick={() => void undoTransfer(openRow)} disabled={undoing.has(openRow.id)}
                  className="rounded-lg border border-violet-400/30 bg-violet-400/10 px-2.5 py-1 text-[11px] text-violet-200 hover:bg-violet-400/20 disabled:opacity-40">
                  {undoing.has(openRow.id) ? "…" : "↩ Undo Transfer"}
                </button>
                <span className="ml-auto font-mono text-[10px] text-white/25">{openRow.id}</span>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
