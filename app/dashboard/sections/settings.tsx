"use client";

import { useState } from "react";
import { Lock, MessageCircle, Loader2, CheckCircle2, AlertCircle, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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
