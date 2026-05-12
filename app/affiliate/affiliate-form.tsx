"use client";

import { useState } from "react";
import { Loader2, CheckCircle2, ArrowRight } from "lucide-react";

export default function AffiliateForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Nama diperlukan");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return setError("Email tidak sah");
    if (whatsapp.replace(/\D/g, "").length < 9)
      return setError("Nombor WhatsApp tidak sah");

    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/affiliate/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), whatsapp: whatsapp.trim() }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        setError(d?.error || "Pendaftaran gagal");
        return;
      }
      setDone(true);
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div
        className="rounded-2xl p-8 text-center"
        style={{
          background: "rgba(16,185,129,0.08)",
          border: "1px solid rgba(16,185,129,0.4)",
        }}
      >
        <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-emerald-500" />
        <h3 className="font-display font-extrabold text-xl mb-2 text-emerald-700">
          Aplikasi diterima!
        </h3>
        <p className="text-sm text-emerald-800">
          Admin akan review dan WhatsApp anda dengan login details dalam masa{" "}
          <strong>24 jam</strong>. Sila stay tuned.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="block text-xs font-bold text-white/80 mb-1.5">
          Nama Penuh
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 120))}
          placeholder="Aqil Ahmad"
          required
          className="w-full px-4 py-3 rounded-xl text-sm outline-none transition focus:ring-2 focus:ring-orange-400"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "white",
          }}
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-white/80 mb-1.5">
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value.slice(0, 120))}
          placeholder="aqil@example.com"
          required
          className="w-full px-4 py-3 rounded-xl text-sm outline-none transition focus:ring-2 focus:ring-orange-400"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "white",
          }}
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-white/80 mb-1.5">
          WhatsApp
        </label>
        <input
          type="tel"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value.slice(0, 20))}
          placeholder="012-3456789"
          required
          className="w-full px-4 py-3 rounded-xl text-sm outline-none transition focus:ring-2 focus:ring-orange-400"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "white",
          }}
        />
        <p className="text-[10px] text-white/50 mt-1">
          Login details akan dihantar ke WhatsApp ini selepas admin approve.
        </p>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-4 rounded-xl font-extrabold text-base text-white inline-flex items-center justify-center gap-2 transition hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
        style={{
          background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
          boxShadow:
            "0 8px 24px rgba(249,115,22,0.45), inset 0 1px 0 rgba(255,255,255,0.2)",
        }}
      >
        {submitting ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Menghantar...
          </>
        ) : (
          <>
            Daftar Affiliate <ArrowRight className="w-5 h-5" />
          </>
        )}
      </button>

      {error && (
        <div
          className="px-4 py-3 rounded-xl text-sm font-semibold"
          style={{
            background: "rgba(244,67,54,0.15)",
            border: "1px solid rgba(244,67,54,0.4)",
            color: "#fca5a5",
          }}
        >
          {error}
        </div>
      )}

      <p className="text-[10px] text-white/50 text-center pt-1">
        Dengan daftar, anda setuju dengan terma program affiliate.
      </p>
    </form>
  );
}
