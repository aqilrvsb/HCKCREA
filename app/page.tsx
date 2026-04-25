"use client";

import Link from "next/link";
import {
  Sparkles,
  ArrowRight,
  Clock,
  Wallet,
  Camera,
  CheckCircle2,
  PlayCircle,
  Users,
  TrendingUp,
  Layers,
  Wand2,
  Zap,
  Star,
  ShieldCheck,
} from "lucide-react";

const PAIN_POINTS = [
  {
    icon: Camera,
    title: "Tiada team videographer",
    desc: "Tak ada equipment, tak ada talent UGC. Setiap kali nak buat video, kena cari freelancer baru.",
  },
  {
    icon: Clock,
    title: "Buang masa berhari-hari",
    desc: "Satu video 8 saat boleh ambil 1 hari penuh — script, shoot, edit. 30 video sebulan? Burnout.",
  },
  {
    icon: Wallet,
    title: "Bayar creator mahal",
    desc: "RM200–RM500 satu video. 30 video = RM15,000 sebulan. Margin produk anda kena hambat.",
  },
];

const FEATURES = [
  {
    icon: Wand2,
    badge: "Auto Content",
    title: "10 video UGC dalam satu klik",
    desc: "Letak link produk TikTok Shop. AI Director kami susun 10 video — framework, hook, dan CTA berbeza setiap satu. Optimized untuk pasaran Bahasa Melayu.",
    accent: "violet",
  },
  {
    icon: Layers,
    badge: "Clone Mode",
    title: "Tiru video viral dengan produk anda",
    desc: "Upload video referensi + gambar produk. AI extract setiap shot, recreate persis dengan produk anda. Tanpa shoot semula.",
    accent: "blue",
  },
  {
    icon: Sparkles,
    badge: "Veo 3.1",
    title: "Quality UGC sebenar, bukan AI plastik",
    desc: "Real human face, Malay accent natural, lip-sync sempurna. Hand gesture, skin texture, product anchoring — semua macam shoot beneran.",
    accent: "pink",
  },
  {
    icon: TrendingUp,
    badge: "Auto Caption",
    title: "Caption + hashtag siap untuk post",
    desc: "Setiap video datang dengan caption Bahasa Melayu dan 5 viral hashtags. Tak perlu fikir lagi. Download dan post terus ke TikTok.",
    accent: "amber",
  },
];

const STEPS = [
  { num: "01", title: "Letak link produk", desc: "Paste TikTok Shop URL atau upload gambar produk anda" },
  { num: "02", title: "Pilih kuantiti", desc: "1 hingga 10 video, 8 saat atau 16 saat — anda pilih" },
  { num: "03", title: "AI buat semua", desc: "Master plan, scene, dialog Bahasa Melayu, video — auto" },
  { num: "04", title: "Download & post", desc: "Caption + hashtag siap. Drop terus ke TikTok Shop" },
];

const PLANS = [
  {
    name: "Starter",
    price: "RM47",
    period: "/bulan",
    desc: "Untuk seller mula auto-UGC",
    credits: "100 kredit",
    features: [
      "~25 video 8 saat",
      "Auto Content + Clone mode",
      "Caption + hashtag Bahasa Melayu",
      "Download HD MP4",
      "Email support",
    ],
    cta: "Mula sekarang",
    highlighted: false,
  },
  {
    name: "Growth",
    price: "RM147",
    period: "/bulan",
    desc: "Untuk seller serius scaling",
    credits: "350 kredit",
    features: [
      "~85 video 8 saat",
      "Semua dalam Starter",
      "Priority generation queue",
      "Custom CTA setiap batch",
      "WhatsApp support",
    ],
    cta: "Pilih Growth",
    highlighted: true,
    badge: "Paling popular",
  },
  {
    name: "Empire",
    price: "RM397",
    period: "/bulan",
    desc: "Untuk team / agency",
    credits: "1,000 kredit",
    features: [
      "~250 video 8 saat",
      "Semua dalam Growth",
      "Multi-account access",
      "Dedicated account manager",
      "API access (coming soon)",
    ],
    cta: "Hubungi kami",
    highlighted: false,
  },
];

