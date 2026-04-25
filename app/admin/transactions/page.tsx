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
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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

const STATUS_PILL: Record<Status, string> = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  refunded: "bg-gray-50 text-gray-600 border-gray-200",
};

export default function AdminTransactions() {
  const [active, setActive] = useState<TxnType>("subscription");
  const [rows, setRows] = useState<Payment[]>([]);
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [start, setStart] = useState(monthStart.toISOString().slice(0, 10));
  const [end, setEnd] = useState(today.toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);

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
    setRows((data as Payment[]) || []);
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
      await fetch("/api/admin/payments/resend-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_id: p.id }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
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
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
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
                const customer =
                  signup.name || signup.email || (p.user_id ? p.user_id.slice(0, 8) : "—");
                const customerEmail = signup.email || "";
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
                    <td className="px-4 py-3">
                      <div className="font-semibold">{customer}</div>
                      {customerEmail && (
                        <div className="text-xs text-[var(--color-text-muted)]">
                          {customerEmail}
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
                      <div className="inline-flex items-center gap-1.5">
                        {p.chip_purchase_id && p.status !== "paid" && (
                          <button
                            disabled={busy === p.id}
                            onClick={() => recheck(p)}
                            title="Recheck status with Chip"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-[var(--color-border)] hover:border-orange-300 text-xs font-semibold disabled:opacity-50"
                          >
                            {busy === p.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <RefreshCw className="w-3 h-3" />
                            )}
                            Recheck
                          </button>
                        )}
                        {isSignup && p.status === "paid" && (
                          <button
                            disabled={busy === p.id}
                            onClick={() => resendWA(p)}
                            title={waSent ? "Resend login info via WhatsApp" : "Send login info via WhatsApp"}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold disabled:opacity-50 border ${
                              waSent
                                ? "bg-white border-[var(--color-border)] hover:border-emerald-300"
                                : "bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600"
                            }`}
                          >
                            {busy === p.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <MessageCircle className="w-3 h-3" />
                            )}
                            {waSent ? "Resend WA" : "Send WA"}
                          </button>
                        )}
                        {p.chip_checkout_url && (
                          <a
                            href={p.chip_checkout_url}
                            target="_blank"
                            rel="noreferrer"
                            title="Open Chip checkout"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-[var(--color-border)] text-xs font-semibold hover:border-orange-300"
                          >
                            <FileText className="w-3 h-3" />
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
