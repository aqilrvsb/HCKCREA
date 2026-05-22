"use client";

import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Loader2,
  Lock,
  MessageCircle,
  QrCode,
  ShieldCheck,
  Sparkles,
  Wallet,
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

  // Sanitiser for the visible input — the +60 country code is rendered as
  // a locked prefix, so the user is only typing the local part. Strip:
  //   • any non-digit char (including "+", spaces, dashes)
  //   • a leading "60" (full international prefix re-typed by mistake)
  //   • a leading "0"  (national-format zero — Malaysian "012…" → "12…")
  // After sanitising, cap to 10 digits — Malaysian mobile local part is
  // 9-10 digits; allowing more would always fail normalizeWhatsapp anyway.
  function sanitizeWhatsappInput(raw: string): string {
    let v = raw.replace(/\D/g, "");
    while (v.startsWith("60")) v = v.slice(2);
    while (v.startsWith("0")) v = v.slice(1);
    if (v.length > 10) v = v.slice(0, 10);
    return v;
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

    // Read peninglab_utm cookie (set by FBPixel when visitor landed
    // from an ad link). Attached to the checkout request so the payment
    // row gets UTM-attributed for /admin/ads reporting.
    let utmPayload: Record<string, any> | null = null;
    try {
      const match = document.cookie
        .split("; ")
        .find((c) => c.startsWith("peninglab_utm="));
      if (match) {
        const raw = decodeURIComponent(match.split("=")[1] || "");
        const parsed = JSON.parse(raw);
        if (parsed && parsed.source) utmPayload = parsed;
      }
    } catch {
      // Cookie missing/corrupt — proceed without UTM. Payment will be
      // recorded as organic (no attribution) which is correct behaviour.
    }

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
          utm: utmPayload,
        }),
      });
      const data = await res.json();
      if (data?.checkout_url) {
        // Fire Facebook Pixel InitiateCheckout BEFORE redirecting to
        // Chip. Lets Meta build retargeting audiences of users who
        // started but didn't finish payment. payment_id is the
        // event_id — same id will be reused for the Purchase event on
        // success so Meta dedupes browser + server CAPI events into one.
        try {
          (window as any).fbq?.(
            "track",
            "InitiateCheckout",
            { value: PLAN.price, currency: "MYR", content_name: PLAN.name },
            { eventID: data.payment_id || `ic-${Date.now()}` }
          );
        } catch {
          // Pixel not loaded / blocked — non-critical, ignore.
        }
        window.location.href = data.checkout_url;
      } else {
        const detail = data?.detail ? ` — ${data.detail}` : "";
        setError(`${data?.error || "Failed to start checkout"}${detail}`);
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
          Tiada sign-up form berasingan. Isi info di bawah, bayar via FPX,
          Credit/Debit Card, DuitNow QR atau e-Wallet — akaun anda auto-aktif.
          Login info dihantar di WhatsApp.
        </p>
      </div>

      <form onSubmit={submit} className="card p-7 md:p-9">
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
            <div className="flex items-stretch w-full bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-[14px] overflow-hidden focus-within:border-[var(--color-orange)] focus-within:shadow-[0_0_0_3px_rgba(255,107,53,0.12)] transition-all">
              <div className="flex items-center justify-center px-4 text-sm font-semibold text-[var(--color-text-secondary)] bg-[var(--color-bg)] border-r border-[var(--color-border)] select-none">
                +60
              </div>
              <input
                type="tel"
                required
                inputMode="numeric"
                autoComplete="tel"
                maxLength={10}
                value={whatsapp}
                onChange={(e) => setWhatsapp(sanitizeWhatsappInput(e.target.value))}
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
              Bayar RM{PLAN.price} — Pilih method di Chip
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-[var(--color-text-muted)]">
          <div className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Secured via Chip Payment</span>
          </div>
          <div className="flex items-center gap-1">
            <Lock className="w-3.5 h-3.5 text-emerald-500" />
            <span>FPX</span>
          </div>
          <div className="flex items-center gap-1">
            <CreditCard className="w-3.5 h-3.5 text-emerald-500" />
            <span>Visa / Mastercard</span>
          </div>
          <div className="flex items-center gap-1">
            <QrCode className="w-3.5 h-3.5 text-emerald-500" />
            <span>DuitNow QR</span>
          </div>
          <div className="flex items-center gap-1">
            <Wallet className="w-3.5 h-3.5 text-emerald-500" />
            <span>e-Wallet</span>
          </div>
        </div>
      </form>
    </section>
  );
}
