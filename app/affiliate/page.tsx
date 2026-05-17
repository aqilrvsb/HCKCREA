import Link from "next/link";
import {
  Sparkles,
  TrendingUp,
  Wallet,
  Users,
  Video,
  Film,
  Megaphone,
  Send,
  ImageIcon,
  Wand2,
  Banknote,
  Award,
  ArrowRight,
  CheckCircle2,
  Zap,
  Globe,
} from "lucide-react";
import AffiliateForm from "./affiliate-form";
import { getReferralCommissionRate } from "@/lib/settings";

// Pro plan price the commission is calculated against. Hardcoded for
// now — if the Pro plan price ever changes, update this constant.
const PRO_PLAN_RM = 75;

export const revalidate = 3600;
export const metadata = {
  title: "Jadi Affiliate PeningLab — 20% Komisyen Tetap",
  description:
    "Promote AI marketing tools — UGC, Cinema, Viral, Auto Post, Auto Content. Earn 20% commission setiap bulan, sampai bila-bila.",
};

const FEATURES = [
  {
    icon: Video,
    label: "UGC Video AI",
    desc: "Veo 3.1 dialog video — 8 saat lip-sync sempurna",
    tint: "from-orange-500/20 to-amber-500/20",
  },
  {
    icon: Film,
    label: "Cinema (Seedance)",
    desc: "Veo + Seedance 2.0 untuk cinematic ads",
    tint: "from-violet-500/20 to-fuchsia-500/20",
  },
  {
    icon: Megaphone,
    label: "Viral — Talking Object",
    desc: "Pixar-style anthropomorphic mascots yang viral",
    tint: "from-pink-500/20 to-rose-500/20",
  },
  {
    icon: Send,
    label: "Auto Post TikTok",
    desc: "Chrome extension yang auto-upload jadual",
    tint: "from-blue-500/20 to-cyan-500/20",
  },
  {
    icon: Wand2,
    label: "Auto Content AI",
    desc: "Idea → script → image → video, full pipeline",
    tint: "from-emerald-500/20 to-teal-500/20",
  },
  {
    icon: ImageIcon,
    label: "Image AI",
    desc: "nano-banana-pro, GPT Image 2, z-image — semua ada",
    tint: "from-yellow-500/20 to-orange-500/20",
  },
];

const STEPS = [
  {
    n: "1",
    title: "Daftar Affiliate",
    desc: "Fill form pendek di bawah. Admin review dalam 24 jam.",
  },
  {
    n: "2",
    title: "Dapat Login + 10 Credit",
    desc: "Account active 30 hari Pro Plan. Cuba semua tools dulu.",
  },
  {
    n: "3",
    title: "Share Link Affiliate",
    desc: "Setiap orang yang subscribe melalui link anda — anda dapat komisyen tetap.",
  },
  {
    n: "4",
    title: "Cash Out RM50+",
    desc: "Earnings masuk wallet auto. Cash out terus ke bank Malaysia anda.",
  },
];

