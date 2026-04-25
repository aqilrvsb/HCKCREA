"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowRight, Loader2, CheckCircle2, Sparkles } from "lucide-react";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function normalizeWhatsapp(raw: string): string | null {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 13) return null;
    if (digits.startsWith("60")) return "+" + digits;
    if (digits.startsWith("0")) return "+60" + digits.slice(1);
    return "+60" + digits;
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!name.trim()) {
      setError("Sila masukkan nama anda.");
      setLoading(false);
      return;
    }

    const wa = normalizeWhatsapp(whatsapp);
    if (!wa) {
      setError("WhatsApp number tak valid. Contoh: 0123456789");
      setLoading(false);
      return;
    }

    if (password.length < 8) {
      setError("Password minimum 8 characters.");
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          full_name: name.trim(),
          whatsapp: wa,
        },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
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
        <Link href="/" className="flex items-center gap-2.5 justify-center mb-8">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 via-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/30">
            <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-display font-extrabold text-2xl tracking-tight">
            PeningLab
          </span>
        </Link>

        {success ? (
          <div className="card text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-5">
              <CheckCircle2 className="w-7 h-7 text-emerald-600" />
            </div>
            <h1 className="font-display font-extrabold text-2xl mb-3">
              Check email anda
            </h1>
            <p className="text-[var(--color-text-secondary)] mb-2">
              Kami dah hantar verification link ke
            </p>
            <p className="text-[var(--color-text-primary)] font-semibold mb-6 break-all">
              {email}
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">
              Klik link tu untuk activate akaun anda dan dapat 10 kredit free.
            </p>
            <Link
              href="/login"
              className="btn-secondary mt-6 inline-flex w-full justify-center"
            >
              Kembali ke Sign In
            </Link>
          </div>
        ) : (
          <div className="card">
            <h1 className="font-display font-extrabold text-3xl tracking-tight mb-2">
              Mula percuma
            </h1>
            <p className="text-[var(--color-text-secondary)] mb-2">
              Daftar dapat{" "}
              <span className="text-[var(--color-accent-violet)] font-semibold">
                10 kredit free
              </span>{" "}
              — cukup untuk 2 video.
            </p>
            <p className="text-sm text-[var(--color-text-muted)] mb-7">
              Tak perlu credit card.
            </p>

            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2">
                  Nama penuh
                </label>
                <input
                  type="text"
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Aqil Hakim"
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">
                  WhatsApp No
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-muted)] font-medium pointer-events-none">
                    🇲🇾 +60
                  </span>
                  <input
                    type="tel"
                    required
                    inputMode="tel"
                    autoComplete="tel"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder="123456789"
                    className="input pl-[72px]"
                  />
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mt-1.5">
                  Untuk support + notifikasi pesanan kredit.
                </p>
              </div>

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
                  Password{" "}
                  <span className="text-[var(--color-text-muted)] text-xs font-normal">
                    (min 8 characters)
                  </span>
                </label>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input"
                />
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
                    Creating account...
                  </>
                ) : (
                  <>
                    Daftar percuma
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 text-center text-sm text-[var(--color-text-secondary)]">
              Dah ada akaun?{" "}
              <Link
                href="/login"
                className="text-[var(--color-accent-violet)] font-semibold hover:underline"
              >
                Sign in
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
