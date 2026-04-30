"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Search,
  CheckCircle2,
  XCircle,
  Loader2,
  Pencil,
  Power,
  PowerOff,
  X,
} from "lucide-react";

type Client = {
  id: string;
  email: string;
  full_name: string | null;
  whatsapp: string | null;
  plan: string;
  plan_expires_at: string | null;
  is_active: boolean;
  is_admin: boolean;
  credits: number;
  created_at: string;
};

export default function AdminClients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Client | null>(null);
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  // Click an email → server mints a session for the target user via
  // verifyOtp (peningbot pattern), client signs out the admin and
  // setSession()'s the new tokens, redirect to /dashboard. Same-origin
  // cookie auth means we can't keep TWO sessions live in the same
  // browser — admin will need to re-login afterwards to come back.
  async function impersonate(c: Client) {
    if (
      !confirm(
        `Login as ${c.full_name || c.email}?\n\nYour admin session will be replaced. Re-login at /admin to come back.`
      )
    ) {
      return;
    }
    setImpersonatingId(c.id);
    try {
      const r = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: c.id }),
      });
      const d = await r.json();
      if (!r.ok || !d?.session) {
        alert(`Impersonate failed: ${d?.error || "unknown error"}`);
        return;
      }
      const sb = createClient();
      // Sign out current admin first so cookies get cleared cleanly.
      await sb.auth.signOut();
      // Set the target user's session tokens.
      const res = await sb.auth.setSession({
        access_token: d.session.access_token,
        refresh_token: d.session.refresh_token,
      });
      if (res.error) {
        alert(`Impersonate setSession failed: ${res.error.message}`);
        return;
      }
      // Hard navigate so the dashboard server component re-reads cookies.
      window.location.href = "/dashboard";
    } finally {
      setImpersonatingId(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/clients", { cache: "no-store" });
      const d = await r.json();
      setClients(d?.clients || []);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.email.toLowerCase().includes(q) ||
        (c.full_name || "").toLowerCase().includes(q) ||
        (c.whatsapp || "").includes(q)
    );
  }, [clients, search]);

  async function toggleActive(c: Client) {
    setBusy(c.id);
    try {
      await fetch("/api/admin/clients/toggle-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: c.id, is_active: !c.is_active }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display font-extrabold text-3xl tracking-tight text-[var(--color-text-primary)]">
          Client Management
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          {clients.length} clients · {clients.filter((c) => c.is_active).length} active.
        </p>
      </div>

      <div
        className="rounded-2xl p-4 mb-5"
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
          <input
            placeholder="Search by email, name, or WhatsApp…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 rounded-lg outline-none text-sm"
            style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
        </div>
      </div>

      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr
                className="text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold border-b"
                style={{
                  borderColor: "var(--color-border)",
                  background: "rgba(255,87,34,0.04)",
                }}
              >
                <th className="text-left px-4 py-3">Client</th>
                <th className="text-left px-4 py-3">WhatsApp</th>
                <th className="text-left px-4 py-3">Plan</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Credits</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <Loader2 className="w-5 h-5 animate-spin inline" style={{ color: "var(--color-orange)" }} />
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-[var(--color-text-muted)]"
                  >
                    Tiada client.
                  </td>
                </tr>
              )}
              {filtered.map((c) => {
                const expired = c.plan_expires_at
                  ? new Date(c.plan_expires_at) < new Date()
                  : false;
                return (
                  <tr
                    key={c.id}
                    className={`border-b last:border-b-0 transition-colors ${
                      !c.is_active ? "opacity-60" : ""
                    }`}
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[var(--color-text-primary)]">
                        {c.full_name || "—"}
                      </div>
                      <button
                        type="button"
                        onClick={() => void impersonate(c)}
                        disabled={impersonatingId === c.id}
                        title="Click to log in as this user (opens in new tab)"
                        className="text-xs text-[var(--color-text-muted)] hover:text-orange hover:underline transition disabled:opacity-50"
                      >
                        {impersonatingId === c.id ? "Generating link…" : c.email}
                      </button>
                      {c.is_admin && (
                        <span
                          className="inline-block mt-1 px-1.5 py-0.5 text-[10px] font-bold uppercase rounded"
                          style={{
                            background: "var(--color-orange)",
                            color: "#000",
                          }}
                        >
                          Admin
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]">
                      {c.whatsapp || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="px-2 py-0.5 rounded-md text-xs font-bold uppercase"
                        style={{
                          background: "rgba(255,87,34,0.12)",
                          border: "1px solid rgba(255,87,34,0.3)",
                          color: "var(--color-orange)",
                        }}
                      >
                        {c.plan}
                      </span>
                      {c.plan_expires_at && (
                        <div
                          className="text-[10px] mt-1 font-mono"
                          style={{
                            color: expired
                              ? "#ef4444"
                              : "var(--color-text-muted)",
                          }}
                        >
                          {expired ? "Expired " : "Until "}
                          {new Date(c.plan_expires_at).toLocaleDateString(
                            "ms-MY",
                            { day: "2-digit", month: "short", year: "2-digit" }
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {c.is_active ? (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
                          style={{
                            background: "rgba(34,197,94,0.12)",
                            color: "#22c55e",
                            border: "1px solid rgba(34,197,94,0.3)",
                          }}
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          Active
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
                          style={{
                            background: "rgba(244,67,54,0.12)",
                            color: "#ef4444",
                            border: "1px solid rgba(244,67,54,0.3)",
                          }}
                        >
                          <XCircle className="w-3 h-3" />
                          Off
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-[var(--color-text-primary)]">
                      {Number(c.credits).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <IconButton
                          title="Edit client"
                          onClick={() => setEditing(c)}
                          color="orange"
                        >
                          <Pencil className="w-3.5 h-3.5" strokeWidth={2.4} />
                        </IconButton>
                        <IconButton
                          title={c.is_active ? "Deactivate" : "Reactivate"}
                          onClick={() => toggleActive(c)}
                          disabled={busy === c.id}
                          color={c.is_active ? "red" : "green"}
                        >
                          {busy === c.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : c.is_active ? (
                            <PowerOff className="w-3.5 h-3.5" strokeWidth={2.4} />
                          ) : (
                            <Power className="w-3.5 h-3.5" strokeWidth={2.4} />
                          )}
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditClientModal
          client={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

// ── Icon button, dark-theme aware ─────────────────────────────────────────
function IconButton({
  title,
  onClick,
  disabled,
  color,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  color: "orange" | "red" | "green";
  children: React.ReactNode;
}) {
  const colorMap = {
    orange: { bg: "rgba(255,87,34,0.12)", border: "rgba(255,87,34,0.4)", text: "var(--color-orange)" },
    red: { bg: "rgba(244,67,54,0.12)", border: "rgba(244,67,54,0.4)", text: "#ef4444" },
    green: { bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.4)", text: "#22c55e" },
  };
  const c = colorMap[color];
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="p-1.5 rounded-lg transition-transform hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.text,
      }}
    >
      {children}
    </button>
  );
}

// ── Edit modal ────────────────────────────────────────────────────────────
function EditClientModal({
  client,
  onClose,
  onSaved,
}: {
  client: Client;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [plan, setPlan] = useState(client.plan || "free");
  const [expiresAt, setExpiresAt] = useState(
    client.plan_expires_at
      ? new Date(client.plan_expires_at).toISOString().slice(0, 10)
      : ""
  );
  const [extendDays, setExtendDays] = useState("");
  const [whatsapp, setWhatsapp] = useState(client.whatsapp || "");
  const [creditsDelta, setCreditsDelta] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const body: Record<string, any> = { user_id: client.id };

      if (plan && plan !== client.plan) body.plan = plan;

      if (extendDays.trim()) {
        const days = Number(extendDays);
        if (!Number.isFinite(days) || days <= 0) {
          throw new Error("Extend days must be a positive number");
        }
        body.plan_expires_at = `+${days}d`;
      } else if (expiresAt) {
        body.plan_expires_at = new Date(expiresAt + "T23:59:59").toISOString();
      } else if (
        client.plan_expires_at &&
        expiresAt === ""
      ) {
        body.plan_expires_at = "";
      }

      if (whatsapp.trim() !== (client.whatsapp || "").trim()) {
        body.whatsapp = whatsapp.trim();
      }

      if (creditsDelta.trim()) {
        const n = Number(creditsDelta);
        if (!Number.isFinite(n)) throw new Error("Credit top-up must be a number");
        body.credits_delta = n;
      }

      if (password.trim()) {
        if (password.trim().length < 6)
          throw new Error("Password must be at least 6 characters");
        body.password = password.trim();
      }

      const r = await fetch("/api/admin/clients/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Update failed");
      onSaved();
    } catch (e: any) {
      setError(e?.message || "Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto"
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            <h2 className="font-display font-extrabold text-lg text-[var(--color-text-primary)]">
              Edit Client
            </h2>
            <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
              {client.full_name || "—"} · {client.email}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5"
          >
            <X className="w-4 h-4 text-[var(--color-text-secondary)]" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Plan + expiry */}
          <Section title="Plan & validity">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Plan</FieldLabel>
                <DarkSelect value={plan} onChange={setPlan}>
                  <option value="free">Free</option>
                  <option value="pro">Pro</option>
                </DarkSelect>
              </div>
              <div>
                <FieldLabel>Expiry date</FieldLabel>
                <DarkInput
                  type="date"
                  value={expiresAt}
                  onChange={setExpiresAt}
                />
                <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
                  Current:{" "}
                  {client.plan_expires_at
                    ? new Date(client.plan_expires_at).toLocaleDateString()
                    : "—"}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <FieldLabel>Or extend by N days (from current expiry)</FieldLabel>
              <div className="flex gap-2">
                <DarkInput
                  type="number"
                  value={extendDays}
                  onChange={setExtendDays}
                  placeholder="e.g. 30"
                />
                <button
                  type="button"
                  onClick={() => setExtendDays("30")}
                  className="px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap"
                  style={{
                    background: "rgba(255,87,34,0.12)",
                    border: "1px solid rgba(255,87,34,0.3)",
                    color: "var(--color-orange)",
                  }}
                >
                  +30 days
                </button>
              </div>
            </div>
          </Section>

          {/* Credits */}
          <Section title="Credits">
            <div className="text-xs text-[var(--color-text-muted)] mb-2">
              Current balance:{" "}
              <span className="font-bold text-[var(--color-text-primary)]">
                {Number(client.credits).toFixed(2)}
              </span>
            </div>
            <FieldLabel>Top up / deduct (positive = add, negative = subtract)</FieldLabel>
            <div className="flex gap-2">
              <DarkInput
                type="number"
                step="0.01"
                value={creditsDelta}
                onChange={setCreditsDelta}
                placeholder="e.g. 50 or -10"
              />
              <button
                type="button"
                onClick={() => setCreditsDelta("50")}
                className="px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap"
                style={{
                  background: "rgba(34,197,94,0.12)",
                  border: "1px solid rgba(34,197,94,0.3)",
                  color: "#22c55e",
                }}
              >
                +RM50
              </button>
              <button
                type="button"
                onClick={() => setCreditsDelta("100")}
                className="px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap"
                style={{
                  background: "rgba(34,197,94,0.12)",
                  border: "1px solid rgba(34,197,94,0.3)",
                  color: "#22c55e",
                }}
              >
                +RM100
              </button>
            </div>
          </Section>

          {/* WhatsApp */}
          <Section title="WhatsApp number">
            <DarkInput
              type="tel"
              value={whatsapp}
              onChange={setWhatsapp}
              placeholder="60123456789"
            />
          </Section>

          {/* Password */}
          <Section title="Reset password">
            <DarkInput
              type="text"
              value={password}
              onChange={setPassword}
              placeholder="Leave empty to keep current password"
            />
            <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
              Minimum 6 characters. Tell the client manually — we don't auto-WhatsApp here.
            </div>
          </Section>

          {error && (
            <div
              className="px-3 py-2 rounded-lg text-xs font-semibold"
              style={{
                background: "rgba(244,67,54,0.12)",
                border: "1px solid rgba(244,67,54,0.4)",
                color: "#fca5a5",
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          className="px-5 py-4 border-t flex gap-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold"
            style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-secondary)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="flex-1 py-2.5 rounded-lg text-sm font-extrabold text-white inline-flex items-center justify-center gap-2 disabled:opacity-50"
            style={{
              background:
                "linear-gradient(90deg, var(--color-orange) 0%, #facc15 100%)",
              boxShadow: "0 4px 14px rgba(255,87,34,0.3)",
            }}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
        {title}
      </div>
      <div
        className="rounded-xl p-3"
        style={{
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
      {children}
    </div>
  );
}

function DarkInput({
  type,
  value,
  onChange,
  placeholder,
  step,
}: {
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  step?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      step={step}
      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        color: "var(--color-text-primary)",
      }}
    />
  );
}

function DarkSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 rounded-lg text-sm font-semibold outline-none"
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        color: "var(--color-text-primary)",
      }}
    >
      {children}
    </select>
  );
}
