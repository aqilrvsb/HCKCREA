"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ArrowRight, Loader2, CheckCircle2, Sparkles } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

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
    <div className="relative min-h-screen flex items-center justify-center px-6 overflow-hidden">
      <div className="bg-aurora" />
      <div className="grain" />

      <div className="relative z-10 w-full max-w-md">
        <Link
          href="/"
          className="flex items-center gap-2.5 justify-center mb-10"
        >
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-400 via-violet-500 to-blue-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
            <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-display font-extrabold text-2xl tracking-tight">
            PeningLab
          </span>
        </Link>

        {success ? (
          <div className="card text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-[rgba(34,224,138,0.1)] border border-[rgba(34,224,138,0.3)] flex items-center justify-center mb-5">
              <CheckCircle2 className="w-7 h-7 text-[var(--color-success)]" />
            </div>
            <h1 className="font-display font-extrabold text-2xl mb-3">
              Check email anda
            </h1>
            <p className="text-[var(--color-text-secondary)] mb-2">
              Kami dah hantar verification link ke
            </p>
            <p className="text-white font-semibold mb-6">{email}</p>
            <p className="text-sm text-[var(--color-text-muted)]">
              Klik link tu untuk activate akaun anda dan dapat 10 kredit free.
            </p>
          </div>
        ) : (
          <div className="card">
            <h1 className="font-display font-extrabold text-3xl tracking-tight mb-2">
              Mula percuma
            </h1>
            <p className="text-[var(--color-text-secondary)] mb-2">
              Daftar dapat <span className="text-[var(--color-accent-violet)] font-semibold">10 kredit free</span> — cukup untuk 2 video.
            </p>
            <p className="text-sm text-[var(--color-text-muted)] mb-8">
              Tak perlu credit card.
            </p>

            <form onSubmit={handleRegister} className="space-y-5">
              <div>
                <label className="block text-sm font-medium mb-2">Email</label>
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
                <label className="block text-sm font-medium mb-2">
                  Password{" "}
                  <span className="text-[var(--color-text-muted)] text-xs">
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
                <div className="text-sm text-[var(--color-danger)] bg-[rgba(255,71,87,0.1)] border border-[rgba(255,71,87,0.2)] rounded-lg px-4 py-3">
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
