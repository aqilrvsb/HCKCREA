"use client";

import {
  CheckCircle2,
  Sparkles,
  Crown,
  Rocket,
  Zap,
  ArrowRight,
  Calendar,
  ShieldCheck,
} from "lucide-react";

const PLANS = [
  {
    key: "starter",
    name: "Starter",
    price: "RM47",
    period: "/bulan",
    credits: 100,
    desc: "Untuk seller mula auto-UGC",
    icon: Zap,
    accent: "blue",
    features: [
      "~25 video 8 saat",
      "Auto Content + Clone mode",
      "Caption Bahasa Melayu auto",
      "Email support",
    ],
  },
  {
    key: "growth",
    name: "Growth",
    price: "RM147",
    period: "/bulan",
    credits: 350,
    desc: "Untuk seller serius scaling",
    icon: Rocket,
    accent: "violet",
    features: [
      "~85 video 8 saat",
      "Priority generation queue",
      "Custom CTA setiap batch",
      "Auto-post TikTok scheduler",
      "WhatsApp support",
    ],
    popular: true,
  },
  {
    key: "empire",
    name: "Empire",
    price: "RM397",
    period: "/bulan",
    credits: 1000,
    desc: "Untuk team / agency",
    icon: Crown,
    accent: "amber",
    features: [
      "~250 video 8 saat",
      "Multi-account access",
      "Dedicated account manager",
      "API access (coming)",
    ],
  },
];

const ACCENT_MAP: Record<string, { bg: string; text: string; border: string; gradient: string }> = {
  blue: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
    gradient: "from-blue-500 to-cyan-500",
  },
  violet: {
    bg: "bg-violet-50",
    text: "text-violet-700",
    border: "border-violet-200",
    gradient: "from-violet-500 via-fuchsia-500 to-pink-500",
  },
  amber: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    gradient: "from-amber-500 to-orange-500",
  },
};