export default async function AffiliateLandingPage() {
  // Pull the admin-tunable commission rate so the whole page reflects
  // the live percent + computed RM amount. Falls back to 20 in the
  // helper itself if the setting is missing/invalid.
  const ratePercent = await getReferralCommissionRate();
  const monthlyRm = Math.round((ratePercent / 100) * PRO_PLAN_RM);
  return (
    <div
      className="min-h-screen overflow-x-hidden"
      style={{
        background:
          "radial-gradient(ellipse 1400px 900px at 50% -10%, #1a0b00 0%, #0a0a0a 45%, #000 100%)",
        color: "white",
      }}
    >
      {/* Top nav */}
      <nav className="border-b border-white/5">
        <div className="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 group">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, #f97316, #ea580c)",
              }}
            >
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-display font-extrabold text-lg">
              PeningLab
            </span>
          </Link>
          <Link
            href="/login"
            className="text-xs font-bold text-white/70 hover:text-white transition"
          >
            Already affiliate? Login →
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-5 pt-16 pb-20 lg:pt-24 lg:pb-32 relative">
        {/* Decorative glow blobs */}
        <div
          aria-hidden
          className="absolute -top-20 -left-20 w-96 h-96 rounded-full blur-3xl opacity-40"
          style={{ background: "radial-gradient(circle, #f97316, transparent 60%)" }}
        />
        <div
          aria-hidden
          className="absolute top-40 -right-20 w-96 h-96 rounded-full blur-3xl opacity-30"
          style={{ background: "radial-gradient(circle, #a855f7, transparent 60%)" }}
        />

        <div className="grid lg:grid-cols-[1.2fr_1fr] gap-10 lg:gap-16 items-start relative">
          <div>
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-widest px-3 py-1.5 rounded-full mb-6"
              style={{
                background: "rgba(249,115,22,0.12)",
                border: "1px solid rgba(249,115,22,0.4)",
                color: "#fb923c",
              }}
            >
              <Award className="w-3 h-3" />
              Program Affiliate 2026
            </span>

            <h1 className="font-display font-extrabold text-4xl sm:text-5xl lg:text-6xl leading-[1.05] tracking-tight mb-6">
              Earn{" "}
              <span
                className="inline-block"
                style={{
                  background: "linear-gradient(135deg, #fb923c, #f97316, #ea580c)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {ratePercent}% komisyen
              </span>{" "}
              setiap bulan, sampai bila-bila.
            </h1>

            <p className="text-base sm:text-lg text-white/70 leading-relaxed mb-8 max-w-xl">
              Promote PeningLab — AI marketing tools paling lengkap di Malaysia.
              Setiap orang yang subscribe melalui link anda, anda dapat{" "}
              <strong className="text-white">RM {monthlyRm} setiap bulan</strong>, selagi
              mereka aktif. Recurring. Tanpa cap.
            </p>

            <div className="flex flex-wrap items-center gap-4 mb-10">
              <a
                href="#daftar"
                className="px-6 py-3.5 rounded-xl font-extrabold text-base text-white inline-flex items-center gap-2 hover:-translate-y-0.5 transition"
                style={{
                  background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
                  boxShadow:
                    "0 8px 24px rgba(249,115,22,0.4), inset 0 1px 0 rgba(255,255,255,0.2)",
                }}
              >
                Daftar Sekarang <ArrowRight className="w-4 h-4" />
              </a>
              <a
                href="#how"
                className="px-6 py-3.5 rounded-xl font-bold text-sm inline-flex items-center gap-2 transition"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "white",
                }}
              >
                Macam mana ia berfungsi
              </a>
            </div>

            {/* Trust strip */}
            <div className="flex flex-wrap items-center gap-6 text-xs text-white/60">
              <div className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                2-hari Pro Plan PERCUMA
              </div>
              <div className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Cash out ke bank Malaysia
              </div>
            </div>
          </div>

          {/* Form card */}
          <div id="daftar" className="lg:sticky lg:top-8">
            <div
              className="rounded-3xl p-6 lg:p-7 relative overflow-hidden"
              style={{
                background:
                  "linear-gradient(180deg, rgba(20,20,22,0.95), rgba(15,15,17,0.95))",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow:
                  "0 30px 80px -20px rgba(249,115,22,0.25), 0 0 0 1px rgba(249,115,22,0.1)",
              }}
            >
              {/* Top accent */}
              <div
                className="absolute top-0 left-0 right-0 h-1"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, #f97316, #ea580c, transparent)",
                }}
              />

              <div className="mb-5">
                <h3 className="font-display font-extrabold text-xl mb-1">
                  Daftar Affiliate — FREE
                </h3>
                <p className="text-xs text-white/60">
                  Admin approve dalam 24 jam. Login dihantar ke WhatsApp.
                </p>
              </div>

              <AffiliateForm />
            </div>
          </div>
        </div>
      </section>

      {/* Earnings calculator */}
      <section className="max-w-6xl mx-auto px-5 py-12">
        <div
          className="rounded-3xl p-8 lg:p-10 grid md:grid-cols-3 gap-6 items-center"
          style={{
            background:
              "linear-gradient(135deg, rgba(249,115,22,0.08), rgba(168,85,247,0.06))",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <EarnTile
            referrals={5}
            monthly={monthlyRm * 5}
            tint="emerald"
            label="5 referrals"
          />
          <EarnTile
            referrals={20}
            monthly={monthlyRm * 20}
            tint="violet"
            label="20 referrals"
            featured
          />
          <EarnTile
            referrals={100}
            monthly={monthlyRm * 100}
            tint="orange"
            label="100 referrals"
          />
        </div>
        <p className="text-xs text-white/40 text-center mt-4">
          Berdasarkan {ratePercent}% komisyen × RM {PRO_PLAN_RM} Pro Plan. Recurring setiap bulan
          selagi mereka aktif subscribed.
        </p>
      </section>

      {/* Product feature grid — what they're promoting */}
      <section className="max-w-6xl mx-auto px-5 py-16">
        <div className="text-center mb-10">
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-orange-400">
            Apa yang anda promote
          </span>
          <h2 className="font-display font-extrabold text-3xl lg:text-4xl mt-2 mb-3">
            Tools paling lengkap di Malaysia
          </h2>
          <p className="text-sm text-white/60 max-w-2xl mx-auto">
            6 produk AI dalam satu platform. Sellers cuba sekali, addict
            selama-lamanya — yang membayar komisyen anda.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div
              key={f.label}
              className="rounded-2xl p-5 group transition hover:-translate-y-1"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 bg-gradient-to-br ${f.tint}`}
                style={{ border: "1px solid rgba(255,255,255,0.1)" }}
              >
                <f.icon className="w-5 h-5 text-white" />
              </div>
              <h3 className="font-display font-extrabold text-base mb-1">
                {f.label}
              </h3>
              <p className="text-xs text-white/60 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works — 4 steps */}
      <section id="how" className="max-w-6xl mx-auto px-5 py-16">
        <div className="text-center mb-10">
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-orange-400">
            Cara ia berfungsi
          </span>
          <h2 className="font-display font-extrabold text-3xl lg:text-4xl mt-2">
            4 langkah, mula earn hari ini
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STEPS.map((s, i) => (
            <div
              key={s.n}
              className="rounded-2xl p-5 relative"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div
                className="absolute -top-3 -left-3 w-9 h-9 rounded-xl flex items-center justify-center font-extrabold text-sm"
                style={{
                  background: "linear-gradient(135deg, #f97316, #ea580c)",
                  color: "white",
                  boxShadow: "0 4px 12px rgba(249,115,22,0.4)",
                }}
              >
                {s.n}
              </div>
              <h3 className="font-display font-extrabold text-base mb-2 mt-2">
                {s.title}
              </h3>
              <p className="text-xs text-white/60 leading-relaxed">{s.desc}</p>
              {i < STEPS.length - 1 && (
                <ArrowRight className="hidden lg:block absolute -right-4 top-1/2 -translate-y-1/2 w-6 h-6 text-white/20" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Perks */}
      <section className="max-w-6xl mx-auto px-5 py-16">
        <div
          className="rounded-3xl p-8 lg:p-12 grid md:grid-cols-2 gap-10 items-center"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-orange-400">
              Kelebihan affiliate
            </span>
            <h2 className="font-display font-extrabold text-3xl lg:text-4xl mt-2 mb-6">
              Bukan sekadar komisyen.
            </h2>
            <ul className="space-y-4">
              <Perk
                icon={TrendingUp}
                title={`Komisyen recurring ${ratePercent}% — selagi mereka subscribe`}
                body={`RM ${monthlyRm} setiap bulan, untuk setiap referral active. Anda kerja sekali, dapat sampai bila-bila.`}
              />
              <Perk
                icon={Wallet}
                title="Wallet auto-update + cash out RM50 minima"
                body="Setiap komisyen langsung masuk wallet. Withdraw bila-bila ke 19+ bank Malaysia."
              />
              <Perk
                icon={Zap}
                title="2-hari Pro Plan free + credit signup"
                body="Cuba semua tools dulu. Generate content sendiri untuk promote organic. Lepas tu renewal Pro Plan macam biasa."
              />
              <Perk
                icon={Globe}
                title="Link tracking 30 hari cookie"
                body="Pengguna boleh tinggalkan link dan datang balik lewat — anda masih dapat komisyen."
              />
            </ul>
          </div>

          {/* Visual showcase — orbiting feature pills around a central wallet */}
          <div className="relative mx-auto" style={{ width: 320, height: 320 }}>
            <div
              className="absolute inset-0 rounded-full blur-3xl opacity-40"
              style={{
                background: "radial-gradient(circle, #f97316, transparent 60%)",
              }}
            />
            <div
              className="absolute inset-8 rounded-full flex items-center justify-center"
              style={{
                background:
                  "linear-gradient(135deg, rgba(249,115,22,0.12), rgba(168,85,247,0.08))",
                border: "1px solid rgba(249,115,22,0.4)",
                boxShadow: "0 20px 60px rgba(249,115,22,0.3)",
              }}
            >
              <div className="text-center">
                <Banknote className="w-14 h-14 mx-auto mb-2 text-orange-400" />
                <p className="text-2xl font-extrabold">RM {monthlyRm}</p>
                <p className="text-[10px] text-white/60 uppercase tracking-widest font-bold">
                  per referral / bulan
                </p>
              </div>
            </div>

            <OrbitPill label="UGC" top="6%" left="50%" tx="-50%" />
            <OrbitPill label="Cinema" top="50%" left="92%" tx="-50%" />
            <OrbitPill label="Viral" top="92%" left="50%" tx="-50%" />
            <OrbitPill label="Auto Post" top="50%" left="8%" tx="-50%" />
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-4xl mx-auto px-5 py-16 text-center">
        <h2 className="font-display font-extrabold text-3xl lg:text-5xl leading-tight mb-4">
          Stop tunggu.{" "}
          <span
            style={{
              background: "linear-gradient(135deg, #fb923c, #ea580c)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Mula earn hari ini.
          </span>
        </h2>
        <p className="text-base text-white/70 mb-8 max-w-xl mx-auto">
          Daftar dalam 30 saat. Account anda diluluskan dalam 24 jam, dengan
          Pro Plan + 10 credit free untuk start.
        </p>
        <a
          href="#daftar"
          className="inline-flex items-center gap-2 px-8 py-4 rounded-xl font-extrabold text-base text-white transition hover:-translate-y-0.5"
          style={{
            background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
            boxShadow:
              "0 12px 32px rgba(249,115,22,0.5), inset 0 1px 0 rgba(255,255,255,0.2)",
          }}
        >
          <Users className="w-5 h-5" />
          Daftar Affiliate Sekarang
        </a>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 mt-12">
        <div className="max-w-6xl mx-auto px-5 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/40">
          <p>© 2026 PeningLab. Made in Malaysia.</p>
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:text-white/70 transition">
              Main page
            </Link>
            <Link href="/login" className="hover:text-white/70 transition">
              Login
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── small components ────────────────────────────────────────────────

function Perk({
  icon: Icon,
  title,
  body,
}: {
  icon: any;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-3">
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{
          background: "rgba(249,115,22,0.15)",
          border: "1px solid rgba(249,115,22,0.3)",
        }}
      >
        <Icon className="w-4 h-4 text-orange-400" />
      </div>
      <div>
        <p className="font-bold text-sm mb-1">{title}</p>
        <p className="text-xs text-white/60 leading-relaxed">{body}</p>
      </div>
    </li>
  );
}

function EarnTile({
  referrals,
  monthly,
  label,
  tint,
  featured,
}: {
  referrals: number;
  monthly: number;
  label: string;
  tint: "emerald" | "violet" | "orange";
  featured?: boolean;
}) {
  const colors: Record<string, { bg: string; bd: string; fg: string }> = {
    emerald: { bg: "rgba(16,185,129,0.08)", bd: "rgba(16,185,129,0.3)", fg: "#34d399" },
    violet:  { bg: "rgba(168,85,247,0.10)", bd: "rgba(168,85,247,0.4)", fg: "#c084fc" },
    orange:  { bg: "rgba(249,115,22,0.10)", bd: "rgba(249,115,22,0.4)", fg: "#fb923c" },
  };
  const c = colors[tint];
  return (
    <div
      className="rounded-2xl p-6 text-center transition"
      style={{
        background: c.bg,
        border: `1px solid ${c.bd}`,
        transform: featured ? "scale(1.05)" : "none",
        boxShadow: featured ? `0 12px 32px ${c.bd}` : "none",
      }}
    >
      <p className="text-xs uppercase tracking-widest font-bold mb-2" style={{ color: c.fg }}>
        {label}
      </p>
      <p className="font-display font-extrabold text-4xl mb-1" style={{ color: c.fg }}>
        RM {monthly}
      </p>
      <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest">
        / bulan recurring
      </p>
    </div>
  );
}

function OrbitPill({
  label,
  top,
  left,
  tx,
}: {
  label: string;
  top: string;
  left: string;
  tx: string;
}) {
  return (
    <div
      className="absolute font-extrabold text-[11px] uppercase tracking-widest px-3 py-1.5 rounded-full"
      style={{
        top,
        left,
        transform: `translateX(${tx})`,
        background: "rgba(0,0,0,0.6)",
        border: "1px solid rgba(255,255,255,0.15)",
        color: "white",
        backdropFilter: "blur(8px)",
      }}
    >
      {label}
    </div>
  );
}
