"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Lock,
  MessageCircle,
  QrCode,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  PLAN_KEYS,
  PLAN_DEFAULTS,
  BEST_SELLER,
  isPlanKey,
  type PlanKey,
} from "@/lib/plans";

// Storage key shared with PricingTiersGrid — clicking Subscribe on a
// pricing card writes the chosen plan here, dispatches a custom event,
// and scrolls to #checkout. This form picks the value up so the user
// lands with the right tier pre-selected.
const SELECTED_PLAN_STORAGE_KEY = "peninglab:selected-plan";
const PLAN_CHANGE_EVENT = "peninglab:plan-changed";

export default function CheckoutForm() {
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>(BEST_SELLER);
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [agree, setAgree] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial read + cross-component listener — when a pricing card up
  // top is clicked, it writes to sessionStorage and dispatches the
  // PLAN_CHANGE_EVENT. We update state in response so the radio + the
  // button price reflect the latest selection without a full page nav.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const readStored = () => {
      try {
        const v = sessionStorage.getItem(SELECTED_PLAN_STORAGE_KEY);
        if (v && isPlanKey(v)) setSelectedPlan(v);
      } catch {
        // sessionStorage blocked — keep default selection.
      }
    };
    readStored();
    window.addEventListener(PLAN_CHANGE_EVENT, readStored);
    return () => window.removeEventListener(PLAN_CHANGE_EVENT, readStored);
  }, []);

  function normalizeWhatsapp(raw: string): string | null {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 13) return null;
    if (digits.startsWith("60")) return "+" + digits;
    if (digits.startsWith("0")) return "+60" + digits.slice(1);
    return "+60" + digits;
  }

  function sanitizeWhatsappInput(raw: string): string {
    let v = raw.replace(/\D/g, "");
    while (v.startsWith("60")) v = v.slice(2);
    while (v.startsWith("0")) v = v.slice(1);
    if (v.length > 10) v = v.slice(0, 10);
    return v;
  }

  function pickPlan(key: PlanKey) {
    setSelectedPlan(key);
    try {
      sessionStorage.setItem(SELECTED_PLAN_STORAGE_KEY, key);
    } catch {
      // Non-fatal — UI still works without persistence.
    }
  }

  const cfg = PLAN_DEFAULTS[selectedPlan];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Sila masukkan nama anda.");
    const wa = normalizeWhatsapp(whatsapp);
    if (!wa) return setError("WhatsApp number tak valid. Contoh: 0123456789");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return setError("Email tak valid.");
    if (!agree) return setError("Sila tick untuk persetujuan.");

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
      // Cookie missing/corrupt — proceed without UTM.
    }

    setLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: selectedPlan,
          name: name.trim(),
          whatsapp: wa,
          email: email.trim().toLowerCase(),
          utm: utmPayload,
        }),
      });
      const data = await res.json();
      if (data?.checkout_url) {
        try {
          (window as any).fbq?.(
            "track",
            "InitiateCheckout",
            { value: cfg.price, currency: "MYR", content_name: cfg.label + " Plan" },
            { eventID: data.payment_id || `ic-${Date.now()}` }
          );
        } catch {
          // Pixel not loaded / blocked — non-critical.
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
          Tiada sign-up form berasingan. Pilih plan, isi info di bawah, bayar
          via FPX (online banking) atau DuitNow QR — akaun anda auto-aktif.
          Login info dihantar di WhatsApp.
        </p>
      </div>

      <form onSubmit={submit} className="card p-7 md:p-9">
        {/* Plan selector — 4 radio cards. Pre-populated from the
            pricing grid pick when user clicked Subscribe on a tier. */}
        <div className="mb-6">
          <label className="block text-sm font-semibold mb-3">
            Pilih plan
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {/* Starter + Standard retired from sale (2026-07-28) — only
                Pro / Premium / Livehost are purchasable. */}
            {PLAN_KEYS.filter((k) => k !== "starter" && k !== "standard").map((key) => {
              const p = PLAN_DEFAULTS[key];
              const active = selectedPlan === key;
              const highlight = key === BEST_SELLER;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => pickPlan(key)}
                  className="relative rounded-xl px-3 py-3 text-left transition-transform hover:-translate-y-0.5"
                  style={{
                    background: active
                      ? "rgba(250, 204, 21, 0.10)"
                      : "var(--color-bg-card)",
                    border: `2px solid ${
                      active
                        ? "rgba(250, 204, 21, 0.75)"
                        : highlight
                          ? "rgba(250, 204, 21, 0.35)"
                          : "var(--color-border)"
                    }`,
                  }}
                >
                  {highlight && (
                    <div
                      className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-widest whitespace-nowrap"
                      style={{
                        background:
                          "linear-gradient(90deg, #facc15 0%, #eab308 100%)",
                        color: "#000",
                      }}
                    >
                      ★ Best
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 mb-1">
                    <div
                      className="w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{
                        border: `2px solid ${
                          active ? "#eab308" : "var(--color-text-muted)"
                        }`,
                        background: active ? "#eab308" : "transparent",
                      }}
                    >
                      {active && (
                        <CheckCircle2
                          className="w-2 h-2 text-black"
                          strokeWidth={3}
                        />
                      )}
                    </div>
                    <span className="text-[10px] uppercase tracking-wider font-bold">
                      {p.label}
                    </span>
                  </div>
                  <div className="font-display font-extrabold text-lg leading-none">
                    RM{p.price}
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                    + RM{p.credits} credits
                  </div>
                </button>
              );
            })}
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
              Bayar RM{cfg.price} ({cfg.label}) — FPX / DuitNow QR
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
          <div className="flex items-center gap-1">
            <QrCode className="w-3.5 h-3.5 text-emerald-500" />
            <span>DuitNow QR</span>
          </div>
        </div>
      </form>
    </section>
  );
}
