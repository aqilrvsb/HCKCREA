"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle, UserPlus, Copy } from "lucide-react";

type Application = {
  id: string;
  full_name: string;
  email: string;
  whatsapp: string;
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
  approved_user_id: string | null;
  approved_at: string | null;
  created_at: string;
};

type StatusFilter = "all" | "pending" | "approved" | "rejected";

export default function AdminAffiliatePage() {
  const [items, setItems] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [recentTempPassword, setRecentTempPassword] = useState<{
    email: string;
    password: string;
  } | null>(null);

  useEffect(() => {
    void load();
  }, [filter]);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/affiliate?status=${filter}`, {
        cache: "no-store",
      });
      const d = await r.json();
      setItems((d?.rows as Application[]) || []);
    } finally {
      setLoading(false);
    }
  }

  async function act(row: Application, action: "approve" | "reject") {
    const noteLabel =
      action === "approve"
        ? "Admin note (optional — visible in app row)"
        : "Rejection reason (required)";
    const note = prompt(noteLabel) ?? "";
    if (action === "reject" && !note.trim()) {
      alert("Rejection reason required");
      return;
    }
    setBusyId(row.id);
    try {
      const r = await fetch("/api/admin/affiliate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          action,
          admin_note: note.trim() || null,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        alert(d?.error || "Action failed");
        return;
      }

      // If WhatsApp delivery failed, the API returns a temp_password
      // so admin can hand it over manually.
      if (action === "approve" && d?.temp_password) {
        setRecentTempPassword({
          email: row.email,
          password: d.temp_password,
        });
      }

      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display font-extrabold text-3xl tracking-tight">
          Affiliate Applications
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Review affiliate sign-ups. Approving creates a user with Pro plan
          (30 days) + 10 credits and sends login details via WhatsApp.
        </p>
      </div>

      {/* Manual-handoff banner — appears when an approval succeeded but
          the WhatsApp send failed. Admin copies the temp password and
          delivers it manually. */}
      {recentTempPassword && (
        <div
          className="card p-4 mb-4 border-2"
          style={{
            background: "rgba(245,158,11,0.08)",
            borderColor: "rgba(245,158,11,0.4)",
          }}
        >
          <p className="text-sm font-bold text-amber-700 mb-1">
            ⚠ WhatsApp delivery failed — copy these credentials and send manually
          </p>
          <div className="grid sm:grid-cols-2 gap-2 mt-2">
            <CopyableField label="Email" value={recentTempPassword.email} />
            <CopyableField label="Temp password" value={recentTempPassword.password} mono />
          </div>
          <button
            onClick={() => setRecentTempPassword(null)}
            className="text-[11px] font-bold text-amber-800 mt-3 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex gap-1 p-1 rounded-xl bg-[var(--color-bg-card)] mb-4 max-w-md">
        {(["pending", "approved", "rejected", "all"] as StatusFilter[]).map((s) => {
          const active = filter === s;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className="flex-1 py-2 rounded-lg text-xs font-bold capitalize transition"
              style={
                active
                  ? { background: "var(--color-orange)", color: "white" }
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
          No {filter === "all" ? "" : filter} applications.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((row) => (
            <ApplicationRow
              key={row.id}
              row={row}
              busy={busyId === row.id}
              onAct={act}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApplicationRow({
  row,
  busy,
  onAct,
}: {
  row: Application;
  busy: boolean;
  onAct: (row: Application, action: "approve" | "reject") => void;
}) {
  return (
    <div className="card p-5">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <UserPlus className="w-4 h-4 text-orange" />
            <span className="font-display font-extrabold text-lg">
              {row.full_name}
            </span>
            <StatusBadge status={row.status} />
          </div>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <Field label="Email" value={row.email} mono />
            <Field label="WhatsApp" value={row.whatsapp} mono />
          </div>
          {row.admin_note && (
            <p className="text-[11px] text-[var(--color-text-secondary)] mt-2 italic">
              Note: {row.admin_note}
            </p>
          )}
          <p className="text-[10px] font-mono text-[var(--color-text-muted)] mt-2">
            Applied {new Date(row.created_at).toLocaleString("en-MY")}
            {row.approved_at &&
              ` · ${row.status === "approved" ? "Approved" : "Rejected"} ${new Date(row.approved_at).toLocaleString("en-MY")}`}
          </p>
        </div>

        {row.status === "pending" && (
          <div className="flex flex-col gap-2 md:min-w-[180px]">
            <button
              onClick={() => onAct(row, "approve")}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-xs font-bold text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
              style={{ background: "#16a34a" }}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Approve
            </button>
            <button
              onClick={() => onAct(row, "reject")}
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

function CopyableField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="rounded-lg p-2.5 flex items-center justify-between gap-2"
      style={{
        background: "white",
        border: "1px solid rgba(245,158,11,0.3)",
      }}
    >
      <div>
        <p className="text-[9px] uppercase tracking-widest text-amber-700 font-bold mb-0.5">
          {label}
        </p>
        <p className={`text-xs font-semibold text-amber-900 ${mono ? "font-mono" : ""}`}>
          {value}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="text-amber-700 hover:text-amber-900 flex-shrink-0"
      >
        {copied ? (
          <CheckCircle2 className="w-4 h-4" />
        ) : (
          <Copy className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: Application["status"] }) {
  const map: Record<Application["status"], { bg: string; fg: string; label: string }> = {
    pending:  { bg: "rgba(245,158,11,0.12)", fg: "#b45309", label: "Pending" },
    approved: { bg: "rgba(16,185,129,0.12)", fg: "#047857", label: "Approved" },
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
