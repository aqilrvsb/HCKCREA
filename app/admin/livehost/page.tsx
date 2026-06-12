"use client";

// Admin → Livehost: configure each Livehost client's streaming backend.
// Per client only TWO fields matter: backend_url (their GPU tunnel URL) and
// vast_instance_id (their dedicated GPU). The global vast_api_key lives in
// app_settings (key: vast_api_key).

import { useCallback, useEffect, useState } from "react";
import { Radio, Save, RefreshCw } from "lucide-react";

type Client = {
  id: string;
  email: string;
  name: string;
  plan: string;
  plan_expires_at: string | null;
  backend_url: string;
  vast_instance_id: string;
  notes: string;
};

export default function AdminLivehostPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/livehost");
      const d = await r.json();
      setClients(d.clients || []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const update = (id: string, patch: Partial<Client>) =>
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

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
            Per client: GPU tunnel URL + Vast instance ID. Global Vast API key is in
            app_settings (<code>vast_api_key</code>).
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
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="font-bold">{c.email}</span>
                {c.name && <span className="text-sm text-[var(--color-text-muted)]">({c.name})</span>}
                <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                  style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa" }}>
                  {c.plan}
                </span>
                {c.plan_expires_at && (
                  <span className="text-xs text-[var(--color-text-muted)]">
                    expires {new Date(c.plan_expires_at).toLocaleDateString("ms-MY")}
                  </span>
                )}
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
                  Vast Instance ID
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
              <button
                onClick={() => save(c)}
                disabled={savingId === c.id}
                className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)" }}
              >
                <Save className="w-4 h-4" />
                {savingId === c.id ? "Saving…" : "Save"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