export default function BillingSection() {
  const currentPlan = "starter"; // TODO: read from profile
  const renewalDate = "9 Jun 2026";

  return (
    <div className="space-y-6">
      {/* Current plan hero — bold gradient card */}
      <div
        className="relative overflow-hidden rounded-3xl p-8 md:p-10"
        style={{
          background:
            "linear-gradient(135deg, #4c1d95 0%, #6d28d9 40%, #8b5cf6 100%)",
        }}
      >
        <div
          className="absolute"
          style={{
            top: -100,
            right: -100,
            width: 400,
            height: 400,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(236, 72, 153, 0.4), transparent 70%)",
            filter: "blur(60px)",
          }}
        />
        <div
          className="absolute"
          style={{
            bottom: -80,
            left: -80,
            width: 300,
            height: 300,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(59, 130, 246, 0.4), transparent 70%)",
            filter: "blur(50px)",
          }}
        />

        <div className="relative grid md:grid-cols-2 gap-8 items-center">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-5 rounded-full bg-white/15 border border-white/20 backdrop-blur-md text-xs font-bold uppercase tracking-wider text-white">
              <Sparkles className="w-3 h-3" />
              Current Plan
            </div>
            <h2 className="font-display font-extrabold text-5xl md:text-6xl tracking-tight text-white mb-3">
              Starter
            </h2>
            <p className="text-white/80 text-lg mb-6">
              Active subscription · Renews {renewalDate}
            </p>
            <div className="flex flex-wrap gap-3">
              <button className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-[var(--color-text-primary)] font-bold text-sm shadow-lg hover:scale-105 transition">
                Upgrade plan
                <ArrowRight className="w-4 h-4" />
              </button>
              <button className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white/10 border border-white/20 text-white font-semibold text-sm hover:bg-white/15 transition backdrop-blur-md">
                Cancel subscription
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl p-5 bg-white/10 border border-white/15 backdrop-blur-md">
              <div className="text-xs uppercase tracking-wider text-white/60 font-bold mb-1.5">
                Renewal
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-white/80" />
                <span className="text-white font-semibold text-sm">
                  {renewalDate}
                </span>
              </div>
            </div>
            <div className="rounded-2xl p-5 bg-white/10 border border-white/15 backdrop-blur-md">
              <div className="text-xs uppercase tracking-wider text-white/60 font-bold mb-1.5">
                Status
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-white font-semibold text-sm">Active</span>
              </div>
            </div>
            <div className="rounded-2xl p-5 bg-white/10 border border-white/15 backdrop-blur-md col-span-2">
              <div className="text-xs uppercase tracking-wider text-white/60 font-bold mb-1.5">
                Monthly credits
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-white font-display font-extrabold text-3xl">
                  100
                </span>
                <span className="text-white/60 text-sm">credits / month</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Plan options */}
      <div>
        <div className="flex items-end justify-between mb-5">
          <div>
            <h3 className="font-display font-extrabold text-2xl tracking-tight">
              Available plans
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              Tukar bila-bila. Pro-rated billing.
            </p>
          </div>
          <div className="hidden md:flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            30-day money back
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {PLANS.map((plan) => {
            const Icon = plan.icon;
            const a = ACCENT_MAP[plan.accent];
            const isCurrent = currentPlan === plan.key;
            return (
              <div
                key={plan.key}
                className={`relative card overflow-hidden ${
                  plan.popular ? "border-2 border-violet-300" : ""
                }`}
              >
                {plan.popular && (
                  <div className="absolute top-0 right-0 px-3 py-1 text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-violet-500 to-blue-500 text-white rounded-bl-2xl">
                    Popular
                  </div>
                )}

                {/* Decorative gradient blob */}
                <div
                  className="absolute"
                  style={{
                    top: -60,
                    right: -60,
                    width: 200,
                    height: 200,
                    borderRadius: "50%",
                    background: `radial-gradient(circle, ${
                      plan.accent === "violet"
                        ? "rgba(139,92,246,0.18)"
                        : plan.accent === "blue"
                        ? "rgba(59,130,246,0.15)"
                        : "rgba(245,158,11,0.15)"
                    }, transparent 70%)`,
                  }}
                />

                <div className="relative">
                  <div className="flex items-center gap-3 mb-5">
                    <div
                      className={`w-11 h-11 rounded-2xl ${a.bg} ${a.border} border flex items-center justify-center`}
                    >
                      <Icon className={`w-5 h-5 ${a.text}`} strokeWidth={2.2} />
                    </div>
                    <div>
                      <h4 className="font-display font-bold text-xl">
                        {plan.name}
                      </h4>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {plan.desc}
                      </p>
                    </div>
                  </div>

                  <div className="mb-5">
                    <div className="flex items-baseline gap-1">
                      <span className="font-display font-extrabold text-4xl tracking-tight">
                        {plan.price}
                      </span>
                      <span className="text-[var(--color-text-muted)] text-sm">
                        {plan.period}
                      </span>
                    </div>
                    <div
                      className={`text-sm font-bold mt-1 ${a.text}`}
                    >
                      {plan.credits} credits / month
                    </div>
                  </div>

                  <ul className="space-y-2.5 mb-6">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                        <span className="text-[var(--color-text-secondary)]">
                          {f}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <button
                    disabled={isCurrent}
                    className={`w-full py-3 rounded-full font-bold text-sm transition ${
                      isCurrent
                        ? "bg-gray-100 text-gray-400 cursor-default"
                        : plan.popular
                        ? `text-white bg-gradient-to-r ${a.gradient} hover:scale-[1.02] shadow-lg`
                        : "bg-white border border-[var(--color-border)] hover:border-violet-300"
                    }`}
                  >
                    {isCurrent ? "Current Plan" : `Pilih ${plan.name}`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Payment history */}
      <div>
        <h3 className="font-display font-extrabold text-2xl tracking-tight mb-5">
          Payment history
        </h3>
        <div className="card p-0 overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--color-border)] bg-gray-50/50 flex items-center text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
            <span className="flex-1">Date</span>
            <span className="flex-1">Plan</span>
            <span className="flex-1">Amount</span>
            <span className="w-24 text-right">Status</span>
          </div>
          <div className="px-6 py-16 text-center">
            <p className="text-[var(--color-text-secondary)] font-medium">
              Tiada payment history lagi.
            </p>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              Subscribe pertama kali, transaction akan muncul di sini.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
