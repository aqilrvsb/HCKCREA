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

const PLANS = [
  {
    key: "light",
    name: "Light Plan",
    price: 35,
    desc: "Test & explore ringan",
    rate: "Image 50 sen · Video 70 sen",
    features: [
      "Image (Banana Pro + GPT Image 2)",
      "Video Veo 3.1",
      "Unlimited generate",
      "Access Prompt / Image / Video",
    ],
  },
  {
    key: "pro",
    name: "Pro Plan",
    price: 75,
    desc: "Untuk seller serius nak scale",
    rate: "Image 20 sen · Video 40 sen",
    badge: "Paling popular",
    features: [
      "Image (Banana Pro + GPT Image 2)",
      "Video Veo 3.1",
      "Unlimited generate",
      "Auto Content + Clone Video + Story Telling",
      "Access Group VIP",
    ],
  },
];

export default function CheckoutForm() {
  const [plan, setPlan] = useState<"light" | "pro">("pro");
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
          plan,
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

  const selected = PLANS.find((p) => p.key === plan)!;

  return (
    <section
      id="checkout"
      className="relative z-10 mx-auto max-w-6xl px-6 py-24"
    >
      <div className="text-center mb-12">
        <div className="chip mb-5">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Mula sekarang</span>
        </div>
        <h2 className="section-heading">
          Daftar &amp; bayar{" "}
          <span className="gradient-text-warm">dalam 1 minit.</span>
        </h2>
        <p className="mt-5 text-lg text-[var(--color-text-secondary)] max-w-2xl mx-auto">
          Tak perlu sign-up dahulu. Pilih plan, isi info, bayar via online banking
          — akaun anda auto-aktif lepas pembayaran berjaya.
        </p>
      </div>

      <div className="grid lg:grid-cols-5 gap-5">
        {/* Plan picker */}
        <div className="lg:col-span-2 space-y-3">
          {PLANS.map((p) => {
            const isSelected = plan === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setPlan(p.key as any)}
                className={`relative w-full text-left rounded-3xl p-6 border-2 transition-all ${
                  isSelected
                    ? "border-orange-400 bg-gradient-to-br from-orange-50 via-white to-orange-50 shadow-xl shadow-orange-500/15"
                    : "border-[var(--color-border)] bg-white hover:border-orange-200"
                }`}
              >
                {p.badge && (
                  <div className="absolute -top-2 right-4 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-md shadow-md">
                    {p.badge}
                  </div>
                )}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 className="font-display font-extrabold text-2xl tracking-tight">
                      {p.name}
                    </h3>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {p.desc}
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${
                        isSelected
                          ? "border-orange-500 bg-orange-500"
                          : "border-gray-300 bg-white"
                      }`}
                    >
                      {isSelected && (
                        <div className="w-2 h-2 rounded-full bg-white" />
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="font-display font-extrabold text-3xl tracking-tight">
                    RM{p.price}
                  </span>
                  <span className="text-[var(--color-text-muted)] text-sm">
                    /bulan
                  </span>
                </div>
                <div className="text-xs font-mono text-orange font-bold mb-3 tracking-wider uppercase">
                  {p.rate}
                </div>
                <ul className="space-y-1.5">
                  {p.features.map((f, j) => (
                    <li
                      key={j}
                      className="flex items-start gap-2 text-xs text-[var(--color-text-secondary)]"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        {/* Form */}
        <div className="lg:col-span-3">
          <form onSubmit={submit} className="card p-7 md:p-9">
            <h3 className="font-display font-extrabold text-2xl tracking-tight mb-2">
              Maklumat akaun
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-7">
              Lepas bayar, login info akan dihantar di WhatsApp dalam 1 minit.
            </p>

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
                <p className="text-xs text-[var(--color-text-muted)] mt-1.5 flex items-start gap-1.5">
                  <MessageCircle className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <span>
                    Login info akan disent di WhatsApp anda lepas pembayaran
                    berjaya.
                  </span>
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">
                  Email
                </label>
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

            <div className="rounded-2xl bg-orange-50 border border-orange-100 p-4 mb-5 flex items-center justify-between">
              <div>
                <div className="text-xs text-[var(--color-text-muted)] font-mono uppercase tracking-wider">
                  Bayar sekarang
                </div>
                <div className="font-display font-extrabold text-2xl tracking-tight">
                  RM{selected.price}
                  <span className="text-sm font-normal text-[var(--color-text-muted)] ml-1">
                    / bulan
                  </span>
                </div>
              </div>
              <div className="text-right text-xs text-[var(--color-text-muted)]">
                <div className="font-bold text-[var(--color-text-primary)]">
                  {selected.name}
                </div>
                <div>Auto-renew bulanan</div>
              </div>
            </div>

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
                  Bayar RM{selected.price} via Online Banking
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
                <span>FPX online banking sahaja</span>
              </div>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
