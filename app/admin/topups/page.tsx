"use client";

import { useEffect, useState } from "react";
import { Loader2, Check, X, Wallet, ExternalLink, RefreshCw } from "lucide-react";

type Topup = {
  id: string;
  email: string;
  name: string;
  credits: number;
  amount: number;
  status: string;
  proof_url: string;
  created_at: string;
  paid_at: string | null;
};

export default function TopupApprovalsPage() {
  const [tab, setTab] = useState<"pending" | "paid" | "failed">("pending");
  const [rows, setRows] = useState<Topup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/topups?status=${tab}`, { cache: "no-store" });
      const d = await r.json();
      setRows(d?.rows || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [tab]);

  async function decide(id: string, action: "approve" | "reject") {
    if (action === "approve" && !confirm("Approve this top-up and credit the wallet?")) return;
    if (action === "reject" && !confirm("Reject this top-up? No credits will be added.")) return;
    setBusy(id);
    try {
      const r = await fetch("/api/admin/topups/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_id: id, action }),
      });
      const d = await r.json();
      if (!r.ok) { alert(d?.error || "Failed"); return; }
      setRows((prev) => prev.filter((x) => x.id !== id));
    } catch (e: any) {
      alert(e?.message || "Network error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)" }}>
          <Wallet className="w-5 h-5" style={{ color: "#fbbf24" }} />
        </div>
        <div>
          <h1 className="font-display font-extrabold text-2xl tracking-tight text-[var(--color-text-primary)]">Top-up Approvals</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">Manual Touch &apos;n Go transfers — review the screenshot, then approve to credit the wallet.</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-5">
        {(["pending", "paid", "failed"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider transition"
            style={tab === t
              ? { background: "linear-gradient(135deg,#f59e0b,#ea580c)", color: "#fff" }
              : { background: "var(--color-bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
          >
            {t}
          </button>
        ))}
        <button onClick={() => void load()} className="ml-auto p-2 rounded-lg" style={{ border: "1px solid var(--color-border)" }} title="Refresh">
          <RefreshCw className="w-4 h-4 text-[var(--color-text-muted)]" />
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-[var(--color-text-muted)]">
          <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-[var(--color-text-muted)]">Tiada {tab} top-up.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rows.map((r) => (
            <div key={r.id} className="rounded-2xl overflow-hidden" style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}>
              <button
                onClick={() => r.proof_url && setZoom(r.proof_url)}
                className="block w-full aspect-[4/3] bg-black/40 relative group"
              >
                {r.proof_url ? (
                  <img src={r.proof_url} alt="proof" className="w-full h-full object-contain" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-[var(--color-text-muted)]">Tiada screenshot</div>
                )}
                {r.proof_url && (
                  <span className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition bg-black/60 text-white rounded-md p-1">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </span>
                )}
              </button>
              <div className="p-4">
                <div className="flex items-baseline justify-between mb-1">
                  <div className="font-display font-extrabold text-2xl text-[var(--color-text-primary)]">RM{r.amount.toFixed(0)}</div>
                  <div className="text-xs font-bold text-amber-500">{r.credits} credits</div>
                </div>
                <div className="text-[12px] text-[var(--color-text-primary)] font-semibold truncate">{r.name || "—"}</div>
                <div className="text-[11px] text-[var(--color-text-muted)] truncate mb-3">{r.email}</div>
                <div className="text-[10px] text-[var(--color-text-muted)] mb-3">
                  {new Date(r.created_at).toLocaleString("ms-MY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </div>
                {tab === "pending" ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => decide(r.id, "approve")}
                      disabled={busy === r.id}
                      className="flex-1 py-2 rounded-xl text-xs font-extrabold text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg,#16a34a,#15803d)" }}
                    >
                      {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Approve
                    </button>
                    <button
                      onClick={() => decide(r.id, "reject")}
                      disabled={busy === r.id}
                      className="flex-1 py-2 rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                      style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)", color: "#ef4444" }}
                    >
                      <X className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                ) : (
                  <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: tab === "paid" ? "#16a34a" : "#ef4444" }}>
                    {tab === "paid" ? "✓ Approved" : "✗ Rejected"}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {zoom && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.85)" }} onClick={() => setZoom(null)}>
          <img src={zoom} alt="proof" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
}
