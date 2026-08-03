"use client";

// Partner Settings — the console a PARTNER manager (e.g. HQNL) uses to control
// what its clients get. Phase 2: which project tabs the clients may see.
// (Phase 3 will add a per-model pricing card below, floored at the admin base.)
//
// Reads/writes /api/partner/config, which is gated to a partner manager and
// stores the config in app_settings under the partner's key.

import { useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";
import { PARTNER_TABS } from "@/lib/partners";

// Per-model rate display metadata (label + unit). Units mirror priceFor:
// image models = per image; veo = per 8s; grok/seedance/sora2 = per second;
// gemini = per 10s.
const RATE_META: { key: string; label: string; unit: string }[] = [
  { key: "banana_pro", label: "Nano Banana Pro (image)", unit: "/ gambar" },
  { key: "gpt_image", label: "GPT Image (image)", unit: "/ gambar" },
  { key: "veo", label: "Veo (video)", unit: "/ 8s" },
  { key: "grok", label: "Grok Imagine (video)", unit: "/ saat" },
  { key: "seedance", label: "Seedance (video)", unit: "/ saat" },
  { key: "sora2", label: "Sora 2 (video)", unit: "/ saat" },
  { key: "gemini", label: "GeminiOmni (video)", unit: "/ 10s" },
];

export default function PartnerSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Ticked = visible to clients. Default (no config yet) = ALL ticked.
  const [checked, setChecked] = useState<Set<string>>(new Set(PARTNER_TABS.map((t) => t.key)));
  // Pricing: the admin base (floor) per model + the partner's override inputs.
  const [baseRates, setBaseRates] = useState<Record<string, number>>({});
  const [rateInputs, setRateInputs] = useState<Record<string, string>>({});
  const [savingRates, setSavingRates] = useState(false);
  const [rateMsg, setRateMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/partner/config", { cache: "no-store" });
        const d = await r.json().catch(() => null);
        if (r.ok && d?.ok) {
          const vt = d.config?.visible_tabs;
          if (Array.isArray(vt) && vt.length > 0) setChecked(new Set(vt));
          // else keep the all-ticked default (no restriction configured yet)
          if (d.baseRates && typeof d.baseRates === "object") setBaseRates(d.baseRates);
          const rr = d.config?.rates || {};
          const inputs: Record<string, string> = {};
          for (const m of RATE_META) inputs[m.key] = rr[m.key] != null ? String(rr[m.key]) : "";
          setRateInputs(inputs);
        }
      } catch { /* keep default */ } finally { setLoading(false); }
    })();
  }, []);

  async function saveRates() {
    // Client-side floor check (server clamps too).
    for (const m of RATE_META) {
      const v = rateInputs[m.key];
      if (v === "" || v == null) continue;
      const n = Number(v);
      const floor = Number(baseRates[m.key] || 0);
      if (!Number.isFinite(n) || n <= 0) { setRateMsg({ ok: false, text: `${m.label}: harga tak sah.` }); return; }
      if (floor > 0 && n < floor) { setRateMsg({ ok: false, text: `${m.label}: tak boleh kurang dari harga asas RM${floor}.` }); return; }
    }
    setSavingRates(true); setRateMsg(null);
    try {
      const rates: Record<string, number | null> = {};
      for (const m of RATE_META) {
        const v = rateInputs[m.key];
        rates[m.key] = v === "" || v == null ? null : Number(v); // null = clear (use base)
      }
      const r = await fetch("/api/partner/config", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rates }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) { setRateMsg({ ok: false, text: d?.error || "Gagal simpan." }); return; }
      // Reflect the server-clamped values back into the inputs.
      const rr = d.config?.rates || {};
      const inputs: Record<string, string> = {};
      for (const m of RATE_META) inputs[m.key] = rr[m.key] != null ? String(rr[m.key]) : "";
      setRateInputs(inputs);
      setRateMsg({ ok: true, text: "Harga client dah dikemaskini." });
    } catch (e: any) {
      setRateMsg({ ok: false, text: e?.message || "Gagal simpan." });
    } finally { setSavingRates(false); }
  }

  const toggle = (key: string) =>
    setChecked((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  async function save() {
    if (checked.size === 0) { setMsg({ ok: false, text: "Pilih sekurang-kurangnya 1 tab." }); return; }
    setSaving(true); setMsg(null);
    try {
      const visible_tabs = PARTNER_TABS.map((t) => t.key).filter((k) => checked.has(k));
      const r = await fetch("/api/partner/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visible_tabs }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) { setMsg({ ok: false, text: d?.error || "Gagal simpan." }); return; }
      setMsg({ ok: true, text: "Tab client dah dikemaskini." });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "Gagal simpan." });
    } finally { setSaving(false); }
  }

  if (loading) return <div className="py-10 text-center text-sm text-white/40">Memuatkan…</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="mb-1 text-sm font-semibold text-white">Tab yang client nampak</div>
        <p className="mb-3 text-[11px] text-white/45">
          Tick tab yang anda nak client anda boleh guna. Yang tak ditick akan tersembunyi dari
          sidebar &amp; body mereka. (Billing sentiasa tersembunyi untuk client anda.)
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PARTNER_TABS.map((t) => {
            const on = checked.has(t.key);
            return (
              <button key={t.key} onClick={() => toggle(t.key)}
                className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors"
                style={{
                  borderColor: on ? "rgba(16,185,129,0.4)" : "rgba(255,255,255,0.1)",
                  background: on ? "rgba(16,185,129,0.10)" : "rgba(255,255,255,0.03)",
                }}>
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded"
                  style={{ background: on ? "#10b981" : "transparent", border: on ? "none" : "1px solid rgba(255,255,255,0.25)" }}>
                  {on && <Check className="h-3.5 w-3.5 text-black" strokeWidth={3} />}
                </span>
                <span className={`text-sm font-medium ${on ? "text-white" : "text-white/50"}`}>{t.label}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button onClick={() => void save()} disabled={saving || checked.size === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Simpan
          </button>
          {msg && <span className={`text-xs ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>{msg.text}</span>}
          <span className="ml-auto text-[11px] text-white/35">{checked.size}/{PARTNER_TABS.length} tab dibenarkan</span>
        </div>
      </div>

      {/* Pricing card — per-model rate for THIS partner's clients. Floored at the
          admin base (shown as "min"): a partner can mark UP, never undercut. */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="mb-1 text-sm font-semibold text-white">Harga per-model (client anda)</div>
        <p className="mb-3 text-[11px] text-white/45">
          Set harga yang client anda bayar per generation. <b>Tak boleh kurang</b> dari harga asas admin
          (ditunjuk sebagai <i>min</i>). Kosongkan untuk guna harga asas. Beza antara harga anda &amp; asas = margin anda.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {RATE_META.map((m) => {
            const floor = Number(baseRates[m.key] || 0);
            const val = rateInputs[m.key] ?? "";
            const below = val !== "" && floor > 0 && Number(val) < floor;
            return (
              <div key={m.key} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2.5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-white">{m.label}</span>
                  <span className="text-[10px] text-white/40">min RM{floor || "—"} {m.unit}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-white/60">RM</span>
                  <input type="number" inputMode="decimal" step="0.01" min={floor || 0}
                    value={val}
                    onChange={(e) => setRateInputs((s) => ({ ...s, [m.key]: e.target.value.replace(/[^\d.]/g, "") }))}
                    placeholder={floor ? String(floor) : "0.00"}
                    className="w-full rounded-md border bg-black/40 px-2 py-1.5 text-sm text-white outline-none"
                    style={{ borderColor: below ? "#f43f5e" : "rgba(255,255,255,0.1)" }} />
                  <span className="whitespace-nowrap text-[10px] text-white/40">{m.unit}</span>
                </div>
                {below && <div className="mt-1 text-[10px] text-rose-400">Bawah harga asas — akan dinaikkan ke RM{floor} bila simpan.</div>}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={() => void saveRates()} disabled={savingRates}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-60">
            {savingRates ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Simpan harga
          </button>
          {rateMsg && <span className={`text-xs ${rateMsg.ok ? "text-emerald-300" : "text-rose-300"}`}>{rateMsg.text}</span>}
        </div>
      </div>
    </div>
  );
}
