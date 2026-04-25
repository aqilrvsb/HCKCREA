"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Search,
  CheckCircle2,
  XCircle,
  Loader2,
  KeyRound,
  Phone,
  Power,
  PowerOff,
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
  const [editing, setEditing] = useState<{ id: string; whatsapp: string } | null>(null);

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

  async function resetPassword(c: Client) {
    if (!confirm(`Reset password untuk ${c.email}?\n\nPassword baru akan dihantar di WhatsApp.`)) return;
    setBusy(c.id);
    try {
      await fetch("/api/admin/clients/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: c.id }),
      });
      alert("Password baru dah dihantar di WhatsApp.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function saveWhatsapp() {
    if (!editing) return;
    setBusy(editing.id);
    try {
      await fetch("/api/admin/clients/update-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: editing.id,
          whatsapp: editing.whatsapp,
        }),
      });
      setEditing(null);
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display font-extrabold text-3xl tracking-tight">
          Client Management
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          {clients.length} clients · {clients.filter((c) => c.is_active).length} active.
        </p>
      </div>

      <div className="card p-4 mb-5">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
          <input
            placeholder="Search by email, name, or WhatsApp…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-11"
          />
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold border-b border-[var(--color-border)] bg-gray-50/50">
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
                    <Loader2 className="w-5 h-5 animate-spin inline text-orange" />
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-[var(--color-text-muted)]">
                    Tiada client.
                  </td>
                </tr>
              )}
              {filtered.map((c) => {
                const isEditing = editing?.id === c.id;
                const expired = c.plan_expires_at
                  ? new Date(c.plan_expires_at) < new Date()
                  : false;
                return (
                  <tr
                    key={c.id}
                    className={`border-b border-[var(--color-border)] last:border-b-0 hover:bg-gray-50/40 ${
                      !c.is_active ? "opacity-50" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold">{c.full_name || "—"}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{c.email}</div>
                      {c.is_admin && (
                        <span className="inline-block mt-1 px-1.5 py-0.5 text-[10px] font-bold uppercase bg-orange text-white rounded">
                          Admin
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <div className="flex gap-1.5">
                          <input
                            value={editing.whatsapp}
                            onChange={(e) =>
                              setEditing({ ...editing, whatsapp: e.target.value })
                            }
                            placeholder="60123456789"
                            className="input py-1.5 text-xs"
                          />
                          <button
                            onClick={saveWhatsapp}
                            disabled={busy === c.id}
                            className="px-2 py-1 rounded-lg bg-orange text-white text-xs font-bold hover:bg-orange-600 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            className="px-2 py-1 rounded-lg bg-white border border-[var(--color-border)] text-xs"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() =>
                            setEditing({
                              id: c.id,
                              whatsapp: c.whatsapp || "",
                            })
                          }
                          className="font-mono text-xs hover:text-orange"
                        >
                          {c.whatsapp || "—"}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-md bg-orange-50 border border-orange-100 text-orange text-xs font-bold uppercase">
                        {c.plan}
                      </span>
                      {c.plan_expires_at && (
                        <div
                          className={`text-[10px] mt-1 font-mono ${
                            expired ? "text-red-600" : "text-[var(--color-text-muted)]"
                          }`}
                        >
                          {expired ? "Expired " : "Until "}
                          {new Date(c.plan_expires_at).toLocaleDateString("ms-MY", {
                            day: "2-digit",
                            month: "short",
                            year: "2-digit",
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {c.is_active ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
                          <CheckCircle2 className="w-3 h-3" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 text-xs font-bold">
                          <XCircle className="w-3 h-3" />
                          Deactivated
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-bold">
                      {Number(c.credits).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          disabled={busy === c.id}
                          onClick={() => resetPassword(c)}
                          title="Reset password + send via WhatsApp"
                          className="p-1.5 rounded-lg bg-white border border-[var(--color-border)] hover:border-orange-300 disabled:opacity-50"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                        <button
                          disabled={busy === c.id}
                          onClick={() => toggleActive(c)}
                          title={c.is_active ? "Deactivate" : "Reactivate"}
                          className={`p-1.5 rounded-lg border disabled:opacity-50 ${
                            c.is_active
                              ? "bg-white border-[var(--color-border)] hover:border-red-300 hover:text-red-600"
                              : "bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600"
                          }`}
                        >
                          {c.is_active ? (
                            <PowerOff className="w-3.5 h-3.5" />
                          ) : (
                            <Power className="w-3.5 h-3.5" />
                          )}
                        </button>
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
