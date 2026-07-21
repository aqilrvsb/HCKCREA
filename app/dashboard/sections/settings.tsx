"use client";

import { useEffect, useState } from "react";
import {
  Lock,
  MessageCircle,
  Loader2,
  CheckCircle2,
  AlertCircle,
  User,
  Video,
  Users,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Video provider preference. Labels are deliberately neutral — clients
// don't need to know about the underlying upstream brand names.
type VideoProvider = "p1" | "p2" | null;
const VIDEO_PROVIDER_LABEL: Record<"p1" | "p2", string> = {
  p2: "P2 (Default)",
  p1: "P1",
};

export default function SettingsSection({
  email,
  name,
  whatsapp,
}: {
  email: string;
  name: string;
  whatsapp?: string;
}) {
  const [whatsappVal, setWhatsappVal] = useState(whatsapp || "");
  const [savingWA, setSavingWA] = useState(false);
  const [waMsg, setWaMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [pwOld, setPwOld] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwNewConfirm, setPwNewConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Video provider — null means "use platform default", otherwise an
  // explicit override the client picked. We surface the effective value
  // in the dropdown so the user always sees what's currently active.
  const [videoProvider, setVideoProvider] = useState<VideoProvider>(null);
  const [adminDefault, setAdminDefault] = useState<"p1" | "p2">("p2");
  const [savingVp, setSavingVp] = useState(false);
  const [vpMsg, setVpMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/me/provider-video", { cache: "no-store" });
        const d = await r.json();
        if (r.ok && d?.ok) {
          setVideoProvider(d.user_pref || null);
          if (d.admin_default === "p1" || d.admin_default === "p2") {
            setAdminDefault(d.admin_default);
          }
        }
      } catch {
        // Silent — defaults stay
      }
    })();
  }, []);

  async function saveVideoProvider(next: VideoProvider) {
    setSavingVp(true);
    setVpMsg(null);
    try {
      const r = await fetch("/api/me/provider-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: next }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        setVpMsg({ ok: false, text: d?.error || "Update failed" });
        return;
      }
      setVideoProvider(next);
      setVpMsg({
        ok: true,
        text:
          next === null
            ? "Video provider reset to default."
            : `Video provider set to ${VIDEO_PROVIDER_LABEL[next]}.`,
      });
    } catch (e: any) {
      setVpMsg({ ok: false, text: e?.message || "Update failed" });
    } finally {
      setSavingVp(false);
    }
  }

  // ── Affiliate mode (tag + record) ──────────────────────────────────────────
  // A toggle (default OFF) + a list of {name,email} affiliate contacts. When ON,
  // the Editor shows a Transfer Affiliate flow that tags videos with one of
  // these emails. Stored in profiles.settings jsonb (client-side, like WhatsApp).
  const [affEnabled, setAffEnabled] = useState(false);
  const [affContacts, setAffContacts] = useState<{ name: string; email: string }[]>([]);
  const [affName, setAffName] = useState("");
  const [affEmail, setAffEmail] = useState("");
  const [savingAff, setSavingAff] = useState(false);
  const [affMsg, setAffMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return;
        const { data } = await sb.from("profiles").select("settings").eq("id", user.id).maybeSingle();
        const s = (data?.settings || {}) as any;
        setAffEnabled(!!s.affiliate_enabled);
        setAffContacts(Array.isArray(s.affiliate_contacts) ? s.affiliate_contacts : []);
      } catch { /* keep defaults */ }
    })();
  }, []);

  async function saveAffiliate(nextEnabled: boolean, nextContacts: { name: string; email: string }[]) {
    setSavingAff(true); setAffMsg(null);
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { data: cur } = await sb.from("profiles").select("settings").eq("id", user.id).maybeSingle();
      const merged = { ...(((cur?.settings as any)) || {}), affiliate_enabled: nextEnabled, affiliate_contacts: nextContacts };
      const { error } = await sb.from("profiles").update({ settings: merged }).eq("id", user.id);
      if (error) throw error;
      setAffEnabled(nextEnabled); setAffContacts(nextContacts);
      setAffMsg({ ok: true, text: "Affiliate settings dah update." });
    } catch (e: any) {
      setAffMsg({ ok: false, text: e?.message || "Update failed" });
    } finally { setSavingAff(false); }
  }
  const addAffContact = () => {
    const nm = affName.trim(); const em = affEmail.trim().toLowerCase();
    if (!em || !em.includes("@")) { setAffMsg({ ok: false, text: "Masukkan email affiliate yang sah." }); return; }
    if (affContacts.some((c) => c.email === em)) { setAffMsg({ ok: false, text: "Email tu dah ada." }); return; }
    const next = [...affContacts, { name: nm || em.split("@")[0], email: em }];
    setAffName(""); setAffEmail("");
    void saveAffiliate(affEnabled, next);
  };
  const removeAffContact = (em: string) => void saveAffiliate(affEnabled, affContacts.filter((c) => c.email !== em));

  async function saveWhatsapp() {
    setSavingWA(true);
    setWaMsg(null);
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await sb
        .from("profiles")
        .update({ whatsapp: whatsappVal.trim() || null })
        .eq("id", user.id);
      if (error) throw error;
      setWaMsg({ ok: true, text: "WhatsApp dah update." });
    } catch (e: any) {
      setWaMsg({ ok: false, text: e?.message || "Update failed" });
    } finally {
      setSavingWA(false);
    }
  }

  async function changePassword() {
    setPwMsg(null);
    if (pwNew.length < 8) {
      return setPwMsg({ ok: false, text: "Password baru kena minimum 8 aksara." });
    }
    if (pwNew !== pwNewConfirm) {
      return setPwMsg({ ok: false, text: "Confirm password tak sama." });
    }
    setSavingPw(true);
    try {
      const sb = createClient();
      // Re-authenticate by signing in with old password (verifies before allowing change)
      const { error: reAuthErr } = await sb.auth.signInWithPassword({
        email,
        password: pwOld,
      });
      if (reAuthErr) {
        setPwMsg({ ok: false, text: "Password lama salah." });
        return;
      }
      const { error } = await sb.auth.updateUser({ password: pwNew });
      if (error) throw error;
      setPwOld("");
      setPwNew("");
      setPwNewConfirm("");
      setPwMsg({ ok: true, text: "Password dah tukar. Guna password baru next login." });
    } catch (e: any) {
      setPwMsg({ ok: false, text: e?.message || "Change failed" });
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      {/* Profile card */}
      <section className="card">
        <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[var(--color-border)]">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center"
            style={{
              background: "rgba(255,87,34,0.1)",
              border: "1px solid rgba(255,87,34,0.3)",
            }}
          >
            <User className="w-5 h-5" style={{ color: "var(--color-orange)" }} />
          </div>
          <div>
            <h2 className="font-display font-bold text-xl text-[var(--color-text-primary)]">
              Profile
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              Account info & contact
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              Display name
            </label>
            <input className="input" value={name || ""} readOnly />
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              Email
            </label>
            <input className="input" value={email} readOnly />
          </div>
        </div>
      </section>

      {/* WhatsApp */}
      <section className="card">
        <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[var(--color-border)]">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center"
            style={{
              background: "rgba(34,197,94,0.1)",
              border: "1px solid rgba(34,197,94,0.3)",
            }}
          >
            <MessageCircle className="w-5 h-5" style={{ color: "#22c55e" }} />
          </div>
          <div>
            <h2 className="font-display font-bold text-xl text-[var(--color-text-primary)]">
              WhatsApp
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              Untuk login + support notifications
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <input
            className="input"
            placeholder="+60123456789"
            value={whatsappVal}
            onChange={(e) => setWhatsappVal(e.target.value)}
          />
          {waMsg && (
            <Notice ok={waMsg.ok} text={waMsg.text} />
          )}
          <button
            onClick={saveWhatsapp}
            disabled={savingWA}
            className="btn-primary disabled:opacity-60"
          >
            {savingWA ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save WhatsApp"
            )}
          </button>
        </div>
      </section>

      {/* Affiliate mode — toggle + name/email contacts. Powers the Editor's
          Transfer Affiliate flow + the Transfer Affiliate tab. */}
      <section className="card">
        <div className="flex items-center justify-between gap-3 mb-5 pb-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.3)" }}>
              <Users className="w-5 h-5" style={{ color: "#a78bfa" }} />
            </div>
            <div>
              <h2 className="font-display font-bold text-xl text-[var(--color-text-primary)]">Affiliate</h2>
              <p className="text-xs text-[var(--color-text-muted)]">Transfer video ke affiliate (tag + rekod)</p>
            </div>
          </div>
          <button onClick={() => void saveAffiliate(!affEnabled, affContacts)} disabled={savingAff} className="relative w-12 h-7 rounded-full transition-colors disabled:opacity-60 flex-shrink-0" style={{ background: affEnabled ? "#8b5cf6" : "var(--color-border)" }} title={affEnabled ? "Affiliate mode ON" : "Affiliate mode OFF"}>
            <span className="absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: affEnabled ? "translateX(20px)" : "translateX(0)" }} />
          </button>
        </div>

        {affEnabled ? (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <input className="input flex-1" placeholder="Nama affiliate" value={affName} onChange={(e) => setAffName(e.target.value)} />
              <input className="input flex-1" placeholder="email@affiliate.com" value={affEmail} onChange={(e) => setAffEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addAffContact()} />
              <button onClick={addAffContact} disabled={savingAff} className="btn-primary disabled:opacity-60 whitespace-nowrap">{savingAff ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}</button>
            </div>
            {affMsg && <Notice ok={affMsg.ok} text={affMsg.text} />}
            {affContacts.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">Belum ada affiliate. Tambah nama + email di atas.</p>
            ) : (
              <div className="space-y-2">
                {affContacts.map((c) => (
                  <div key={c.email} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-[var(--color-text-primary)] truncate">{c.name}</div>
                      <div className="text-[11px] text-[var(--color-text-muted)] truncate">{c.email}</div>
                    </div>
                    <button onClick={() => removeAffContact(c.email)} disabled={savingAff} className="text-red-400 hover:text-red-300 disabled:opacity-50 flex-shrink-0" title="Buang affiliate"><X className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)]">Toggle ON untuk aktifkan mode Affiliate — Editor akan ada butang <b>Transfer Affiliate</b>.</p>
        )}
      </section>

      {/* Video Provider card hidden — the 3-tier video cascade (p2 → p1
          → p3 in lib/video-cascade.ts) now auto-falls-back between
          providers on every generation, so the manual user toggle is
          redundant. Save flow + state intentionally kept above in case
          we ever re-expose this UI. */}

      {/* Change password */}
      <section className="card">
        <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[var(--color-border)]">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center"
            style={{
              background: "rgba(124,77,255,0.1)",
              border: "1px solid rgba(124,77,255,0.3)",
            }}
          >
            <Lock className="w-5 h-5" style={{ color: "#a78bfa" }} />
          </div>
          <div>
            <h2 className="font-display font-bold text-xl text-[var(--color-text-primary)]">
              Change Password
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              Ganti password dari yang dihantar via WhatsApp
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              Old password
            </label>
            <input
              type="password"
              className="input"
              value={pwOld}
              onChange={(e) => setPwOld(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
                New password
              </label>
              <input
                type="password"
                className="input"
                value={pwNew}
                onChange={(e) => setPwNew(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
                Confirm new
              </label>
              <input
                type="password"
                className="input"
                value={pwNewConfirm}
                onChange={(e) => setPwNewConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
          {pwMsg && <Notice ok={pwMsg.ok} text={pwMsg.text} />}
          <button
            onClick={changePassword}
            disabled={savingPw || !pwOld || !pwNew}
            className="btn-primary disabled:opacity-60"
          >
            {savingPw ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Updating…
              </>
            ) : (
              "Change Password"
            )}
          </button>
        </div>
      </section>
    </div>
  );
}

function Notice({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div
      className="text-sm rounded-xl px-4 py-3 flex items-start gap-2"
      style={
        ok
          ? {
              color: "var(--color-lime)",
              background: "rgba(200,245,62,0.08)",
              border: "1px solid rgba(200,245,62,0.3)",
            }
          : {
              color: "#fca5a5",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
            }
      }
    >
      {ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
      <span>{text}</span>
    </div>
  );
}
