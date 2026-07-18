"use client";

import { useEffect, useState } from "react";
import { Wallet, Zap, ArrowRight, Receipt, Sparkles, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Livehost credit top-up — same RM1 = 1 credit packages and Chip flow as the
// generation product (app/dashboard/sections/credit.tsx), but with copy framed
// for Livehost (credits are spent on GPU live time + MiniMax voice, not
// image/video generation). Shown inside the Livehost billing view.

const PACKAGES = [
  { credits: 10, price: 10, label: "Top kecil" },
  { credits: 20, price: 20, label: "Standard" },
  { credits: 30, price: 30, label: "Common" },
  { credits: 50, price: 50, label: "Best value", popular: true },
  { credits: 100, price: 100, label: "Power host" },
];

type Topup = {
  id: string;
  credits?: number;
  amount: number;
  status: "pending" | "paid" | "failed" | "refunded";
  chip_purchase_id?: string;
  created_at: string;
};

export default function LivehostTopup({ credits }: { credits: number }) {
  const [selected, setSelected] = useState(50);
  const [custom, setCustom] = useState("");
  const [paying, setPaying] = useState(false);
  const [topups, setTopups] = useState<Topup[]>([]);
  const [tng, setTng] = useState<{ number: string; name: string; qr_url: string; configured: boolean } | null>(null);
  const [proofUrl, setProofUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showPay, setShowPay] = useState(false);

  const pick = PACKAGES.find((p) => p.credits === selected) || PACKAGES[0];

  // Manual amount (RM1 = 1 kredit) — overrides the tile when valid.
  const MIN_AMT = 1;
  const MAX_AMT = 1000;
  const customNum = Math.round(Number(custom));
  const customFilled = custom.trim() !== "";
  const customValid = customFilled && Number.isFinite(customNum) && customNum >= MIN_AMT && customNum <= MAX_AMT;
  const payCredits = customValid ? customNum : pick.credits;
  const customError = customFilled && !customValid;

  useEffect(() => {
    void loadTopups();
    void (async () => {
      try {
        const r = await fetch("/api/credit/tng-info", { cache: "no-store" });
        if (r.ok) setTng(await r.json());
      } catch { /* ignore */ }
    })();
  }, []);

  async function uploadProof(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/upload/image", { method: "POST", body: fd });
      const d = await r.json();
      if (r.ok && d?.url) setProofUrl(String(d.url));
      else alert(d?.error || "Upload gagal");
    } catch (e: any) {
      alert(e?.message || "Upload gagal");
    } finally {
      setUploading(false);
    }
  }

  async function submitTopup() {
    if (!proofUrl) { alert("Upload screenshot transfer dulu."); return; }
    setPaying(true);
    try {
      const res = await fetch("/api/credit/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credits: payCredits, proof_url: proofUrl }),
      });
      const data = await res.json();
      if (data?.ok) { setSubmitted(true); setProofUrl(""); void loadTopups(); }
      else alert(data?.error || "Gagal submit top-up");
    } catch (e: any) {
      alert(e?.message || "Network error");
    } finally {
      setPaying(false);
    }
  }

  async function loadTopups() {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return;
    const { data } = await sb
      .from("payments")
      .select("id,credits,amount,status,chip_purchase_id,created_at")
      .eq("user_id", user.id)
      .eq("type", "credit_topup")
      .order("created_at", { ascending: false })
      .limit(20);
    setTopups((data as Topup[]) || []);
  }

  return (
    <div className="space-y-6">
      {/* Balance hero */}
      <div
        className="relative overflow-hidden rounded-3xl p-8"
        style={{
          background:
            "linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(255,87,34,0.06) 100%)",
          border: "1px solid rgba(245,158,11,0.3)",
        }}
      >
        <div
          className="absolute"
          style={{
            top: -120,
            right: -120,
            width: 400,
            height: 400,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(245, 158, 11, 0.3), transparent 70%)",
            filter: "blur(50px)",
          }}
        />
        <div className="relative">
          <div
            className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-4 rounded-full text-xs font-bold uppercase tracking-wider"
            style={{
              background: "rgba(245,158,11,0.1)",
              border: "1px solid rgba(245,158,11,0.3)",
              color: "#fbbf24",
            }}
          >
            <Wallet className="w-3 h-3" />
            Baki kredit
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span
              className="font-display font-extrabold text-6xl md:text-7xl tracking-tight leading-none"
              style={{ color: "#fbbf24" }}
            >
              {credits.toFixed(2)}
            </span>
            <span className="font-semibold text-xl text-[var(--color-text-secondary)]">
              kredit
            </span>
          </div>
          <p className="text-base text-[var(--color-text-secondary)]">
            Kredit digunakan untuk masa GPU live + suara (MiniMax). Top up
            bila-bila, kredit tak hangus.
          </p>
        </div>
      </div>

      {/* Package selector */}
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-display font-extrabold text-2xl tracking-tight">
              Top up kredit
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
              RM1 = 1 kredit. No hidden fees.
            </p>
          </div>
          <div className="hidden md:flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)]">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            Touch 'n Go transfer
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          {PACKAGES.map((p) => {
            const isSelected = !customValid && selected === p.credits;
            return (
              <button
                key={p.credits}
                onClick={() => {
                  setSelected(p.credits);
                  setCustom("");
                }}
                className="relative rounded-2xl p-5 border-2 text-left transition-all"
                style={
                  isSelected
                    ? {
                        borderColor: "#fbbf24",
                        background:
                          "linear-gradient(135deg, rgba(245,158,11,0.1) 0%, rgba(255,87,34,0.06) 100%)",
                        boxShadow: "0 8px 24px rgba(245,158,11,0.2)",
                        transform: "scale(1.03)",
                      }
                    : {
                        borderColor: "var(--color-border)",
                        background: "var(--color-bg-card)",
                      }
                }
              >
                {p.popular && (
                  <div className="absolute -top-2 right-3 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-md">
                    Best
                  </div>
                )}
                <div className="font-display font-extrabold text-3xl tracking-tight mb-1">
                  {p.credits}
                </div>
                <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider font-semibold mb-2">
                  kredit
                </div>
                <div className="font-bold text-base">RM{p.price}</div>
                <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
                  {p.label}
                </div>
              </button>
            );
          })}
        </div>

        {/* Manual amount — enter any RM value instead of a tile */}
        <div className="mb-5">
          <label className="block text-xs uppercase tracking-wider font-bold text-[var(--color-text-muted)] mb-2">
            Atau masuk amount sendiri
          </label>
          <div
            className="flex items-center gap-2 rounded-2xl border-2 px-4 py-3 transition-all"
            style={{
              borderColor: customValid ? "#fbbf24" : customError ? "#ef4444" : "var(--color-border)",
              background: customValid
                ? "linear-gradient(135deg, rgba(245,158,11,0.1) 0%, rgba(255,87,34,0.06) 100%)"
                : "var(--color-bg-card)",
            }}
          >
            <span className="font-bold text-lg text-[var(--color-text-secondary)]">RM</span>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_AMT}
              max={MAX_AMT}
              step={1}
              value={custom}
              onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="cth. 75"
              className="flex-1 bg-transparent outline-none font-display font-extrabold text-2xl tracking-tight text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] placeholder:font-normal placeholder:text-lg"
            />
            {customValid && (
              <span className="text-sm font-semibold text-amber-500 whitespace-nowrap">
                = {customNum} kredit
              </span>
            )}
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: customError ? "#ef4444" : "var(--color-text-muted)" }}>
            {customError
              ? `Amount kena antara RM${MIN_AMT} dan RM${MAX_AMT}.`
              : `RM1 = 1 kredit. Min RM${MIN_AMT}, max RM${MAX_AMT}.`}
          </p>
        </div>

        {submitted ? (
          <div className="rounded-2xl p-5 text-center" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.35)" }}>
            <div className="font-display font-extrabold text-lg text-emerald-600 mb-1">✓ Permohonan dihantar!</div>
            <p className="text-sm text-[var(--color-text-secondary)]">Top-up <b>RM{payCredits}</b> menunggu approval admin. Balance masuk sebaik admin sahkan.</p>
            <button onClick={() => { setSubmitted(false); setShowPay(false); }} className="mt-3 text-xs font-bold text-amber-600 underline">Top up lagi</button>
          </div>
        ) : !showPay ? (
          <button
            onClick={() => setShowPay(true)}
            disabled={customError}
            className="w-full py-4 rounded-2xl font-bold text-base text-white shadow-xl shadow-amber-500/30 hover:scale-[1.01] transition-transform disabled:opacity-50 disabled:scale-100"
            style={{ background: "linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)" }}
          >
            <span className="flex items-center justify-center gap-2"><Zap className="w-5 h-5" /> Pay RM{payCredits} <ArrowRight className="w-4 h-4" /></span>
          </button>
        ) : (
          <>
            <div className="rounded-2xl p-4 mb-4" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
              <div className="text-xs uppercase tracking-wider font-bold text-[var(--color-text-muted)] mb-2">Langkah 1 — Transfer RM{payCredits} ke Touch &apos;n Go</div>
              {tng && tng.configured ? (
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-extrabold text-2xl text-[var(--color-text-primary)] tracking-tight break-all">{tng.number || "—"}</div>
                    {tng.name && <div className="text-sm text-[var(--color-text-secondary)] font-semibold">{tng.name}</div>}
                  </div>
                  {tng.qr_url && <img src={tng.qr_url} alt="TnG QR" className="w-28 h-28 object-contain rounded-lg bg-white border border-[var(--color-border)] flex-shrink-0" />}
                </div>
              ) : (
                <div className="text-sm text-[var(--color-text-muted)]">Admin belum set akaun Touch &apos;n Go. Sila hubungi admin.</div>
              )}
            </div>
            <div className="mb-4">
              <div className="text-xs uppercase tracking-wider font-bold text-[var(--color-text-muted)] mb-2">Langkah 2 — Upload screenshot transfer</div>
              <label className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl border-2 border-dashed cursor-pointer" style={{ borderColor: proofUrl ? "#16a34a" : "var(--color-border)", background: proofUrl ? "rgba(16,185,129,0.06)" : "var(--color-bg-card)" }}>
                {uploading ? (<><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>) : proofUrl ? (<span className="text-sm font-bold text-emerald-600">✓ Screenshot dimuat naik — tekan tukar</span>) : (<span className="text-sm font-semibold text-[var(--color-text-secondary)]">📷 Pilih screenshot resit</span>)}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadProof(f); }} />
              </label>
              {proofUrl && <img src={proofUrl} alt="proof" className="mt-2 max-h-40 rounded-lg border border-[var(--color-border)]" />}
            </div>
            <button onClick={submitTopup} disabled={paying || !proofUrl || !(tng && tng.configured)} className="w-full py-4 rounded-2xl font-bold text-base text-white shadow-xl shadow-amber-500/30 hover:scale-[1.01] transition-transform disabled:opacity-50 disabled:scale-100" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)" }}>
              <span className="flex items-center justify-center gap-2">{paying ? (<><Loader2 className="w-5 h-5 animate-spin" /> Menghantar…</>) : (<><Zap className="w-5 h-5" /> Submit top-up RM{payCredits}</>)}</span>
            </button>
            <button onClick={() => setShowPay(false)} className="w-full text-center text-xs text-[var(--color-text-muted)] mt-2 underline">← Tukar amount</button>
          </>
        )}
      </div>

      {/* Top up history */}
      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-5 border-b border-[var(--color-border)] flex items-center gap-2">
          <Receipt className="w-4 h-4 text-[var(--color-text-muted)]" />
          <h3 className="font-display font-bold text-lg">Top up history</h3>
        </div>
        {topups.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-[var(--color-text-secondary)] font-medium">
              Tiada top up history lagi.
            </p>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              Top up pertama kali, transaction akan muncul di sini.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {topups.map((t) => (
              <li
                key={t.id}
                className="px-6 py-4 flex flex-col md:flex-row md:items-center gap-3"
              >
                <span className="w-32 text-sm text-[var(--color-text-secondary)] font-mono">
                  {new Date(t.created_at).toLocaleDateString("ms-MY", {
                    day: "numeric",
                    month: "short",
                    year: "2-digit",
                  })}
                </span>
                <span className="flex-1 text-sm font-semibold">
                  +{t.credits} kredit
                </span>
                <span className="w-24 text-sm font-bold">
                  RM{Number(t.amount).toFixed(2)}
                </span>
                <div className="md:w-44 md:flex md:justify-end">
                  {(() => {
                    const st = t.status === "paid" ? { t: "✓ Approved", c: "#16a34a", b: "rgba(16,163,74,0.12)" }
                      : t.status === "failed" ? { t: "✗ Rejected", c: "#ef4444", b: "rgba(239,68,68,0.12)" }
                      : { t: "⏳ Pending approval", c: "#f59e0b", b: "rgba(245,158,11,0.12)" };
                    return <span className="text-[11px] font-bold px-3 py-1 rounded-full" style={{ color: st.c, background: st.b }}>{st.t}</span>;
                  })()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
