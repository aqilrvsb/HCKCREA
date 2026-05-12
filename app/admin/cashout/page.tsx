"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle, Banknote, Clock } from "lucide-react";

type Cashout = {
  id: string;
  user_id: string;
  amount: number;
  bank_name: string;
  bank_account_name: string;
  bank_account_number: string;
  status: "pending" | "approved" | "rejected" | "paid";
  admin_note: string | null;
  created_at: string;
  paid_at: string | null;
  user_full_name?: string | null;
  user_email?: string | null;
  user_whatsapp?: string | null;
};

type StatusFilter = "all" | "pending" | "approved" | "rejected" | "paid";

export default function AdminCashoutPage() {
  const [items, setItems] = useState<Cashout[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [filter]);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/cashout?status=${filter}`, {
        cache: "no-store",
      });
      const d = await r.json();
      setItems((d?.rows as Cashout[]) || []);
    } finally {
      setLoading(false);
    }
  }

  async function transition(
    row: Cashout,
    nextStatus: "approved" | "rejected" | "paid"
  ) {
    const noteLabel =
      nextStatus === "paid"
        ? "Transfer reference (e.g. Maybank ref #12345)"
        : "Admin note (optional)";
    const note = prompt(noteLabel) ?? "";
    if (nextStatus === "rejected" && !note.trim()) {
      alert("Rejection requires a reason in the admin note.");
      return;
    }
    setBusyId(row.id);
    try {
      const r = await fetch("/api/admin/cashout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          status: nextStatus,
          admin_note: note.trim() || null,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        alert(d?.error || "Update failed");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display font-extrabold text-3xl tracking-tight">
            Cashout Requests
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Approve, reject, or mark cashout requests as paid.
          </p>
        </div>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-[var(--color-bg-card)] mb-4 max-w-xl">
        {(
          [
            "pending",
            "approved",
            "paid",
            "rejected",
            "all",
          ] as StatusFilter[]
        ).map((s) => {
          const active = filter === s;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className="flex-1 py-2 rounded-lg text-xs font-bold capitalize transition"
              style={
                active
                  ? {
                      background: "var(--color-orange)",
                      color: "white",
                    }
                  : { background: "transparent", color: "var(--color-text-muted)" }
              }
            >
              {s}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="card p-12 text-center">
          <Loader2 className="w-5 h-5 animate-spin inline text-orange" />
        </div>
      ) : items.length === 0 ? (
        <div className="card p-12 text-center text-[var(--color-text-muted)]">
          No {filter === "all" ? "" : filter} cashout requests.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <CashoutRow
              key={r.id}
              row={r}
              busy={busyId === r.id}
              onTransition={transition}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CashoutRow({
  row,
  busy,
  onTransition,
}: {
  row: Cashout;
  busy: boolean;
  onTransition: (
    row: Cashout,
    next: "approved" | "rejected" | "paid"
  ) => void;
}) {
  return (
    <div className="card p-5">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Banknote className="w-4 h-4 text-emerald-600" />
            <span className="text-xl font-extrabold">
              RM {Number(row.amount).toFixed(2)}
            </span>
            <StatusBadge status={row.status} />
          </div>
          <p className="text-sm font-bold mt-2">
            {row.user_full_name || "(no name)"}
            <span className="ml-2 text-xs font-mono text-[var(--color-text-muted)]">
              {row.user_email}
            </span>
          </p>
          {row.user_whatsapp && (
            <p className="text-[11px] text-[var(--color-text-muted)]">
              WhatsApp: {row.user_whatsapp}
            </p>
          )}
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <Field label="Bank" value={row.bank_name} />
            <Field label="Account Holder" value={row.bank_account_name} />
            <Field label="Account Number" value={row.bank_account_number} mono />
          </div>
          {row.admin_note && (
            <p className="text-[11px] text-[var(--color-text-secondary)] mt-2 italic">
              Note: {row.admin_note}
            </p>
          )}
          <p className="text-[10px] font-mono text-[var(--color-text-muted)] mt-2">
            Submitted {new Date(row.created_at).toLocaleString("en-MY")}
            {row.paid_at &&
              ` · Paid ${new Date(row.paid_at).toLocaleString("en-MY")}`}
          </p>
        </div>

        {row.status !== "paid" && row.status !== "rejected" && (
          <div className="flex flex-col gap-2 md:min-w-[180px]">
            {row.status === "pending" && (
              <button
                onClick={() => onTransition(row, "approved")}
                disabled={busy}
                className="px-4 py-2 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                style={{
                  background: "rgba(59,130,246,0.12)",
                  border: "1px solid rgba(59,130,246,0.4)",
                  color: "#1d4ed8",
                }}
              >
                <Clock className="w-3.5 h-3.5" />
                Approve
              </button>
            )}
            <button
              onClick={() => onTransition(row, "paid")}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-xs font-bold text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
              style={{ background: "#16a34a" }}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Mark Paid
            </button>
            <button
              onClick={() => onTransition(row, "rejected")}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
              style={{
                background: "rgba(244,67,54,0.08)",
                border: "1px solid rgba(244,67,54,0.4)",
                color: "#c62828",
              }}
            >
              <XCircle className="w-3.5 h-3.5" />
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      className="rounded-lg p-2.5"
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
      }}
    >
      <p className="text-[9px] uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-0.5">
        {label}
      </p>
      <p className={`text-xs font-semibold ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: Cashout["status"] }) {
  const map: Record<Cashout["status"], { bg: string; fg: string; label: string }> = {
    pending:  { bg: "rgba(245,158,11,0.12)", fg: "#b45309", label: "Pending" },
    approved: { bg: "rgba(59,130,246,0.12)", fg: "#1d4ed8", label: "Approved" },
    paid:     { bg: "rgba(16,185,129,0.12)", fg: "#047857", label: "Paid" },
    rejected: { bg: "rgba(244,67,54,0.12)",  fg: "#c62828", label: "Rejected" },
  };
  const s = map[status];
  return (
    <span
      className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-1 rounded"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}
