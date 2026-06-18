"use client";

// Self-contained admin card for Livehost "Template Body" (Kling v3
// motion-control). Configures the cascade keys (main → fallback), the flat
// per-generation rate, and the default quality. Loads + saves independently
// of the main settings form (own fetches) to stay decoupled.

import { useEffect, useState } from "react";
import { Clapperboard, Loader2, Save } from "lucide-react";

export default function KlingSettings() {
  const [mainKey, setMainKey] = useState("");
  const [fallback, setFallback] = useState("");
  const [rate, setRate] = useState("");
  const [mode, setMode] = useState<"std" | "pro">("pro");
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const rows = d?.rows || [];
        const get = (k: string) => rows.find((x: any) => x.key === k)?.value;
        setMainKey(get("kling_main_key")?.key || "");
        setFallback(get("kling_fallback_keys")?.keys || "");
        const rt = get("kling_rate")?.rate;
        setRate(rt != null ? String(rt) : "");
        setMode(get("kling_default_mode")?.mode === "std" ? "std" : "pro");
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const put = (key: string, value: any) =>
        fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
      const rnum = Number(rate);
      await Promise.all([
        put("kling_main_key", { key: mainKey.trim() }),
        put("kling_fallback_keys", { keys: fallback.trim() }),
        put("kling_rate", { rate: Number.isFinite(rnum) && rnum >= 0 ? rnum : 2.0 }),
        put("kling_default_mode", { mode }),
      ]);
      setMsg("✓ Kling settings saved.");
      setTimeout(() => setMsg(null), 5000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl p-4 border">
      <div className="flex items-center gap-2 mb-1">
        <Clapperboard className="w-4 h-4 text-pink-500" />
        <h3 className="font-bold text-sm">Kling — Template Body (motion-control)</h3>
      </div>
      <p className="text-xs text-[var(--color-text-muted)] mb-4">
        Main key → cascade fallback(s). Leave blank to inherit the Crun (P2) A / B keys. Tasks settle event-driven on the client.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-1.5">
            Main Crun key (kling_main_key)
          </label>
          <input value={mainKey} onChange={(e) => setMainKey(e.target.value)} className="input"
            placeholder="blank = inherit p2_key" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-1.5">
            Fallback keys (kling_fallback_keys) — comma / newline separated
          </label>
          <textarea value={fallback} onChange={(e) => setFallback(e.target.value)} className="input min-h-[64px]"
            placeholder="blank = inherit p2_key_b" />
        </div>
        <div>
          <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-1.5">
            Rate (RM / generation)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--color-text-muted)]">RM</span>
            <input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className="input !pl-10" placeholder="2.00" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-1.5">
            Default quality
          </label>
          <select value={mode} onChange={(e) => setMode(e.target.value as "std" | "pro")} className="input">
            <option value="pro">Pro (1080p)</option>
            <option value="std">Std (720p)</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-5">
        <button type="button" onClick={() => void save()} disabled={saving}
          className="px-5 py-2 rounded-lg bg-violet-600 text-white font-bold text-sm hover:bg-violet-700 disabled:opacity-50 flex items-center gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          <Save className="w-4 h-4" /> Save Kling
        </button>
        {msg && <span className="text-xs text-emerald-700 font-semibold">{msg}</span>}
      </div>
    </div>
  );
}
