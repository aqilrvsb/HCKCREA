"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ShoppingCart,
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
  RefreshCw,
  Loader2,
  MessageCircle,
  FileText,
  Receipt,
  Phone,
  Mail,
  Send,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { localDateStr, startOfMonthLocal } from "@/lib/date-util";

type TxnType = "subscription" | "topup";
type Status = "pending" | "paid" | "failed" | "refunded";

type Payment = {
  id: string;
  user_id: string | null;
  type: string;
  plan: string | null;
  credits: number | null;
  amount: number;
  status: Status;
  chip_purchase_id: string | null;
  chip_checkout_url: string | null;
  paid_at: string | null;
  metadata: any;
  created_at: string;
};

type Profile = {
  id: string;
  full_name: string | null;
  whatsapp: string | null;
  email?: string | null;
};

// Normalise to wa.me-compatible (digits only, no plus, with Malaysia 60 prefix
// when the number starts with a leading 0). e.g. "012-345 6789" → "60123456789".
function waNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  let n = String(raw).replace(/\D/g, "");
  if (n.startsWith("0")) n = "60" + n.slice(1);
  if (n.startsWith("6") && !n.startsWith("60")) n = "60" + n.slice(1);
  return n;
}

function waFollowUpUrl(name: string, raw: string): string {
  const num = waNumber(raw);
  if (!num) return "";
  const greeting = name && name.trim() ? `Cik ${name.trim().split(/\s+/)[0]}` : "Cik";
  const msg = `Hi, ${greeting} — Saya dapati Cik ada masalah pembayaran PeningLab... Boleh tahu kenapa?`;
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
}

const STATUS_PILL: Record<Status, string> = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  refunded: "bg-gray-50 text-gray-600 border-gray-200",
};

