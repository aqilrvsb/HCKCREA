"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Loader2,
  Sparkles,
  MessageCircle,
  CheckCircle2,
} from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), whatsapp }),
      });
      const data = await res.json();
      if (data?.ok) {
        setSent(true);
      } else {
        setError(data?.error || "Failed to send recovery");
      }
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-6 py-12 overflow-hidden">
      <div className="bg-sky" />
      <div
        className="bg-soft-glow"
        style={{
          background: "radial-gradient(circle, #ffd4b8, transparent 70%)",
          width: 500,
          height: 500,
          top: -150,
          right: -100,
        }}
      />

      <div className="relative z-10 w-full max-w-md">
        <Link
          href="/"
          className="flex items-center gap-2.5 justify-center mb-8"
        >
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 via-orange-500 to-orange-600 flex items-center justify-center shadow-lg">
            <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-display font-extrabold text-2xl tracking-tight">
            PeningLab
          </span>
        </Link>

        {sent ? (
          <div className="card text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-5">
              <CheckCircle2 className="w-7 h-7 text-emerald-600" />
            </div>
            <h1 className="font-display font-extrabold text-2xl mb-3">
              Check WhatsApp anda
            </h1>
            <p className="text-[var(--color-text-secondary)] mb-2">
              Jika email + WhatsApp anda padan dengan record kami, kami akan
              hantar login info baru di WhatsApp.
            </p>
            <p className="text-sm text-[var(--color-text-muted)] mb-6">
              Tunggu 1–2 minit. Tak dapat? Pastikan WhatsApp betul.
            </p>
            <Link href="/login" className="btn-secondary inline-flex w-full justify-center">
              Kembali ke Sign In
            </Link>
          </div>
        ) : (
          <div className="card">
            <h1 className="font-display font-extrabold text-3xl tracking-tight mb-2">
              Lupa password?
            </h1>
            <p className="text-[var(--color-text-secondary)] mb-6">
              Isi email + WhatsApp anda. Kami akan hantar login info baru di
              WhatsApp dalam 1 minit.
            </p>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2">Email</label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="aqil@example.com"
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">
                  No WhatsApp{" "}
                  <span className="text-[var(--color-text-muted)] text-xs font-normal">
                    (yang anda daftar)
                  </span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-muted)] font-medium pointer-events-none">
                    🇲🇾 +60
                  </span>
                  <input
                    type="tel"
                    required
                    inputMode="tel"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder="123456789"
                    className="input pl-[72px]"
                  />
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mt-1.5 flex items-start gap-1.5">
                  <MessageCircle className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <span>
                    Mesti sama dengan WhatsApp yang digunakan masa daftar.
                  </span>
                </p>
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Memproses…
                  </>
                ) : (
                  <>
                    Hantar login info
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 text-center text-sm text-[var(--color-text-secondary)]">
              Ingat password?{" "}
              <Link
                href="/login"
                className="text-orange font-semibold hover:underline"
              >
                Kembali sign in
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