const TESTIMONIALS = [
  {
    quote:
      "Dulu aku spend RM3k sebulan kat creator. Sekarang RM147 dapat video lagi banyak. Sales naik 40%.",
    name: "Aina R.",
    title: "Skincare seller, KL",
  },
  {
    quote:
      "Macam ada team UGC sendiri. Pagi paste link, lunch dah ada 10 video ready post.",
    name: "Faizul A.",
    title: "Supplement brand owner",
  },
  {
    quote:
      "Bahasa Melayu dia natural gila. Customer ingat real human, bukan AI. Conversion lagi tinggi.",
    name: "Nadia M.",
    title: "Fashion TikTok Shop",
  },
];

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="bg-sky" />
      <div
        className="bg-soft-glow"
        style={{
          background: "radial-gradient(circle, #c4b5fd, transparent 70%)",
          width: 600,
          height: 600,
          top: -200,
          right: -100,
        }}
      />
      <div
        className="bg-soft-glow"
        style={{
          background: "radial-gradient(circle, #93c5fd, transparent 70%)",
          width: 500,
          height: 500,
          top: 100,
          left: -150,
        }}
      />

      {/* Nav — minimal, only auth buttons */}
      <nav className="relative z-10 mx-auto max-w-7xl px-6 py-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-400 via-violet-500 to-blue-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
            <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-display font-extrabold text-2xl tracking-tight">
            PeningLab
          </span>
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="px-5 py-2.5 text-sm font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-accent-violet)] transition"
          >
            Sign in
          </Link>
          <Link href="/register" className="btn-primary text-sm py-3 px-6">
            Sign up
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pt-16 pb-24 text-center">
        <div className="inline-flex items-center gap-2 mb-8 chip chip-pulse animate-fade-in-up">
          <span>Auto-UGC platform untuk TikTok Shop seller</span>
        </div>

        <h1
          className="font-display font-extrabold tracking-tight text-5xl sm:text-6xl md:text-7xl lg:text-[88px] leading-[0.95] mb-8 animate-fade-in-up"
          style={{ animationDelay: "0.1s", opacity: 0 }}
        >
          UGC Video AI
          <br />
          untuk seller{" "}
          <span className="gradient-text-violet">yang serius</span>
          <br />
          nak <span className="gradient-text-blue">scale</span>.
        </h1>

        <p
          className="max-w-2xl mx-auto text-lg sm:text-xl text-[var(--color-text-secondary)] mb-10 leading-relaxed animate-fade-in-up"
          style={{ animationDelay: "0.2s", opacity: 0 }}
        >
          Hasilkan 10 video UGC TikTok Shop dalam{" "}
          <span className="text-[var(--color-text-primary)] font-semibold">
            3 minit
          </span>
          . Dialog Bahasa Melayu, face natural, produk lock — bukan AI plastik.
        </p>

        <div
          className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-14 animate-fade-in-up"
          style={{ animationDelay: "0.3s", opacity: 0 }}
        >
          <Link href="/register" className="btn-primary group">
            Cuba Percuma — 10 Kredit
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
          </Link>
          <a href="#how" className="btn-secondary">
            <PlayCircle className="w-4 h-4" />
            Tengok Cara Guna
          </a>
        </div>

        {/* Social proof */}
        <div
          className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 text-sm text-[var(--color-text-muted)] animate-fade-in-up"
          style={{ animationDelay: "0.4s", opacity: 0 }}
        >
          <div className="flex -space-x-2">
            {[
              "from-violet-300 to-violet-500",
              "from-blue-300 to-blue-500",
              "from-pink-300 to-pink-500",
              "from-amber-300 to-amber-500",
            ].map((g, i) => (
              <div
                key={i}
                className={`w-8 h-8 rounded-full bg-gradient-to-br ${g} ring-2 ring-white`}
              />
            ))}
          </div>
          <span className="flex items-center gap-1.5">
            <span className="text-[var(--color-text-primary)] font-bold">
              1,300+
            </span>{" "}
            seller dah scale UGC dengan AI
            <span className="flex items-center gap-0.5 ml-1.5">
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  className="w-3.5 h-3.5 fill-amber-400 text-amber-400"
                />
              ))}
            </span>
          </span>
        </div>
      </section>

      {/* Pain Points */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-20">
        <div className="text-center mb-14">
          <div className="chip mb-6">Masalah seller TikTok</div>
          <h2 className="font-display font-extrabold text-4xl sm:text-5xl md:text-6xl tracking-tight leading-[1.05] max-w-4xl mx-auto">
            Seller lain dah{" "}
            <span className="gradient-text-violet">scale</span>.<br />
            Anda masih shoot manual?
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {PAIN_POINTS.map((p, i) => {
            const Icon = p.icon;
            return (
              <div key={i} className="card">
                <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mb-5">
                  <Icon className="w-7 h-7 text-red-500" strokeWidth={2} />
                </div>
                <h3 className="font-display font-bold text-2xl mb-3 text-[var(--color-text-primary)]">
                  {p.title}
                </h3>
                <p className="text-[var(--color-text-secondary)] leading-relaxed">
                  {p.desc}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Features */}
      <section
        id="features"
        className="relative z-10 mx-auto max-w-6xl px-6 py-24"
      >
        <div className="text-center mb-16">
          <div className="chip mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Penyelesaian PeningLab</span>
          </div>
          <h2 className="font-display font-extrabold text-4xl sm:text-5xl md:text-6xl tracking-tight leading-[1.05] max-w-4xl mx-auto">
            Satu prompt.{" "}
            <span className="gradient-text-violet">10 video viral.</span>
          </h2>
          <p className="mt-6 text-lg text-[var(--color-text-secondary)] max-w-2xl mx-auto">
            Stack penuh — AI Creative Director, Veo 3.1 video generator, Caption
            generator — dalam satu klik.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            const accentMap: Record<string, { bg: string; border: string; text: string }> = {
              violet: {
                bg: "bg-violet-50",
                border: "border-violet-100",
                text: "text-violet-600",
              },
              blue: {
                bg: "bg-blue-50",
                border: "border-blue-100",
                text: "text-blue-600",
              },
              pink: {
                bg: "bg-pink-50",
                border: "border-pink-100",
                text: "text-pink-600",
              },
              amber: {
                bg: "bg-amber-50",
                border: "border-amber-100",
                text: "text-amber-600",
              },
            };
            const a = accentMap[f.accent];
            return (
              <div key={i} className="card">
                <div className="flex items-start gap-4 mb-5">
                  <div
                    className={`w-14 h-14 rounded-2xl ${a.bg} border ${a.border} flex items-center justify-center flex-shrink-0`}
                  >
                    <Icon
                      className={`w-7 h-7 ${a.text}`}
                      strokeWidth={2}
                    />
                  </div>
                  <div>
                    <div
                      className={`text-xs font-bold uppercase tracking-wider mb-2 ${a.text}`}
                    >
                      {f.badge}
                    </div>
                    <h3 className="font-display font-bold text-2xl leading-tight">
                      {f.title}
                    </h3>
                  </div>
                </div>
                <p className="text-[var(--color-text-secondary)] leading-relaxed">
                  {f.desc}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="relative z-10 py-24">
        <div className="section-bg-soft absolute inset-0" />
        <div className="relative mx-auto max-w-6xl px-6">
          <div className="text-center mb-14">
            <div className="chip mb-6">
              <Zap className="w-3.5 h-3.5" />
              <span>Cara guna</span>
            </div>
            <h2 className="font-display font-extrabold text-4xl sm:text-5xl md:text-6xl tracking-tight leading-[1.05]">
              4 langkah.{" "}
              <span className="gradient-text-blue">3 minit.</span> Done.
            </h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {STEPS.map((s, i) => (
              <div key={i} className="card">
                <div className="font-display font-extrabold text-5xl gradient-text-violet mb-3">
                  {s.num}
                </div>
                <h3 className="font-display font-bold text-lg mb-2 text-[var(--color-text-primary)]">
                  {s.title}
                </h3>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-24">
        <div className="text-center mb-14">
          <div className="chip mb-6">
            <Users className="w-3.5 h-3.5" />
            <span>Real seller, real result</span>
          </div>
          <h2 className="font-display font-extrabold text-4xl sm:text-5xl md:text-6xl tracking-tight leading-[1.05]">
            Bukan janji kosong.
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {TESTIMONIALS.map((t, i) => (
            <div key={i} className="card">
              <div className="flex items-center gap-0.5 mb-4">
                {[...Array(5)].map((_, j) => (
                  <Star
                    key={j}
                    className="w-4 h-4 fill-amber-400 text-amber-400"
                  />
                ))}
              </div>
              <p className="text-[var(--color-text-primary)] text-lg leading-relaxed mb-5 font-medium">
                "{t.quote}"
              </p>
              <div className="flex items-center gap-3 pt-4 border-t border-[var(--color-border)]">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-300 to-blue-400" />
                <div>
                  <div className="font-bold text-sm">{t.name}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    {t.title}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section
        id="pricing"
        className="relative z-10 mx-auto max-w-6xl px-6 py-24"
      >
        <div className="text-center mb-16">
          <div className="chip mb-6">Pricing</div>
          <h2 className="font-display font-extrabold text-4xl sm:text-5xl md:text-6xl tracking-tight leading-[1.05]">
            Pay per video.{" "}
            <span className="gradient-text-warm">Tiada drama.</span>
          </h2>
          <p className="mt-6 text-lg text-[var(--color-text-secondary)] max-w-2xl mx-auto">
            Kredit tak hangus. Top up bila perlu. Cancel bila-bila.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {PLANS.map((plan, i) => (
            <div
              key={i}
              className={`card relative ${
                plan.highlighted
                  ? "border-2 border-violet-300 shadow-xl shadow-violet-500/10 scale-[1.02]"
                  : ""
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-gradient-to-r from-violet-500 to-blue-500 text-white shadow-lg shadow-violet-500/30">
                  {plan.badge}
                </div>
              )}
              <div className="mb-6">
                <h3 className="font-display font-bold text-xl mb-1">
                  {plan.name}
                </h3>
                <p className="text-sm text-[var(--color-text-muted)]">
                  {plan.desc}
                </p>
              </div>
              <div className="mb-6">
                <span className="font-display font-extrabold text-5xl tracking-tight">
                  {plan.price}
                </span>
                <span className="text-[var(--color-text-muted)] text-base ml-1">
                  {plan.period}
                </span>
                <div className="text-sm text-[var(--color-accent-violet)] font-bold mt-1">
                  {plan.credits}
                </div>
              </div>
              <ul className="space-y-3 mb-8">
                {plan.features.map((f, j) => (
                  <li key={j} className="flex items-start gap-2.5 text-sm">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span className="text-[var(--color-text-secondary)]">
                      {f}
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                href="/register"
                className={`block w-full text-center font-semibold py-3.5 rounded-full transition ${
                  plan.highlighted ? "btn-primary" : "btn-secondary"
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-10 flex items-center justify-center gap-6 text-sm text-[var(--color-text-muted)]">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>30-day money back</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>Cancel anytime</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>Tiada credit card untuk trial</span>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 mx-auto max-w-4xl px-6 py-24 text-center">
        <div
          className="card relative overflow-hidden p-12 md:p-16"
          style={{
            background:
              "linear-gradient(135deg, #ede9fe 0%, #dbeafe 50%, #fce7f3 100%)",
            border: "1px solid #c4b5fd",
          }}
        >
          <div className="relative">
            <h2 className="font-display font-extrabold text-4xl sm:text-5xl tracking-tight leading-[1.05] mb-4">
              Pertama kali?{" "}
              <span className="gradient-text-violet">10 kredit free.</span>
            </h2>
            <p className="text-lg text-[var(--color-text-secondary)] mb-8 max-w-xl mx-auto">
              Cuba 2 video 8 saat sekarang juga. Tak perlu credit card. Tak
              perlu komitmen.
            </p>
            <Link href="/register" className="btn-primary inline-flex">
              Daftar Percuma
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-[var(--color-border)] mt-12 bg-white/50">
        <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-[var(--color-text-muted)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-400 via-violet-500 to-blue-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <Sparkles className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <span className="font-display font-bold text-[var(--color-text-primary)]">
              PeningLab
            </span>
            <span>© 2026</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#" className="hover:text-[var(--color-text-primary)] transition">
              Terms
            </a>
            <a href="#" className="hover:text-[var(--color-text-primary)] transition">
              Privacy
            </a>
            <a
              href="mailto:hello@peninglab.com"
              className="hover:text-[var(--color-text-primary)] transition"
            >
              hello@peninglab.com
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