export default function AdminTransactions() {
  const [active, setActive] = useState<TxnType>("subscription");
  const [rows, setRows] = useState<Payment[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  // Malaysia-local dates (UTC+8) — toISOString would off-by-one to UTC.
  // Default to TODAY (per user direction across all admin pages — every
  // date filter defaults to today, presets give quick jumps to other
  // ranges). Was month-to-date previously; admin can click Month preset
  // to restore that view.
  const [start, setStart] = useState(localDateStr());
  const [end, setEnd] = useState(localDateStr());
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [proofZoom, setProofZoom] = useState<string | null>(null);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, start, end]);

  async function load() {
    const sb = createClient();
    const types =
      active === "subscription"
        ? ["subscription", "checkout_signup"]
        : ["credit_topup"];
    let q = sb
      .from("payments")
      .select("*")
      .in("type", types)
      .gte("created_at", start + "T00:00:00")
      .lte("created_at", end + "T23:59:59")
      .order("created_at", { ascending: false })
      .limit(500);
    const { data } = await q;
    const list = (data as Payment[]) || [];
    setRows(list);

    // Fill in name + whatsapp from profiles for non-signup payments
    // (signup metadata already has them). Single batched query keyed by id.
    const userIds = Array.from(
      new Set(list.map((p) => p.user_id).filter(Boolean) as string[])
    );
    if (userIds.length > 0) {
      const { data: profs } = await sb
        .from("profiles")
        .select("id, full_name, whatsapp")
        .in("id", userIds);
      const map: Record<string, Profile> = {};
      (profs || []).forEach((p: any) => {
        map[p.id] = p;
      });
      setProfiles(map);
    }
  }

  const filtered = useMemo(() => {
    if (statusFilter === "all") return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  const stats = useMemo(() => {
    const paid = filtered.filter((r) => r.status === "paid");
    return {
      total: filtered.length,
      success: paid.length,
      failed: filtered.filter((r) => r.status === "failed").length,
      pending: filtered.filter((r) => r.status === "pending").length,
      revenue: paid.reduce((acc, r) => acc + Number(r.amount || 0), 0),
    };
  }, [filtered]);

  async function recheck(p: Payment) {
    if (!p.chip_purchase_id) return;
    setBusy(p.id);
    try {
      await fetch(
        `/api/payments/webhook?id=${encodeURIComponent(p.chip_purchase_id)}`,
        { cache: "no-store" }
      );
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function resendWA(p: Payment) {
    setBusy(p.id);
    try {
      const r = await fetch("/api/admin/payments/resend-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_id: p.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.sent) {
        alert("✅ WhatsApp dihantar — login info sudah dihantar ke customer.");
      } else {
        alert(`❌ Gagal hantar WhatsApp\n\n${d?.error || `HTTP ${r.status}`}`);
      }
      await load();
    } catch (e: any) {
      alert(`❌ Network error: ${e?.message || "unknown"}`);
    } finally {
      setBusy(null);
    }
  }

  // Manual Touch 'n Go decision — handles BOTH kinds: a credit_topup approve
  // credits the wallet; a subscription approve activates the plan + expiry +
  // plan credits. Reject marks it failed. Runs through the double-apply-safe
  // approve endpoint (/api/admin/topups/approve branches by payment type).
  async function approveTopup(p: Payment, action: "approve" | "reject") {
    const isSub = p.type === "subscription";
    const amt = Number(p.amount).toFixed(0);
    if (
      action === "approve" &&
      !confirm(
        isSub
          ? `Approve RM${amt} — activate ${String(p.plan || "plan").toUpperCase()} plan (+ ${p.credits ?? p.metadata?.credits ?? 0} credits) for this client?`
          : `Approve RM${amt} top-up and credit the wallet?`
      )
    )
      return;
    if (
      action === "reject" &&
      !confirm(isSub ? "Reject this subscription? Plan will NOT be activated." : "Reject this top-up? No credits added.")
    )
      return;
    setBusy(p.id);
    try {
      const r = await fetch("/api/admin/topups/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_id: p.id, action }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`❌ ${d?.error || `HTTP ${r.status}`}`); return; }
      await load();
    } catch (e: any) {
      alert(`❌ Network error: ${e?.message || "unknown"}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {proofZoom && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.85)" }} onClick={() => setProofZoom(null)}>
          <img src={proofZoom} alt="proof" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}
      <div className="mb-8">
        <h1 className="font-display font-extrabold text-3xl tracking-tight">
          Transaction Management
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          View and manage all payment transactions.
        </p>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2 p-1.5 bg-white border border-[var(--color-border)] rounded-2xl shadow-sm w-fit mb-6">
        {(
          [
            { k: "subscription", label: "Subscription" },
            { k: "topup", label: "Credit Top Up" },
          ] as { k: TxnType; label: string }[]
        ).map((t) => (
          <button
            key={t.k}
            onClick={() => setActive(t.k)}
            className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition ${
              active === t.k
                ? "bg-orange-50 text-orange"
                : "text-[var(--color-text-secondary)] hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {[
          { label: "Total", value: stats.total, icon: ShoppingCart, color: "text-blue-600" },
          { label: "Success", value: stats.success, icon: CheckCircle2, color: "text-emerald-600" },
          { label: "Failed", value: stats.failed, icon: XCircle, color: "text-red-600" },
          { label: "Pending", value: stats.pending, icon: Clock, color: "text-amber-600" },
          {
            label: "Revenue",
            value: `RM${stats.revenue.toFixed(2)}`,
            icon: DollarSign,
            color: "text-orange",
          },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={i} className="card p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold">
                  {s.label}
                </span>
                <Icon className={`w-4 h-4 ${s.color}`} />
              </div>
              <div className={`font-display font-extrabold text-3xl tracking-tight ${s.color}`}>
                {s.value}
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="card p-5 mb-5">
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-2">
              Start Date
            </label>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-2">
              End Date
            </label>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-2">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="input"
            >
              <option value="all">All Status</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="refunded">Refunded</option>
            </select>
          </div>
        </div>

        {/* Quick preset buttons — Today / Yesterday / 7d / Month —
            matches admin/usage and admin/errors for consistent UX
            across every date-filtered admin page. */}
        <div className="flex gap-2 mt-4">
          {[
            { label: "Today", days: 0 },
            { label: "Yesterday", days: -2 },
            { label: "7d", days: 6 },
            { label: "Month", days: -1 },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => {
                const today = localDateStr();
                if (p.days === -1) {
                  setStart(startOfMonthLocal());
                  setEnd(today);
                } else if (p.days === -2) {
                  const d = new Date();
                  d.setDate(d.getDate() - 1);
                  const y = localDateStr(d);
                  setStart(y);
                  setEnd(y);
                } else if (p.days === 0) {
                  setStart(today);
                  setEnd(today);
                } else {
                  const d = new Date();
                  d.setDate(d.getDate() - p.days);
                  setStart(localDateStr(d));
                  setEnd(today);
                }
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-transform hover:-translate-y-0.5"
              style={{
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold border-b border-[var(--color-border)] bg-gray-50/50">
                <th className="text-left px-4 py-3 w-10">No</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Customer</th>
                <th className="text-left px-4 py-3">Plan / Credit</th>
                <th className="text-right px-4 py-3">Amount</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-[var(--color-text-muted)]"
                  >
                    Tiada transaction dalam julat ini.
                  </td>
                </tr>
              )}
              {filtered.map((p, i) => {
                const meta = p.metadata || {};
                const signup = meta.signup || {};
                const profile = p.user_id ? profiles[p.user_id] : null;
                // Prefer the live profile (admin-editable source of truth) so
                // edits in /admin/clients show up here. Fall back to signup
                // metadata only when the profile field is empty (e.g. legacy
                // signups before profile.whatsapp was captured).
                const customerName =
                  profile?.full_name ||
                  signup.name ||
                  (p.user_id ? p.user_id.slice(0, 8) : "—");
                const customerEmail = profile?.email || signup.email || "";
                const customerWhatsapp = profile?.whatsapp || signup.whatsapp || "";
                const customerWaUrl = customerWhatsapp
                  ? `https://wa.me/${waNumber(customerWhatsapp)}`
                  : "";
                const isSignup = p.type === "checkout_signup";
                const waSent = !!meta.whatsapp_sent;
                return (
                  <tr
                    key={p.id}
                    className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-gray-50/40"
                  >
                    <td className="px-4 py-3 text-[var(--color-text-muted)] font-mono">
                      {i + 1}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)] font-mono text-xs">
                      {new Date(p.created_at).toLocaleString("ms-MY", {
                        day: "2-digit",
                        month: "short",
                        year: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-sm">{customerName}</div>
                      {customerEmail && (
                        <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] mt-0.5">
                          <Mail className="w-3 h-3 shrink-0" />
                          <span className="truncate">{customerEmail}</span>
                        </div>
                      )}
                      {customerWhatsapp && (
                        <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] mt-0.5">
                          <Phone className="w-3 h-3 shrink-0" />
                          {customerWaUrl ? (
                            <a
                              href={customerWaUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:text-orange hover:underline"
                            >
                              {customerWhatsapp}
                            </a>
                          ) : (
                            <span>{customerWhatsapp}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p.plan ? (
                        <span className="px-2 py-1 rounded-md bg-orange-50 border border-orange-100 text-orange text-xs font-bold uppercase">
                          {p.plan}
                        </span>
                      ) : p.credits ? (
                        <span className="text-[var(--color-text-secondary)]">
                          +{p.credits} credits
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-bold">
                      RM{Number(p.amount).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold ${STATUS_PILL[p.status]}`}
                      >
                        {p.status === "paid" && <CheckCircle2 className="w-3 h-3" />}
                        {p.status === "pending" && <Clock className="w-3 h-3" />}
                        {p.status === "failed" && <XCircle className="w-3 h-3" />}
                        {p.status === "refunded" && <RefreshCw className="w-3 h-3" />}
                        {p.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        {/* Invoice (PDF) — only for PAID transactions. Opens a clean
                            printable invoice the admin can Save-as-PDF + send to the client. */}
                        {p.status === "paid" && (
                          <a
                            href={`/invoice/${p.id}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Invois (lihat / muat turun PDF)"
                            aria-label="Invois"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white border border-[var(--color-border)] hover:border-amber-300 text-[var(--color-text-secondary)]"
                          >
                            <Receipt className="w-4 h-4" />
                          </a>
                        )}
                        {/* Recheck — for any non-paid txn with a Chip purchase id (covers pending + failed) */}
                        {p.chip_purchase_id && p.status !== "paid" && (
                          <button
                            disabled={busy === p.id}
                            onClick={() => recheck(p)}
                            title={p.status === "pending" ? "Check pending status with Chip" : "Recheck failed status"}
                            aria-label="Recheck"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100 disabled:opacity-50"
                          >
                            {busy === p.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : p.status === "pending" ? (
                              <CheckCircle2 className="w-4 h-4" />
                            ) : (
                              <RefreshCw className="w-4 h-4" />
                            )}
                          </button>
                        )}
                        {/* Send/Resend login WhatsApp — only on paid signup payments */}
                        {isSignup && p.status === "paid" && (
                          <button
                            disabled={busy === p.id}
                            onClick={() => resendWA(p)}
                            title={waSent ? "Resend login info via WhatsApp" : "Send login info via WhatsApp"}
                            aria-label="Send login WA"
                            className={`inline-flex items-center justify-center w-8 h-8 rounded-lg disabled:opacity-50 border ${
                              waSent
                                ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                                : "bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600"
                            }`}
                          >
                            {busy === p.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                          </button>
                        )}
                        {/* Follow-up WhatsApp — pre-filled BM message asking why payment failed/pending. */}
                        {customerWhatsapp && p.status !== "paid" && (
                          <a
                            href={waFollowUpUrl(customerName, customerWhatsapp)}
                            target="_blank"
                            rel="noreferrer"
                            title="WhatsApp follow-up to customer"
                            aria-label="WhatsApp follow-up"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500 text-white border border-emerald-500 hover:bg-emerald-600"
                          >
                            <MessageCircle className="w-4 h-4" />
                          </a>
                        )}
                        {/* Manual TnG top-up — view proof screenshot */}
                        {p.metadata?.method === "tng" && p.metadata?.proof_url && (
                          <button
                            onClick={() => setProofZoom(String(p.metadata.proof_url))}
                            title="View transfer screenshot"
                            aria-label="View proof"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white border border-[var(--color-border)] hover:border-amber-300 text-[var(--color-text-secondary)]"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                        )}
                        {/* Manual TnG top-up — approve (credit wallet) / reject */}
                        {p.metadata?.method === "tng" && p.status === "pending" && (
                          <>
                            <button
                              disabled={busy === p.id}
                              onClick={() => approveTopup(p, "approve")}
                              title="Approve — credit wallet"
                              aria-label="Approve top-up"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500 text-white border border-emerald-500 hover:bg-emerald-600 disabled:opacity-50"
                            >
                              {busy === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                            </button>
                            <button
                              disabled={busy === p.id}
                              onClick={() => approveTopup(p, "reject")}
                              title="Reject top-up"
                              aria-label="Reject top-up"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 disabled:opacity-50"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {/* Chip checkout link */}
                        {p.chip_checkout_url && (
                          <a
                            href={p.chip_checkout_url}
                            target="_blank"
                            rel="noreferrer"
                            title="Open Chip checkout"
                            aria-label="Open Chip"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white border border-[var(--color-border)] hover:border-orange-300 text-[var(--color-text-secondary)]"
                          >
                            <FileText className="w-4 h-4" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
