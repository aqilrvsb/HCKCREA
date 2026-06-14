"use client";

// Interactions dashboard — viewer-event stats recorded by the extension
// (live_interactions table), filtered by MYT date range.

import { useCallback, useEffect, useState } from "react";
import { localDateStr, startOfMonthLocal } from "@/lib/date-util";

type Row = { type: string; username: string; text: string; created_at: string };

const STATS: { key: string; label: string; color: string }[] = [
  { key: "comment", label: "SEEN", color: "#e6e9f2" },
  { key: "reply", label: "REPLIED", color: "#4ade80" },
  { key: "skip", label: "SKIPPED", color: "#fbbf24" },
  { key: "join", label: "JOINS", color: "#60a5fa" },
  { key: "greet", label: "GREETED", color: "#a78bfa" },
  { key: "follow", label: "FOLLOWS", color: "#f472b6" },
  { key: "like", label: "LIKES", color: "#34d399" },
  { key: "purchase", label: "PURCHASES", color: "#fb923c" },
];

export default function LivehostInteractions() {
  const [start, setStart] = useState(startOfMonthLocal());
  const [end, setEnd] = useState(localDateStr());
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const [live, setLive] = useState(true);
  const [usage, setUsage] = useState<{ streamSec: number; gpuCost: number; voiceCost: number; totalCost: number } | null>(null);
  const [rates, setRates] = useState<{ gpuRateHour: number; voiceRate1k: number } | null>(null);
  const load = useCallback(async () => {
    try {
      const [ri, rs] = await Promise.all([
        fetch(`/api/livehost/interactions?start=${start}&end=${end}`).then((r) => r.json()),
        fetch(`/api/livehost/session?start=${start}&end=${end}`).then((r) => r.json()).catch(() => null),
      ]);
      setCounts(ri.counts || {});
      setRecent(ri.recent || []);
      if (rs?.month) { setUsage(rs.month); setRates(rs.rates); }
    } finally {
      setLoading(false);
    }
  }, [start, end]);
  // real-time: refresh every 5s while "live" auto-refresh is on
  useEffect(() => {
    load();
    if (!live) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load, live]);

  const total = STATS.reduce((a, s) => a + (counts[s.key] || 0), 0);
  return (
    <div className="panel single">
      <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <div><div className="label">Dari</div>
          <input type="date" value={start} max={localDateStr()} onChange={(e) => setStart(e.target.value)} /></div>
        <div><div className="label">Hingga</div>
          <input type="date" value={end} max={localDateStr()} onChange={(e) => setEnd(e.target.value)} /></div>
        <button className="restart-btn" onClick={() => { setStart(startOfMonthLocal()); setEnd(localDateStr()); }}>Bulan ini</button>
        <button className="restart-btn" onClick={() => { const t = localDateStr(); setStart(t); setEnd(t); }}>Hari ini</button>
        <button className="restart-btn" onClick={() => setLive((v) => !v)}
          style={live ? { borderColor: "var(--accent-2)", color: "var(--accent-2)" } : {}}>
          {live ? "● Live" : "Auto-refresh off"}
        </button>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div className="usage-big" style={{ fontSize: 26 }}>{total.toLocaleString()}</div>
          <div className="hint" style={{ marginTop: 0 }}>jumlah interaksi</div>
        </div>
      </div>

      {/* Live time + total cost (per-second billing, shown in minutes; admin rates) */}
      <div className="stats-grid" style={{ marginTop: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div className="usage-card" style={{ textAlign: "center", borderColor: "rgba(91,108,255,.4)" }}>
          <div className="usage-big" style={{ color: "#5b6cff" }}>
            {usage ? `${Math.floor(usage.streamSec / 3600)}h ${Math.floor((usage.streamSec % 3600) / 60)}m` : "—"}
          </div>
          <div className="hint" style={{ marginTop: 2 }}>JUMLAH MASA LIVE</div>
        </div>
        <div className="usage-card" style={{ textAlign: "center", borderColor: "rgba(236,72,153,.4)" }}>
          <div className="usage-big" style={{ color: "#f472b6" }}>RM {usage ? usage.gpuCost.toFixed(2) : "0.00"}</div>
          <div className="hint" style={{ marginTop: 2 }}>COST GPU</div>
        </div>
        <div className="usage-card" style={{ textAlign: "center", borderColor: "rgba(96,165,250,.4)" }}>
          <div className="usage-big" style={{ color: "#60a5fa" }}>RM {usage ? usage.voiceCost.toFixed(2) : "0.00"}</div>
          <div className="hint" style={{ marginTop: 2 }}>COST AUDIO</div>
        </div>
      </div>

      <div className="stats-grid" style={{ marginTop: 14 }}>
        {STATS.map((s) => (
          <div key={s.key} className="usage-card stat-tile" style={{ textAlign: "center" }}>
            <div className="usage-big" style={{ color: s.color }}>{(counts[s.key] || 0).toLocaleString()}</div>
            <div className="hint" style={{ marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div className="label" style={{ marginTop: 16 }}>Aliran langsung (100 terkini)</div>
      <div className="usage-card" style={{ padding: 0, overflow: "hidden", maxHeight: 360, overflowY: "auto" }}>
        <table className="sessions-table">
          <thead><tr><th>Masa</th><th>Jenis</th><th>Username</th><th>Teks</th></tr></thead>
          <tbody>
            {recent.map((r, i) => (
              <tr key={i}>
                <td>{new Date(r.created_at).toLocaleTimeString("ms-MY", { hour: "2-digit", minute: "2-digit" })}</td>
                <td><span className={`sess-badge ${r.type === "reply" ? "active" : "ended"}`}>{r.type}</span></td>
                <td>{r.username}</td>
                <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.text}</td>
              </tr>
            ))}
            {!loading && recent.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)" }}>Tiada interaksi dalam julat tarikh ini.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
