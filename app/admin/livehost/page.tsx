"use client";

// Admin → Livehost: configure each Livehost client's streaming backend.
// Per client only TWO fields matter: backend_url (their GPU tunnel URL) and
// vast_instance_id (their dedicated GPU). The global vast_api_key lives in
// app_settings (key: vast_api_key).

import { useCallback, useEffect, useState } from "react";
import { Radio, Save, RefreshCw, Clock, Wallet } from "lucide-react";
import { localDateStr, startOfMonthLocal } from "@/lib/date-util";

type Client = {
  id: string;
  email: string;
  name: string;
  plan: string;
  plan_expires_at: string | null;
  backend_url: string;
  vast_instance_id: string;
  notes: string;
  provision_status: string;
  gpu_status: string;
  gpu_allowed: boolean;
  gpu_on: boolean;
  gpu_on_at: string | null;
  gpu_endpoint_id: string;
  usage: {
    streamSec: number; sessions: number; live: boolean;
    voiceChars: number; gpuCost: number; voiceCost: number; totalCost: number;
  };
};

type PoolEp = { endpointId: string; label: string; status: string; assignedUserId: string | null; assignedEmail: string };

export default function AdminLivehostPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [pool, setPool] = useState<PoolEp[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [msg, setMsg] = useState("");
  const [gpuRate, setGpuRate] = useState("6.00");
  const [voiceRate, setVoiceRate] = useState("0.30");
  const [savingRates, setSavingRates] = useState(false);
  const [start, setStart] = useState(startOfMonthLocal());
  const [end, setEnd] = useState(localDateStr());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/livehost?start=${start}&end=${end}`);
      const d = await r.json();
      setClients(d.clients || []);
      setPool(d.pool || []);
    } finally {
      setLoading(false);
    }
  }, [start, end]);
  useEffect(() => { load(); }, [load]);


  const provision = async (c: Client) => {
    if (!window.confirm(`Auto-provision GPU + tunnel untuk ${c.email}? (~30 min build, ~RM1 GPU time)`)) return;
    setSavingId(c.id);
    setMsg("");
    try {
      const r = await fetch("/api/admin/livehost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "provision", userId: c.id }),
      });
      const d = await r.json();
      setMsg(d.ok ? `Provisioning started: ${d.backendUrl || ""} (${d.status})` : d.status || d.error || "failed");
      load();
    } finally {
      setSavingId("");
    }
  };

  const checkReady = async (c: Client) => {
    const r = await fetch("/api/admin/livehost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "check", userId: c.id }),
    });
    const d = await r.json();
    setMsg(`${c.email}: ${d.status || "no status"}`);
    load();
  };

  const update = (id: string, patch: Partial<Client>) =>
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  // Assign the selected pool GPU (c.gpu_endpoint_id, set by the dropdown) to this
  // client — or "" to unassign (free it back to the pool). The client then turns
  // it on/off themselves at their Usage tab.
  const assignGpu = async (c: Client) => {
    setSavingId(c.id); setMsg("");
    try {
      const r = await fetch("/api/admin/livehost", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "gpu_assign", userId: c.id, endpointId: c.gpu_endpoint_id || "" }),
      });
      const d = await r.json();
      setMsg(d.ok
        ? `${c.email}: ${c.gpu_endpoint_id ? `GPU di-assign (${c.gpu_endpoint_id})` : "GPU ditarik balik"}${d.charged ? ` · caj RM ${Number(d.charged).toFixed(2)}` : ""}`
        : d.error || "failed");
      load();
    } finally { setSavingId(""); }
  };

  const save = async (c: Client) => {
    setSavingId(c.id);
    setMsg("");
    try {
      const r = await fetch("/api/admin/livehost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: c.id,
          backendUrl: c.backend_url,
          vastInstanceId: c.vast_instance_id,
          notes: c.notes,
        }),
      });
      const d = await r.json();
      setMsg(d.ok ? `Saved ${c.email}` : d.error || "Save failed");
    } catch (e: any) {
      setMsg(String(e?.message || e));
    } finally {
      setSavingId("");
    }
  };

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-11 h-11 rounded-2xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)" }}
        >
          <Radio className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-display font-extrabold text-2xl">Livehost Clients</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Status GPU, masa streaming & kos ikut tarikh. Rates & AI model kini di
            Admin → Settings → Livehost.
          </p>
        </div>
        <button
          onClick={load}
          className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold"
          style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* date filter (MYT) — like the Errors tab */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <label className="text-xs font-bold text-[var(--color-text-secondary)]">
          Dari
          <input type="date" value={start} max={localDateStr()} onChange={(e) => setStart(e.target.value)}
            className="mt-1 block px-3 py-2 rounded-lg text-sm font-normal"
            style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} />
        </label>
        <label className="text-xs font-bold text-[var(--color-text-secondary)]">
          Hingga
          <input type="date" value={end} max={localDateStr()} onChange={(e) => setEnd(e.target.value)}
            className="mt-1 block px-3 py-2 rounded-lg text-sm font-normal"
            style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} />
        </label>
        <button onClick={() => { setStart(startOfMonthLocal()); setEnd(localDateStr()); }}
          className="px-3 py-2 rounded-lg text-xs font-bold"
          style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
          Bulan ini
        </button>
        <button onClick={() => { const t = localDateStr(); setStart(t); setEnd(t); }}
          className="px-3 py-2 rounded-lg text-xs font-bold"
          style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
          Hari ini
        </button>
      </div>

      {msg && (
        <div className="mb-4 px-4 py-2 rounded-lg text-sm font-bold"
          style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", color: "#4ade80" }}>
          {msg}
        </div>
      )}

      {loading ? (
        <p className="text-[var(--color-text-secondary)]">Loading…</p>
      ) : clients.length === 0 ? (
        <p className="text-[var(--color-text-secondary)]">
          No clients on the <b>livehost</b> plan yet.
        </p>
      ) : (
        <div className="space-y-4">
          {clients.map((c) => (
            <div key={c.id} className="rounded-2xl p-5"
              style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="font-bold">{c.email}</span>
                {c.name && <span className="text-sm text-[var(--color-text-muted)]">({c.name})</span>}
                <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                  style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa" }}>
                  {c.plan}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                  style={c.usage?.live
                    ? { background: "rgba(239,68,68,0.15)", color: "#f87171" }
                    : c.gpu_status === "running"
                      ? { background: "rgba(34,197,94,0.15)", color: "#4ade80" }
                      : { background: "rgba(148,163,184,0.15)", color: "#94a3b8" }}>
                  {c.usage?.live ? "● LIVE NOW" : `GPU: ${c.gpu_status}`}
                </span>
                {c.plan_expires_at && (
                  <span className="text-xs text-[var(--color-text-muted)]">
                    expires {new Date(c.plan_expires_at).toLocaleDateString("ms-MY")}
                  </span>
                )}
              </div>

              {/* Assign a dedicated GPU (dropdown of UNASSIGNED pool endpoints).
                  Client then turns it on/off at their Usage tab. */}
              <div className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-xl"
                style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                <span className="text-xs font-bold text-[var(--color-text-secondary)]">GPU dedikasi:</span>
                <select
                  value={c.gpu_endpoint_id || ""}
                  onChange={(e) => update(c.id, { gpu_endpoint_id: e.target.value })}
                  className="px-3 py-2 rounded-lg text-sm font-bold flex-1 min-w-[220px]"
                  style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}>
                  <option value="">— Tiada (tidak di-assign) —</option>
                  {pool
                    .filter((p) => !p.assignedUserId || p.assignedUserId === c.id)
                    .map((p) => (
                      <option key={p.endpointId} value={p.endpointId}>
                        {p.label} {p.assignedUserId === c.id ? "(semasa)" : "(free)"}
                      </option>
                    ))}
                </select>
                {c.gpu_on && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: "rgba(34,197,94,0.15)", color: "#4ade80" }}>
                    ● client ON{c.gpu_on_at ? ` — ${new Date(c.gpu_on_at).toLocaleString("ms-MY")}` : ""}
                  </span>
                )}
                <button onClick={() => assignGpu(c)} disabled={savingId === c.id}
                  className="px-4 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg,#3b82f6,#2563eb)" }}>
                  {savingId === c.id ? "…" : "Save GPU"}
                </button>
              </div>
              {pool.filter((p) => !p.assignedUserId).length === 0 && !c.gpu_endpoint_id && (
                <p className="text-xs text-[var(--color-text-muted)] -mt-2 mb-3">
                  Tiada GPU free di Novita. Cipta endpoint baru di Novita dahulu.
                </p>
              )}

              {/* usage in the selected date range */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="rounded-xl px-3 py-2.5" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] flex items-center gap-1"><Clock className="w-3 h-3" /> Streaming</div>
                  <div className="font-extrabold text-lg">
                    {Math.floor((c.usage?.streamSec || 0) / 3600)}h {Math.floor(((c.usage?.streamSec || 0) % 3600) / 60)}m
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)]">{c.usage?.sessions || 0} sesi</div>
                </div>
                <div className="rounded-xl px-3 py-2.5" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">GPU cost</div>
                  <div className="font-extrabold text-lg">RM {(c.usage?.gpuCost || 0).toFixed(2)}</div>
                </div>
                <div className="rounded-xl px-3 py-2.5" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">Voice cost</div>
                  <div className="font-extrabold text-lg">RM {(c.usage?.voiceCost || 0).toFixed(2)}</div>
                  <div className="text-[10px] text-[var(--color-text-muted)]">{(c.usage?.voiceChars || 0).toLocaleString()} chars</div>
                </div>
                <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.3)" }}>
                  <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: "#4ade80" }}><Wallet className="w-3 h-3" /> Total</div>
                  <div className="font-extrabold text-lg" style={{ color: "#4ade80" }}>RM {(c.usage?.totalCost || 0).toFixed(2)}</div>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <label className="text-xs font-bold text-[var(--color-text-secondary)]">
                  Backend URL (GPU tunnel)
                  <input
                    value={c.backend_url}
                    onChange={(e) => update(c.id, { backend_url: e.target.value })}
                    placeholder="https://client1.peningcast.com"
                    className="mt-1 w-full px-3 py-2.5 rounded-lg text-sm font-normal"
                    style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                  />
                </label>
                <label className="text-xs font-bold text-[var(--color-text-secondary)]">
                  GPU Instance ID (Novita)
                  <input
                    value={c.vast_instance_id}
                    onChange={(e) => update(c.id, { vast_instance_id: e.target.value })}
                    placeholder="40601765"
                    className="mt-1 w-full px-3 py-2.5 rounded-lg text-sm font-normal"
                    style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                  />
                </label>
              </div>
              <div className="mt-3">
                <label className="text-xs font-bold text-[var(--color-text-secondary)]">
                  Notes
                  <input
                    value={c.notes}
                    onChange={(e) => update(c.id, { notes: e.target.value })}
                    placeholder="GPU region, provisioning date…"
                    className="mt-1 w-full px-3 py-2.5 rounded-lg text-sm font-normal"
                    style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                  />
                </label>
              </div>
              {c.provision_status && (
                <p className="mt-3 text-xs font-mono px-3 py-2 rounded-lg"
                  style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.25)", color: "#93c5fd" }}>
                  Provision: {c.provision_status}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => save(c)}
                  disabled={savingId === c.id}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)" }}
                >
                  <Save className="w-4 h-4" />
                  {savingId === c.id ? "Working…" : "Save"}
                </button>
                <button
                  onClick={() => provision(c)}
                  disabled={savingId === c.id}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}
                >
                  ⚡ Auto-provision GPU
                </button>
                <button
                  onClick={() => checkReady(c)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold"
                  style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
                >
                  Check status
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
