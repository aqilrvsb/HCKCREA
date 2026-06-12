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
  provision_status: string;
};

export default function AdminLivehostPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [msg, setMsg] = useState("");
  const [gpuRate, setGpuRate] = useState("6.00");
  const [voiceRate, setVoiceRate] = useState("0.30");
  const [savingRates, setSavingRates] = useState(false);
  const [llmMainProvider, setLlmMainProvider] = useState("grsai");
  const [llmMainModel, setLlmMainModel] = useState("gemini-3.1-flash-lite");
  const [llmFbProvider, setLlmFbProvider] = useState("openrouter");
  const [llmFbModel, setLlmFbModel] = useState("openai/gpt-4.1");
  const [savingLlm, setSavingLlm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/livehost");
      const d = await r.json();
      setClients(d.clients || []);
      if (d.rates) {
        setGpuRate(String(d.rates.gpuRateHour));
        setVoiceRate(String(d.rates.voiceRate1k));
      }
      if (d.llm) {
        setLlmMainProvider(d.llm.main?.provider || "grsai");
        setLlmMainModel(d.llm.main?.model || "");
        setLlmFbProvider(d.llm.fallback?.provider || "openrouter");
        setLlmFbModel(d.llm.fallback?.model || "");
      }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveRates = async () => {
    setSavingRates(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/livehost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rates: { gpuRateHour: gpuRate, voiceRate1k: voiceRate } }),
      });
      const d = await r.json();
      setMsg(d.ok ? "Rates saved — applies to all clients immediately" : d.error || "Save failed");
    } finally {
      setSavingRates(false);
    }
  };

  const saveLlm = async () => {
    setSavingLlm(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/livehost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          llm: {
            main: { provider: llmMainProvider, model: llmMainModel },
            fallback: { provider: llmFbProvider, model: llmFbModel },
          },
        }),
      });
      const d = await r.json();
      setMsg(d.ok ? "AI model saved — applies to the next chat answer" : d.error || "Save failed");
    } finally {
      setSavingLlm(false);
    }
  };

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

      {/* Global client-facing rates — what clients SEE & are billed in Usage */}
      <div className="rounded-2xl p-5 mb-6"
        style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}>
        <h2 className="font-display font-extrabold text-lg mb-1">Client price rates (RM)</h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">
          Used to calculate every client&apos;s Usage costs. Your cost: GPU ~RM1.65/hr (Novita $0.35),
          voice ~RM0.14/1k chars (MiniMax bills per character) — set rates above that for margin.
        </p>
        <div className="grid md:grid-cols-3 gap-3 items-end">
          <label className="text-xs font-bold text-[var(--color-text-secondary)]">
            GPU — RM per streaming hour
            <input value={gpuRate} onChange={(e) => setGpuRate(e.target.value)} type="number" step="0.10" min="0"
              className="mt-1 w-full px-3 py-2.5 rounded-lg text-sm font-normal"
              style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} />
          </label>
          <label className="text-xs font-bold text-[var(--color-text-secondary)]">
            Voice — RM per 1,000 characters
            <input value={voiceRate} onChange={(e) => setVoiceRate(e.target.value)} type="number" step="0.01" min="0"
              className="mt-1 w-full px-3 py-2.5 rounded-lg text-sm font-normal"
              style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} />
          </label>
          <button onClick={saveRates} disabled={savingRates}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)" }}>
            <Save className="w-4 h-4" /> {savingRates ? "Saving…" : "Save rates"}
          </button>
        </div>
      </div>

      {/* AI Livehost — chat-answer model cascade (reads Product Knowledge) */}
      <div className="rounded-2xl p-5 mb-6"
        style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}>
        <h2 className="font-display font-extrabold text-lg mb-1">AI Livehost — chat model</h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">
          Model yang jawab customer chat (guna Product Knowledge client). Main dicuba dulu;
          kalau gagal, fallback. Key provider diambil dari Settings (or_key / p4_key) — GPU box
          fetch config ini server-to-server, key tak sampai browser.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-bold mb-1 text-[var(--color-text-secondary)]">🍊 MAIN</div>
            <div className="flex gap-2">
              <select value={llmMainProvider} onChange={(e) => setLlmMainProvider(e.target.value)}
                className="px-3 py-2.5 rounded-lg text-sm font-bold"
                style={{ background: "var(--color-bg)", border: "1px solid rgba(34,197,94,0.4)", color: "#4ade80" }}>
                <option value="grsai">Grsai</option>
                <option value="openrouter">OpenRouter</option>
              </select>
              <input value={llmMainModel} onChange={(e) => setLlmMainModel(e.target.value)}
                placeholder="gemini-3.1-flash-lite"
                className="flex-1 px-3 py-2.5 rounded-lg text-sm"
                style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} />
            </div>
          </div>
          <div>
            <div className="text-xs font-bold mb-1 text-[var(--color-text-secondary)]">♻ FALLBACK (OPTIONAL)</div>
            <div className="flex gap-2">
              <select value={llmFbProvider} onChange={(e) => setLlmFbProvider(e.target.value)}
                className="px-3 py-2.5 rounded-lg text-sm font-bold"
                style={{ background: "var(--color-bg)", border: "1px solid rgba(139,92,246,0.4)", color: "#a78bfa" }}>
                <option value="openrouter">OpenRouter</option>
                <option value="grsai">Grsai</option>
              </select>
              <input value={llmFbModel} onChange={(e) => setLlmFbModel(e.target.value)}
                placeholder="openai/gpt-4.1"
                className="flex-1 px-3 py-2.5 rounded-lg text-sm"
                style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} />
            </div>
          </div>
        </div>
        <p className="text-xs mt-3 font-mono text-[var(--color-text-muted)]">
          Active cascade: <span style={{ color: "#4ade80" }}>{llmMainProvider}/{llmMainModel}</span>
          {llmFbModel ? <> → <span style={{ color: "#a78bfa" }}>{llmFbProvider}/{llmFbModel}</span></> : null}
        </p>
        <button onClick={saveLlm} disabled={savingLlm}
          className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)" }}>
          <Save className="w-4 h-4" /> {savingLlm ? "Saving…" : "Save AI model"}
        </button>
      </div>

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
