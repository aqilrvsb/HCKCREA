"use client";

import { useEffect, useState } from "react";
import { Loader2, Power, PowerOff } from "lucide-react";

// GPU ON/OFF — the client's dedicated always-on GPU (1 GPU = 1 client), shown in
// the Usage tab. Admin "appoints" the client; the client turns their GPU ON
// before a live and OFF after. While ON it's billed per hour at the admin rate;
// OFF charges the elapsed time and frees it to RM0. Always-on = no mid-stream
// disconnect.

type GpuState = {
  on: boolean;
  allowed: boolean;
  since: string | null;
  elapsedSec: number;
  rateHour: number;
  minBalance: number;
  estCharge: number;
  credits: number;
  booting?: boolean;
};

function fmtDur(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h}j ${String(m).padStart(2, "0")}m ${String(ss).padStart(2, "0")}s`;
}

export default function LivehostGpu() {
  const [g, setG] = useState<GpuState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [, setTick] = useState(0); // 1s clock so elapsed/charge count up between polls

  async function load() {
    try {
      const r = await fetch("/api/livehost/gpu", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "status" }),
      });
      setG(await r.json());
    } catch {}
  }
  useEffect(() => {
    void load();
    const poll = setInterval(load, 30000);
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, []);

  const liveElapsed = g?.on && g.since ? Math.max(0, (Date.now() - new Date(g.since).getTime()) / 1000) : 0;
  const liveCharge = g?.on ? (liveElapsed / 3600) * (g.rateHour || 0) : 0;

  async function toggle(on: boolean) {
    if (!on && g) {
      if (!confirm(`Tutup GPU sekarang? Anda akan dicaj RM ${liveCharge.toFixed(2)} untuk masa guna (${fmtDur(liveElapsed)}).`)) return;
    }
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/livehost/gpu", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: on ? "on" : "off" }),
      });
      const d = await r.json();
      if (!r.ok) setErr(d.error || "Gagal"); else await load();
    } catch (e: any) { setErr(e?.message || "Network error"); }
    finally { setBusy(false); }
  }

  const isOn = !!g?.on;
  const allowed = !!g?.allowed;

  // Not appointed by admin → can't use a GPU. Show a clear gated state.
  if (g && !allowed && !isOn) {
    return (
      <div className="rounded-3xl p-6 mb-6" style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-flex w-2.5 h-2.5 rounded-full" style={{ background: "#94a3b8" }} />
          <h3 className="font-display font-extrabold text-xl tracking-tight">GPU belum diberikan</h3>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Admin belum appoint GPU untuk akaun anda. Hubungi admin untuk dapatkan GPU dedikasi (1 GPU = 1 client).
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-3xl p-6 mb-6"
      style={{
        background: isOn
          ? "linear-gradient(135deg, rgba(34,197,94,0.10) 0%, rgba(16,185,129,0.06) 100%)"
          : "linear-gradient(135deg, rgba(148,163,184,0.08) 0%, rgba(100,116,139,0.05) 100%)",
        border: `1px solid ${isOn ? "rgba(34,197,94,0.35)" : "var(--color-border)"}`,
      }}
    >
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span
              className="inline-flex w-2.5 h-2.5 rounded-full"
              style={{ background: isOn ? "#22c55e" : "#94a3b8", boxShadow: isOn ? "0 0 10px #22c55e" : "none" }}
            />
            <h3 className="font-display font-extrabold text-xl tracking-tight">
              GPU {isOn ? "HIDUP" : "MATI"}
            </h3>
          </div>
          {g ? (
            isOn ? (
              <p className="text-sm text-[var(--color-text-secondary)]">
                Hidup <b>{fmtDur(liveElapsed)}</b> · caj setakat ini{" "}
                <b style={{ color: "#22c55e" }}>RM {liveCharge.toFixed(2)}</b>{" "}
                <span className="text-[var(--color-text-muted)]">(RM {g.rateHour.toFixed(2)}/jam)</span>
              </p>
            ) : (
              <p className="text-sm text-[var(--color-text-secondary)]">
                Hidupkan GPU sebelum live. Caj RM {g.rateHour.toFixed(2)}/jam, dikira bila tutup.
                Auto-tutup bila baki &lt; RM {g.minBalance.toFixed(2)}.
              </p>
            )
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">Memuatkan status GPU…</p>
          )}
          {err && <p className="text-sm font-bold mt-1" style={{ color: "#f87171" }}>{err}</p>}
        </div>

        <button
          onClick={() => toggle(!isOn)}
          disabled={busy || !g}
          className="flex items-center justify-center gap-2 px-6 py-3 rounded-2xl font-bold text-base text-white disabled:opacity-60 shrink-0"
          style={{ background: isOn ? "linear-gradient(135deg,#ef4444,#dc2626)" : "linear-gradient(135deg,#22c55e,#16a34a)" }}
        >
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : isOn ? <PowerOff className="w-5 h-5" /> : <Power className="w-5 h-5" />}
          {busy ? "Sekejap…" : isOn ? "Tutup GPU" : "Hidupkan GPU"}
        </button>
      </div>
      {isOn && g?.booting && (
        <p className="text-xs text-[var(--color-text-muted)] mt-3">✅ GPU hidup (always-on, tiada boot) — terus boleh tekan Start di studio. Tiada disconnect.</p>
      )}
    </div>
  );
}
