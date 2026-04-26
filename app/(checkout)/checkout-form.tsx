"use client";

import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Lock,
  MessageCircle,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

const PLAN = {
  key: "pro" as const,
  name: "Pro Plan",
  price: 75,
  markup: 300,
  desc: "Akses penuh — semua features unlocked",
  rate: "Image 20 sen · Video 40 sen",
  features: [
    "Image AI",
    "Video AI",
    "Unlimited generate",
    "Auto Content + Clone Video + Story Telling",
    "Access Group VIP",
  ],
};

export default function CheckoutForm() {
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [agree, setAgree] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function normalizeWhatsapp(raw: string): string | null {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 13) return null;
    if (digits.startsWith("60")) return "+" + digits;
    if (digits.startsWith("0")) return "+60" + digits.slice(1);
    return "+60" + digits;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Sila masukkan nama anda.");
    const wa = normalizeWhatsapp(whatsapp);
    if (!wa) return setError("WhatsApp number tak valid. Contoh: 0123456789");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return setError("Email tak valid.");
    if (!agree) return setError("Sila tick untuk persetujuan.");

    setLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: PLAN.key,
          name: name.trim(),
          whatsapp: wa,
          email: email.trim().toLowerCase(),
        }),
      });
      const data = await res.json();
      if (data?.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        setError(data?.error || "Failed to start checkout");
        setLoading(false);
      }
    } catch (e: any) {
      setError(e?.message || "Network error");
      setLoading(false);
    }
  }

  return (
    <section
      id="checkout"
      className="relative z-10 mx-auto max-w-3xl px-6 pb-24"
    >
      <div className="text-center mb-10">
        <div className="chip mb-5">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Mula sekarang</span>
        </div>
        <h2 className="section-heading">
          Daftar &amp; bayar{" "}
          <span className="gradient-text-warm">dalam 1 minit.</span>
        </h2>
        <p className="mt-5 text-lg text-[var(--color-text-secondary)] max-w-xl mx-auto">
          Tiada sign-up form berasingan. Isi info di bawah, bayar via FPX —
          akaun anda auto-aktif. Login info dihantar di WhatsApp.
        </p>
      </div>

      <form onSubmit={submit} className="card p-7 md:p-9">
        <div className="rounded-2xl bg-orange-50 border border-orange-200 p-5 mb-6 flex items-center justify-between">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-orange font-bold mb-1">
              {PLAN.name}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-base text-[var(--color-text-muted)] line-through decoration-red-500 decoration-2">
                RM{PLAN.markup}
              </span>
              <span className="font-display font-extrabold text-3xl tracking-tight">
                RM{PLAN.price}
              </span>
              <span className="text-sm text-[var(--color-text-muted)]">
                /bulan
              </span>
            </div>
            <div className="text-[11px] font-mono text-orange font-bold uppercase tracking-wider mt-1">
              {PLAN.rate}
            </div>
          </div>
          <div className="text-right text-xs text-[var(--color-text-muted)]">
            <div className="font-bold text-[var(--color-text-primary)]">
              Auto-renew
            </div>
            <div>Cancel bila-bila</div>
          </div>
        </div>

        <div className="space-y-4 mb-5">
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
              No WhatsApp{" "}
              <span className="text-[var(--color-text-muted)] text-xs font-normal">
                (untuk login + support)
              </span>
            </label>
            <div className="flex items-stretch w-full bg-white border border-[var(--color-border)] rounded-[14px] overflow-hidden focus-within:border-[var(--color-orange)] focus-within:shadow-[0_0_0_3px_rgba(255,107,53,0.12)] transition-all">
              <div className="flex items-center justify-center px-4 text-sm font-semibold text-[var(--color-text-secondary)] bg-[var(--color-bg-soft,#faf7f2)] border-r border-[var(--color-border)] select-none">
                +60
              </div>
              <input
                type="tel"
                required
                inputMode="tel"
                autoComplete="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="123456789"
                className="flex-1 min-w-0 bg-transparent border-0 outline-none px-4 py-[14px] text-[15px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
              />
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mt-1.5 flex items-start gap-1.5">
              <MessageCircle className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <span>
                Login info akan dihantar di WhatsApp anda lepas pembayaran
                berjaya.
              </span>
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

          <label className="flex items-start gap-2.5 text-sm text-[var(--color-text-secondary)] cursor-pointer select-none pt-1">
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-orange-500"
            />
            <span>
              Saya bersetuju dengan{" "}
              <a href="#" className="text-orange font-semibold underline">
                Terms
              </a>{" "}
              dan{" "}
              <a href="#" className="text-orange font-semibold underline">
                Privacy Policy
              </a>
              .
            </span>
          </label>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4">
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
              Redirecting to Chip…
            </>
          ) : (
            <>
              <Lock className="w-4 h-4" />
              Bayar RM{PLAN.price} via Online Banking
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-[var(--color-text-muted)]">
          <div className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Secured via Chip Payment</span>
          </div>
          <div className="flex items-center gap-1">
            <Lock className="w-3.5 h-3.5 text-emerald-500" />
            <span>FPX online banking</span>
          </div>
        </div>
      </form>
    </section>
  );
}
