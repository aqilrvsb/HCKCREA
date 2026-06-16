"use client";

// Livehost global settings (moved out of /admin/livehost): client price rates
// + the AI chat-model cascade. Self-contained — talks to /api/admin/livehost.

import { useCallback, useEffect, useState } from "react";
import { Radio, Save } from "lucide-react";

export default function LivehostSettings() {
  const [gpuRate, setGpuRate] = useState("6.00");
  const [voiceRate, setVoiceRate] = useState("0.30");
  const [audioRate, setAudioRate] = useState("0.10");
  const [minBalance, setMinBalance] = useState("5.00");
  const [savingRates, setSavingRates] = useState(false);
  const [llmMainProvider, setLlmMainProvider] = useState("grsai");
  const [llmMainModel, setLlmMainModel] = useState("gemini-3.1-flash-lite");
  const [llmFbProvider, setLlmFbProvider] = useState("openrouter");
  const [llmFbModel, setLlmFbModel] = useState("openai/gpt-4.1");
  const [savingLlm, setSavingLlm] = useState(false);
  const [extVersion, setExtVersion] = useState("1.0.0");
  const [extUrl, setExtUrl] = useState("");
  const [savingExt, setSavingExt] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/livehost");
      const d = await r.json();
      if (d.rates) {
        setGpuRate(String(d.rates.gpuRateHour));
        setVoiceRate(String(d.rates.voiceRate1k));
        if (d.rates.audioRateGen != null) setAudioRate(String(d.rates.audioRateGen));
        if (d.rates.minBalance != null) setMinBalance(String(d.rates.minBalance));
      }
      if (d.llm) {
        setLlmMainProvider(d.llm.main?.provider || "grsai");
        setLlmMainModel(d.llm.main?.model || "");
        setLlmFbProvider(d.llm.fallback?.provider || "openrouter");
        setLlmFbModel(d.llm.fallback?.model || "");
      }
      if (d.ext) { setExtVersion(String(d.ext.version || "1.0.0")); setExtUrl(String(d.ext.downloadUrl || "")); }
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveRates = async () => {
    setSavingRates(true); setMsg("");
    try {
      const r = await fetch("/api/admin/livehost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rates: { gpuRateHour: gpuRate, voiceRate1k: voiceRate, audioRateGen: audioRate, minBalance } }),
      });
      const d = await r.json();
      setMsg(d.ok ? "Rates saved" : d.error || "Save failed");
    } finally { setSavingRates(false); }
  };

  const saveLlm = async () => {
    setSavingLlm(true); setMsg("");
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
      setMsg(d.ok ? "AI model saved" : d.error || "Save failed");
    } finally { setSavingLlm(false); }
  };

  const saveExt = async () => {
    setSavingExt(true); setMsg("");
    try {
      const r = await fetch("/api/admin/livehost", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ext: { version: extVersion, downloadUrl: extUrl } }),
      });
      const d = await r.json();
      setMsg(d.ok ? "Extension settings saved" : d.error || "Save failed");
    } finally { setSavingExt(false); }
  };

  const inputStyle = {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    color: "var(--color-text-primary)",
  } as const;

  return (
    <div className="rounded-2xl p-5 mb-6"
      style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}>
      <div className="flex items-center gap-2 mb-1">
        <Radio className="w-5 h-5" style={{ color: "#60a5fa" }} />
        <h2 className="font-display font-extrabold text-lg">Livehost</h2>
      </div>

      {msg && (
        <div className="my-3 px-4 py-2 rounded-lg text-sm font-bold"
          style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", color: "#4ade80" }}>
          {msg}
        </div>
      )}

      {/* rates */}
      <h3 className="font-bold text-sm mt-4 mb-1">Client price rates (RM)</h3>
      <p className="text-xs text-[var(--color-text-muted)] mb-3">
        Kos anda: GPU ~RM1.65/jam (Novita $0.35), voice ~RM0.14/1k chars — set lebih tinggi untuk margin.
      </p>
      <div className="grid md:grid-cols-3 gap-3 items-end">
        <label className="text-xs font-bold text-[var(--color-text-secondary)]">
          GPU — RM per streaming hour
          <input value={gpuRate} onChange={(e) => setGpuRate(e.target.value)} type="number" step="0.10" min="0"
            className="mt-1 w-full px-3 py-2.5 rounded-lg text-sm font-normal" style={inputStyle} />
        </label>
        <label className="text-xs font-bold text-[var(--color-text-secondary)]">
          Voice — RM per 1,000 characters
          <input value={voiceRate} onChange={(e) => setVoiceRate(e.target.value)} type="number" step="0.01" min="0"
            className="mt-1 w-full px-3 py-2.5 rounded-lg text-sm font-normal" style={inputStyle} />
        </label>
        <label className="text-xs font-bold text-[var(--color-text-secondary)]">
          Audio Script — RM per generate
          <input value={audioRate} onChange={(e) => setAudioRate(e.target.value)} type="number" step="0.01" min="0"
            className="mt-1 w-full px-3 py-2.5 rounded-lg text-sm font-normal" style={inputStyle} />
        </label>
        <label className="text-xs font-bold text-[var(--color-text-secondary)]">
          Min balance threshold — RM (auto-stop)
          <input value={minBalance} onChange={(e) => setMinBalance(e.target.value)} type="number" step="0.50" min="0"
            className="mt-1 w-full px-3 py-2.5 rounded-lg text-sm font-normal" style={inputStyle} />
        </label>
        <button onClick={saveRates} disabled={savingRates}
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)" }}>
          <Save className="w-4 h-4" /> {savingRates ? "Saving…" : "Save rates"}
        </button>
      </div>

      {/* AI model */}
      <h3 className="font-bold text-sm mt-6 mb-1">AI Livehost — chat model</h3>
      <p className="text-xs text-[var(--color-text-muted)] mb-3">
        Model yang jawab customer chat (guna Product Knowledge). Main dicuba dulu; kalau gagal, fallback.
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
              className="flex-1 px-3 py-2.5 rounded-lg text-sm" style={inputStyle} />
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
              className="flex-1 px-3 py-2.5 rounded-lg text-sm" style={inputStyle} />
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

      {/* Livehost Chrome extension version + download */}
      <h3 className="font-bold text-sm mt-6 mb-1">Livehost Extension (Chrome)</h3>
      <p className="text-xs text-[var(--color-text-muted)] mb-3">
        Naikkan versi bila ship build baru. Client versi lama akan nampak prompt update.
      </p>
      <div className="grid md:grid-cols-2 gap-3 items-end">
        <label className="text-xs font-bold text-[var(--color-text-secondary)]">
          Extension version
          <input value={extVersion} onChange={(e) => setExtVersion(e.target.value)}
            className="mt-1 w-full px-3 py-2.5 rounded-lg text-sm font-normal" style={inputStyle} />
        </label>
        <label className="text-xs font-bold text-[var(--color-text-secondary)]">
          Download URL (Google Drive / zip)
          <input value={extUrl} onChange={(e) => setExtUrl(e.target.value)} placeholder="https://drive.google.com/..."
            className="mt-1 w-full px-3 py-2.5 rounded-lg text-sm font-normal" style={inputStyle} />
        </label>
      </div>
      <button onClick={saveExt} disabled={savingExt}
        className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
        style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)" }}>
        <Save className="w-4 h-4" /> {savingExt ? "Saving…" : "Save extension settings"}
      </button>
    </div>
  );
}
