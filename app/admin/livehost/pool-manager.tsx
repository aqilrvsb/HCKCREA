"use client";

import { useCallback, useEffect, useState } from "react";
import { Server, Plus, Trash2, RefreshCw, Loader2 } from "lucide-react";

type Slot = {
  id: string;
  endpoint_id: string;
  runsync_url: string;
  label: string | null;
  status: string;
  holder_email: string;
  assigned_at: string | null;
  last_seen: string | null;
  created_at: string;
};

// Admin: the shared 5090 serverless endpoint POOL. Create N endpoints (each a
// single-worker $0-idle 5090), see free/busy live, delete spares. Clients are
// round-robin assigned a free slot on Play and released on Stop.
export default function PoolManager() {
  const [pool, setPool] = useState<Slot[]>([]);
  const [stats, setStats] = useState({ total: 0, free: 0, busy: 0 });
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState("5");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/livehost/pool");
      const d = await r.json();
      if (r.ok) {
        setPool(d.pool || []);
        setStats({ total: d.total || 0, free: d.free || 0, busy: d.busy || 0 });
      } else setMsg(d.error || "Load failed");
    } catch (e: any) {
      setMsg(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createEndpoints() {
    const n = Math.max(1, Math.min(50, Number(count) || 1));
    if (!window.confirm(`Create ${n} new 5090 serverless endpoint(s)? They are $0 when idle.`)) return;
    setBusy(true);
    setMsg(`Creating ${n} endpoint(s)…`);
    try {
      const r = await fetch("/api/admin/livehost/pool", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: n }),
      });
      const d = await r.json();
      setMsg(r.ok ? `Created ${d.created}/${d.requested}.${d.created < d.requested ? " Some failed — check Novita." : ""}` : (d.error || "Create failed"));
      await load();
    } catch (e: any) {
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function removeEndpoint(endpointId: string) {
    if (!window.confirm(`Delete endpoint ${endpointId}? This removes it from Novita + the pool.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/livehost/pool?id=${encodeURIComponent(endpointId)}`, { method: "DELETE" });
      const d = await r.json();
      setMsg(r.ok ? "Deleted." : (d.error || "Delete failed"));
      await load();
    } catch (e: any) {
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl p-5 mb-6" style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border)" }}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(96,165,250,0.15)" }}>
          <Server className="w-4 h-4 text-blue-400" />
        </div>
        <div>
          <h2 className="font-display font-extrabold text-lg">GPU Pool (5090 serverless)</h2>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Shared endpoints — clients round-robin a free slot on Play. $0 when idle.
          </p>
        </div>
        <button onClick={load} className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold"
          style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Stats + create */}
      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div className="flex gap-3">
          <Stat label="Total" value={stats.total} />
          <Stat label="Free" value={stats.free} color="#4ade80" />
          <Stat label="Busy" value={stats.busy} color="#fbbf24" />
        </div>
        <div className="ml-auto flex items-end gap-2">
          <label className="text-xs font-bold text-[var(--color-text-secondary)]">
            How many
            <input value={count} onChange={(e) => setCount(e.target.value)} type="number" min="1" max="50"
              className="mt-1 block w-24 px-3 py-2 rounded-lg text-sm font-normal"
              style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }} />
          </label>
          <button onClick={createEndpoints} disabled={busy}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-extrabold text-white disabled:opacity-60"
            style={{ background: "linear-gradient(90deg,#3b82f6,#2563eb)" }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create
          </button>
        </div>
      </div>

      {msg && <div className="mb-3 text-xs font-bold text-[var(--color-text-secondary)]">{msg}</div>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
      ) : pool.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">No pool endpoints yet — create some above.</p>
      ) : (
        <div className="space-y-2">
          {pool.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg text-xs"
              style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}>
              <span className="px-2 py-0.5 rounded-md font-bold uppercase tracking-wider"
                style={{
                  background: s.status === "busy" ? "rgba(245,158,11,0.15)" : s.status === "free" ? "rgba(74,222,128,0.15)" : "rgba(148,163,184,0.15)",
                  color: s.status === "busy" ? "#fbbf24" : s.status === "free" ? "#4ade80" : "#94a3b8",
                }}>
                {s.status}
              </span>
              <span className="font-mono text-[var(--color-text-secondary)]">{s.endpoint_id}</span>
              {s.holder_email && <span className="text-[var(--color-text-muted)]">→ {s.holder_email}</span>}
              <a href={s.runsync_url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline truncate max-w-[260px]">{s.runsync_url}</a>
              <button onClick={() => removeEndpoint(s.endpoint_id)} disabled={busy}
                className="ml-auto p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 disabled:opacity-50" title="Delete endpoint">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="px-4 py-2 rounded-xl text-center" style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}>
      <div className="font-display font-extrabold text-2xl" style={{ color: color || "var(--color-text-primary)" }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-text-muted)]">{label}</div>
    </div>
  );
}
