"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }
    if (!data?.session) {
      // Defence: signInWithPassword resolved without error but no session
      // came back. Treat as a failure so the user gets feedback instead
      // of a silent "form clears + nothing happens".
      setError("Sign in did not return a session. Try again.");
      setLoading(false);
      return;
    }

    // iOS Safari fix — Next.js router.push() is a soft client-side
    // navigation that may run BEFORE Safari has committed the freshly
    // -set auth cookie to disk. The middleware then sees no session
    // cookie on the /dashboard request and redirects right back to
    // /login, which makes the form look like it "cleared itself" with
    // no error shown to the user.
    //
    // window.location.assign() forces a hard full-page navigation —
    // the browser flushes pending cookies first, then issues a fresh
    // GET /dashboard with the session cookie attached. Works reliably
    // on iOS Safari + Chrome on iOS + Android Chrome.
    window.location.assign("/dashboard");
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
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg"
            style={{
              background: "linear-gradient(135deg, #fde047 0%, #facc15 100%)",
              boxShadow: "0 8px 24px rgba(250, 204, 21, 0.35)",
            }}
          >
            <Sparkles className="w-5 h-5 text-black" strokeWidth={2.5} />
          </div>
          <span className="font-display font-extrabold text-2xl tracking-tight">
            PeningLab
          </span>
        </Link>

        <div className="card">
          <h1 className="font-display font-extrabold text-3xl tracking-tight mb-2">
            Welcome back
          </h1>
          <p className="text-[var(--color-text-secondary)] mb-8">
            Sign in untuk teruskan generate UGC viral.
          </p>

          <form onSubmit={handleLogin} className="space-y-5">
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
              <label className="block text-sm font-medium mb-2">Password</label>
              <input
                type="password"
                required
                autoComplete="current-password"
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
                  Signing in...
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-5 text-center">
            <Link
              href="/forgot-password"
              className="text-sm text-[var(--color-text-secondary)] hover:text-orange font-medium"
            >
              Lupa password? Hantar di WhatsApp →
            </Link>
          </div>

          <div className="mt-4 pt-5 border-t border-[var(--color-border)] text-center text-sm text-[var(--color-text-secondary)]">
            Belum ada akaun?{" "}
            <Link
              href="/#checkout"
              className="text-orange font-semibold hover:underline"
            >
              Pilih plan & daftar
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
