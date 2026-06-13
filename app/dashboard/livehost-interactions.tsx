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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/livehost/interactions?start=${start}&end=${end}`);
      const d = await r.json();
      setCounts(d.counts || {});
      setRecent(d.recent || []);
    } finally {
      setLoading(false);
    }
  }, [start, end]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="panel single">
      <div className="label">📈 Interaksi penonton (dari extension TikTok LIVE)</div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div><div className="label">Dari</div>
          <input type="date" value={start} max={localDateStr()} onChange={(e) => setStart(e.target.value)} /></div>
        <div><div className="label">Hingga</div>
          <input type="date" value={end} max={localDateStr()} onChange={(e) => setEnd(e.target.value)} /></div>
        <button className="restart-btn" onClick={() => { setStart(startOfMonthLocal()); setEnd(localDateStr()); }}>Bulan ini</button>
        <button className="restart-btn" onClick={() => { const t = localDateStr(); setStart(t); setEnd(t); }}>Hari ini</button>
      </div>

      <div className="stats-grid">
        {STATS.map((s) => (
          <div key={s.key} className="usage-card" style={{ textAlign: "center" }}>
            <div className="usage-big" style={{ color: s.color }}>{counts[s.key] || 0}</div>
            <div className="hint" style={{ marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div className="label">Terkini (100)</div>
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
