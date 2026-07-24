"use client";

// Manage Users — a scoped "Add / Edit User" panel for allowlisted reseller
// accounts (the nl team). Add a user (name + email + password → premium 1yr),
// and edit name/email/password of users the team created. No credit controls.

import { useEffect, useState } from "react";
import { Loader2, UserPlus, Pencil, Check } from "lucide-react";

// KL today as YYYY-MM-DD.
function klToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

type RCounts = {
  totalStoryboard: number; totalVideo: number; originalVideo: number;
  dialogUgc: number; autoUgc: number; editor: number; readyAffiliate: number; donePost: number; donePostAff: number;
};
type ReportUser = { id: string; name: string; email: string; counts: RCounts };

// Per-user usage report — success-only counts by create date.
function UsageReport() {
  const today = klToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<ReportUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/manage-users/report?from=${from}&to=${to}`, { cache: "no-store" });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) { setErr(d?.error || "Gagal muat laporan."); return; }
      setRows(d.users || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { void run(); /* eslint-disable-next-line */ }, []);

  const cols: { key: keyof RCounts; label: string }[] = [
    { key: "totalStoryboard", label: "Total Storyboard" },
    { key: "totalVideo", label: "Total Video" },
    { key: "originalVideo", label: "Original Video" },
    { key: "dialogUgc", label: "Dialog UGC" },
    { key: "autoUgc", label: "Auto UGC" },
    { key: "editor", label: "Editor" },
    { key: "readyAffiliate", label: "Ready Affiliate" },
    { key: "donePost", label: "Done Post" },
    { key: "donePostAff", label: "Done Post Affiliate" },
  ];
  const totals = cols.reduce((acc, c) => { acc[c.key] = rows.reduce((s, u) => s + (u.counts[c.key] || 0), 0); return acc; }, {} as Record<string, number>);
  const preset = (days: number) => { const t = klToday(); setTo(t); setFrom(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - (days - 1) * 86400000))); };

  return (
    <div className="rounded-2xl p-4" style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}>
      <div className="flex items-end gap-2 flex-wrap mb-3">
        <span className="font-display font-bold text-[15px] text-[var(--color-text-primary)] mr-2">Laporan Penggunaan</span>
        <div>
          <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">Dari</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input py-1 text-xs" />
        </div>
        <div>
          <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">Hingga</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input py-1 text-xs" />
        </div>
        {[[1, "Hari ni"], [7, "7 hari"], [30, "30 hari"]].map(([d, l]) => (
          <button key={String(d)} onClick={() => preset(d as number)} className="text-[11px] px-2 py-1 rounded-lg self-end" style={{ border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>{l as string}</button>
        ))}
        <button onClick={() => void run()} disabled={loading} className="btn-primary text-xs px-3 py-1.5 self-end disabled:opacity-60 inline-flex items-center gap-1.5">{loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "🔎"} Filter</button>
      </div>
      {err && <div className="text-[12px] mb-2 font-semibold text-red-500">{err}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="text-[var(--color-text-muted)]">
              <th className="text-left font-bold py-1.5 pr-3 sticky left-0" style={{ background: "var(--color-bg-card)" }}>User</th>
              {cols.map((c) => <th key={c.key} className="text-right font-bold py-1.5 px-2 whitespace-nowrap">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={cols.length + 1} className="py-6 text-center text-[var(--color-text-muted)]">{loading ? "Memuatkan…" : "Tiada data untuk julat ni."}</td></tr>
            ) : rows.map((u) => (
              <tr key={u.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td className="py-1.5 pr-3 sticky left-0" style={{ background: "var(--color-bg-card)" }}>
                  <div className="font-bold text-[var(--color-text-primary)] truncate max-w-[160px]">{u.name || "—"}</div>
                  <div className="text-[9px] text-[var(--color-text-muted)] truncate max-w-[160px]">{u.email}</div>
                </td>
                {cols.map((c) => (
                  <td key={c.key} className={`text-right py-1.5 px-2 tabular-nums ${c.key === "totalStoryboard" || c.key === "totalVideo" ? "font-extrabold text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}`}>{u.counts[c.key] || 0}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--color-border)" }}>
                <td className="py-1.5 pr-3 font-extrabold text-[var(--color-text-primary)] sticky left-0" style={{ background: "var(--color-bg-card)" }}>JUMLAH</td>
                {cols.map((c) => <td key={c.key} className="text-right py-1.5 px-2 font-extrabold tabular-nums text-[var(--color-text-primary)]">{totals[c.key] || 0}</td>)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

type ManagedUser = {
  id: string;
  name: string;
  email: string;
  plan: string;
  plan_expires_at: string | null;
  is_active: boolean;
  created_at: string;
  created_by_email: string;
};

export default function ManageUsersSection() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Add form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adding, setAdding] = useState(false);

  // Inline edit
  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState("");
  const [eEmail, setEEmail] = useState("");
  const [ePass, setEPass] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/manage-users/list", { cache: "no-store" });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.ok) setUsers(d.users || []);
      else setMsg({ ok: false, text: d?.error || "Gagal muat senarai." });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function addUser() {
    if (!email.trim() || password.length < 6) {
      setMsg({ ok: false, text: "Isi email sah + password (min 6 aksara)." });
      return;
    }
    setAdding(true); setMsg(null);
    try {
      const r = await fetch("/api/manage-users/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) { setMsg({ ok: false, text: d?.error || "Gagal tambah user." }); return; }
      setMsg({ ok: true, text: `User ${email} ditambah (Premium 1 tahun).` });
      setName(""); setEmail(""); setPassword("");
      await load();
    } finally { setAdding(false); }
  }

  function startEdit(u: ManagedUser) {
    setEditId(u.id); setEName(u.name); setEEmail(u.email); setEPass("");
    setMsg(null);
  }
  async function saveEdit(id: string) {
    setSavingEdit(true); setMsg(null);
    try {
      const patch: any = { user_id: id, name: eName.trim(), email: eEmail.trim() };
      if (ePass.trim().length >= 6) patch.password = ePass.trim();
      const r = await fetch("/api/manage-users/update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) { setMsg({ ok: false, text: d?.error || "Gagal update." }); return; }
      setMsg({ ok: true, text: "User dikemaskini." });
      setEditId(null);
      await load();
    } finally { setSavingEdit(false); }
  }

  const fmtDate = (s: string | null) =>
    s ? new Intl.DateTimeFormat("ms-MY", { timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short", year: "numeric" }).format(new Date(s)) : "—";

  return (
    <div className="space-y-4">
      {/* Add user */}
      <div className="rounded-2xl p-4" style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-2 mb-3">
          <UserPlus className="w-4 h-4" style={{ color: "#8b5cf6" }} />
          <span className="font-display font-bold text-[15px] text-[var(--color-text-primary)]">Tambah User</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <input className="input" placeholder="Nama user" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="email@user.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" type="text" placeholder="Password (min 6)" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !adding && addUser()} />
        </div>
        <button onClick={() => void addUser()} disabled={adding} className="btn-primary mt-2 disabled:opacity-60 inline-flex items-center gap-1.5">
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />} Tambah User
        </button>
        {msg && (
          <div className="text-[12px] mt-2 font-semibold" style={{ color: msg.ok ? "#16a34a" : "#dc2626" }}>{msg.text}</div>
        )}
      </div>

      {/* User list */}
      <div className="rounded-2xl p-4" style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center justify-between mb-3">
          <span className="font-display font-bold text-[15px] text-[var(--color-text-primary)]">Senarai User Anda ({users.length})</span>
          <button onClick={() => void load()} className="text-xs px-2.5 py-1 rounded-lg" style={{ border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>↻ Refresh</button>
        </div>
        {loading ? (
          <div className="py-8 text-center text-sm text-[var(--color-text-muted)]">Memuatkan…</div>
        ) : users.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--color-text-muted)]">Belum ada user. Tambah di atas.</div>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="rounded-lg px-3 py-2.5" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                {editId === u.id ? (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <input className="input" placeholder="Nama" value={eName} onChange={(e) => setEName(e.target.value)} />
                      <input className="input" placeholder="Email" value={eEmail} onChange={(e) => setEEmail(e.target.value)} />
                      <input className="input" placeholder="Password baru (kosong = kekal)" value={ePass} onChange={(e) => setEPass(e.target.value)} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => void saveEdit(u.id)} disabled={savingEdit} className="btn-primary disabled:opacity-60 inline-flex items-center gap-1.5 text-xs px-3 py-1.5">{savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Simpan</button>
                      <button onClick={() => setEditId(null)} className="text-xs px-3 py-1.5 rounded-lg" style={{ border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>Batal</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm" style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa" }}>{(u.name || u.email || "?").slice(0, 1).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-bold text-[var(--color-text-primary)] truncate">{u.name || "(tiada nama)"}</div>
                      <div className="text-[11px] text-[var(--color-text-muted)] truncate">{u.email}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] font-bold px-2 py-0.5 rounded-full inline-block" style={{ background: u.is_active ? "rgba(34,197,94,0.15)" : "rgba(148,163,184,0.15)", color: u.is_active ? "#22c55e" : "#94a3b8" }}>{u.plan?.toUpperCase() || "—"}</div>
                      <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">Sah: {fmtDate(u.plan_expires_at)}</div>
                    </div>
                    <button onClick={() => startEdit(u)} title="Edit" className="shrink-0 rounded-lg p-2" style={{ border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}><Pencil className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Usage report — per-user success counts by create date. */}
      <UsageReport />
    </div>
  );
}
