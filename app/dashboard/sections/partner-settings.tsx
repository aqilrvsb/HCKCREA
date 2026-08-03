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

export default function PartnerSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Ticked = visible to clients. Default (no config yet) = ALL ticked.
  const [checked, setChecked] = useState<Set<string>>(new Set(PARTNER_TABS.map((t) => t.key)));

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/partner/config", { cache: "no-store" });
        const d = await r.json().catch(() => null);
        if (r.ok && d?.ok) {
          const vt = d.config?.visible_tabs;
          if (Array.isArray(vt) && vt.length > 0) setChecked(new Set(vt));
          // else keep the all-ticked default (no restriction configured yet)
        }
      } catch { /* keep default */ } finally { setLoading(false); }
    })();
  }, []);

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
    </div>
  );
}
