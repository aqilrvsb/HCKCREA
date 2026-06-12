import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import {
  Sparkles,
  ArrowRight,
  Zap,
  Clock,
  Wallet,
  Camera,
  CheckCircle2,
  PlayCircle,
  Users,
  TrendingUp,
  Layers,
  Wand2,
  ImageIcon,
  Video,
  Send,
  ShieldCheck,
  Star,
  Quote,
  Gauge,
  Brain,
  ChevronRight,
  Flame,
} from "lucide-react";
import Countdown from "./components/countdown";
import LazyVideo from "./components/lazy-video";
import PricingTiersGrid from "@/components/pricing-tiers-grid";
import LivehostCard from "@/components/livehost-card";

// Dynamic-import every below-the-fold client component so they don't bloat
// the first-5s payload. Each has "use client" of its own and ships as a
// separate chunk, code-split out of the landing page bundle.
// Note: ssr:false isn't allowed in Server Components in Next.js 15 — chunks
// SSR their initial HTML (cheap) and hydrate as client islands.
const DemoReel = dynamic(() => import("./components/demo-reel"));
const SocialProofToast = dynamic(() => import("./components/social-proof-toast"));
const CheckoutForm = dynamic(() => import("./(checkout)/checkout-form"));

export const revalidate = 3600;

const STATS = [
  { num: "1,300+", label: "seller aktif" },
  { num: "47,000+", label: "video di-generate" },
  { num: "3 min", label: "purata satu video" },
  { num: "92%", label: "kadar kepuasan" },
];

const TESTIMONIALS = [
  {
    quote: "Dulu spend RM3k sebulan kat creator. Sekarang RM147 dapat video lagi banyak. Sales naik 40%.",
    name: "Aina R.",
    title: "Skincare seller, KL",
    avatar: "from-orange-200 to-orange-400",
  },
  {
    quote: "Macam ada team UGC sendiri. Pagi paste link, lunch dah ada 10 video ready post.",
    name: "Faizul A.",
    title: "Supplement brand",
    avatar: "from-blue-300 to-cyan-300",
  },
  {
    quote: "Bahasa Melayu dia natural gila. Customer ingat real human, bukan AI.",
    name: "Nadia M.",
    title: "Fashion TikTok",
    avatar: "from-amber-300 to-pink-300",
  },
  {
    quote: "ROI lebih cepat dari ads. RM47/bulan, balik modal dengan 1 video viral.",
    name: "Hafiz Z.",
    title: "Gadget seller",
    avatar: "from-emerald-300 to-blue-300",
  },
  {
    quote: "Auto post tu killer. Tido pun video tetap live. TikTok Shop saya hidup 24/7.",
    name: "Sya Haziq",
    title: "Food brand",
    avatar: "from-pink-300 to-violet-300",
  },
  {
    quote: "Clone mode best gila. Tengok video viral competitor, tukar produk aku, terus viral juga.",
    name: "Rahman T.",
    title: "Kitchenware seller",
    avatar: "from-orange-300 to-amber-300",
  },
];

const FAQ = [
  {
    q: "Saya tak pandai shoot video, boleh guna ke?",
    a: "Boleh sangat. Itu sebab PeningLab wujud — anda tak perlu sentuh kamera langsung. Cukup paste link produk TikTok Shop, AI akan susun plan, generate video, dan tulis caption. Anda hanya perlu tekan butang.",
  },
  {
    q: "Berapa cepat saya boleh dapat video pertama?",
    a: "3 minit. Pilih tier (Starter/Standard/Pro/Premium), dapat kredit RM serta-merta, terus generate. Image 20 sen, video 40 sen — auto-deduct setiap generate.",
  },
  {
    q: "Bahasa Melayu betul ke? Bukan Indonesia?",
    a: "Khusus Bahasa Melayu Malaysia — bahasa pasar yang sebenar. AI kami dilatih untuk informal Malay (korang, aku, ni, tu, memang). Bukan formal, bukan Indonesia. Customer anda akan ingat ini real human.",
  },
  {
    q: "Boleh cancel bila-bila?",
    a: "Ya. Tiada kontrak, tiada drama. Cancel terus dari dashboard. Kredit yang dah ada tetap boleh guna sampai habis.",
  },
  {
    q: "Wajib kena guna TikTok Shop ke?",
    a: "Tidak wajib. Anda boleh upload gambar produk sendiri. PeningLab akan generate video UGC walaupun anda tak ada link TikTok Shop. Sesuai untuk Shopee, Lazada, IG Shop, atau brand sendiri.",
  },
  {
    q: "Macam mana dengan auto-post TikTok?",
    a: "Auto-post ke TikTok Shop sedang dalam build. Sementara itu, anda boleh download video HD MP4 + caption Bahasa Melayu, dan post manual (10 saat sahaja).",
  },
];

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="bg-sky" />
      <div className="bg-grid" />
      <div
        className="bg-soft-glow"
        style={{
          background: "radial-gradient(circle, #ffd4b8, transparent 70%)",
          width: 700,
          height: 700,
          top: -250,
          right: -150,
        }}
      />
      <div
        className="bg-soft-glow"
        style={{
          background: "radial-gradient(circle, #ffe0c4, transparent 70%)",
          width: 600,
          height: 600,
          top: 50,
          left: -200,
        }}
      />
      <div className="bg-noise" />

      {/* Top urgency banner — solid highfield yellow + black text for max
          legibility. Countdown gets a vivid orange override so the
          dwindling time pops visually against the otherwise-black row. */}
      <div className="relative z-30" style={{ background: "#ffff00", color: "#000" }}>
        <div className="mx-auto max-w-7xl px-6 py-2 flex items-center justify-center gap-2 text-xs sm:text-sm font-semibold text-center">
          <Flame className="w-3.5 h-3.5 animate-pulse flex-shrink-0" style={{ color: "#ea580c" }} />
          <span>
            <strong>Promo bermula RM35/bulan</strong> ditutup dalam{" "}
            <Countdown inline />. Tinggal{" "}
            <strong>13 slot</strong> dari 80 — 67 seller dah claim hari ni.
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="relative z-20 mx-auto max-w-7xl px-6 py-5 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 via-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/30">
            <Sparkles className="w-5 h-5 text-black" strokeWidth={2.5} />
          </div>
          <span className="font-display font-extrabold text-2xl tracking-tight">
            PeningLab
          </span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href="#pricing"
            className="inline-flex items-center gap-1.5 px-4 sm:px-5 py-3 rounded-2xl text-xs sm:text-sm font-extrabold transition-transform hover:scale-[1.04] hover:-translate-y-0.5"
            style={{
              background:
                "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
              color: "white",
              boxShadow: "0 6px 20px rgba(249,115,22,0.35)",
            }}
          >
            Pricing
          </a>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-5 sm:px-6 py-3 rounded-2xl text-sm sm:text-base font-extrabold transition-transform hover:scale-[1.04] hover:-translate-y-0.5"
            style={{
              background: "var(--color-lime)",
              color: "#0a0a0a",
              boxShadow: "0 6px 20px rgba(200, 245, 62, 0.3)",
            }}
          >
            Sign in
            <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
          </Link>
        </div>
      </nav>

      {/* Hero — split layout, bold headline + product demo phone */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 pt-12 pb-20">
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          {/* Left: copy */}
          <div className="lg:col-span-7">
            {/* Social proof badge above H1 — number first, like rekalab */}
            <div
              className="inline-flex items-center gap-2 mb-7 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 animate-fade-in-up"
              style={{ opacity: 1 }}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs sm:text-sm font-bold text-emerald-700">
                1,300+ seller TikTok Shop Malaysia dah scale UGC
              </span>
            </div>

            {/* Headline — fear/comparison hook (rekalab style) */}
            <h1
              className="font-display font-extrabold tracking-tight text-5xl sm:text-6xl md:text-7xl leading-[0.95] mb-7 animate-fade-in-up"
              style={{ animationDelay: "0.1s", opacity: 1 }}
            >
              <span className="block">Kompetitor dah</span>
              <span className="block">
                <span className="gradient-text-multi">post 10 video.</span>
              </span>
              <span className="block">Anda baru fikir.</span>
            </h1>

            <p
              className="text-lg sm:text-xl text-[var(--color-text-secondary)] mb-8 leading-relaxed max-w-xl animate-fade-in-up"
              style={{ animationDelay: "0.2s", opacity: 1 }}
            >
              <strong className="text-[var(--color-text-primary)]">
                PeningLab catch up dalam 3 minit.
              </strong>{" "}
              Letak link produk TikTok Shop — AI hasilkan 10 video UGC dengan
              dialog Bahasa Melayu, muka avatar, caption auto-post siap. Tanpa
              shoot, tanpa hire creator, tanpa muka anda tersebar.
            </p>

            <div
              className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6 animate-fade-in-up"
              style={{ animationDelay: "0.3s", opacity: 1 }}
            >
              <Link href="/register" className="btn-primary group">
                Mula Sekarang — 2 Video FREE
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
              </Link>
              <a href="#demo" className="btn-secondary">
                <PlayCircle className="w-4 h-4" />
                Tengok 20 demo
              </a>
            </div>

            {/* Scarcity activity strip — live signal */}
            <div
              className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs sm:text-sm animate-fade-in-up"
              style={{ animationDelay: "0.4s", opacity: 1 }}
            >
              <div className="flex items-center gap-2">
                <div className="avatar-stack flex">
                  {[
                    "from-violet-400 to-pink-400",
                    "from-blue-400 to-violet-500",
                    "from-pink-400 to-amber-300",
                    "from-emerald-400 to-blue-400",
                  ].map((g, i) => (
                    <div
                      key={i}
                      className={`w-7 h-7 rounded-full bg-gradient-to-br ${g} ring-2 ring-white`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex">
                    {[...Array(5)].map((_, i) => (
                      <Star
                        key={i}
                        className="w-3 h-3 fill-amber-400 text-amber-400"
                      />
                    ))}
                  </div>
                  <span className="text-[var(--color-text-secondary)]">
                    4.9 rating
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[var(--color-text-secondary)]">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span>
                  <strong className="text-[var(--color-text-primary)]">
                    7 seller
                  </strong>{" "}
                  generate video sekarang
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[var(--color-text-secondary)]">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>30-day money-back</span>
              </div>
            </div>
          </div>

          {/* Right: AI-generated hero comparison image (struggle vs abundance) */}
          <div className="lg:col-span-5 relative">
            <div
              className="relative max-w-[440px] mx-auto animate-fade-in-up"
              style={{ animationDelay: "0.3s", opacity: 1 }}
            >
              <div
                className="relative rounded-[28px] overflow-hidden border border-[var(--color-border)] shadow-2xl shadow-orange-500/25 animate-float"
                style={{ aspectRatio: "9 / 14" }}
              >
                <Image
                  src="https://zoxgcqlqovkvlrmpcikt.supabase.co/storage/v1/object/public/demos/hero-comparison.png"
                  alt="Kompetitor dah post 10 video. Anda baru fikir."
                  width={440}
                  height={686}
                  priority
                  sizes="(max-width: 768px) 100vw, 440px"
                  className="w-full h-full object-cover"
                />
                {/* Subtle vignette so floating labels read clearly */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, transparent 30%, transparent 70%, rgba(0,0,0,0.4) 100%)",
                  }}
                />
              </div>

              {/* Floating labels — emphasize the comparison */}
              <div
                className="absolute -left-4 top-10 px-3 py-2 rounded-2xl shadow-lg animate-float"
                style={{
                  background: "rgba(20, 20, 20, 0.85)",
                  backdropFilter: "blur(12px)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  animationDelay: "1s",
                }}
              >
                <div className="text-[10px] font-mono uppercase tracking-widest text-red-400 font-bold mb-0.5">
                  Anda
                </div>
                <div className="text-xs font-bold text-white">1 video / hari</div>
              </div>

              <div
                className="absolute -right-4 top-1/3 px-3 py-2 rounded-2xl shadow-lg animate-float"
                style={{
                  background: "rgba(20, 20, 20, 0.85)",
                  backdropFilter: "blur(12px)",
                  border: "1px solid rgba(200, 245, 62, 0.4)",
                  animationDelay: "2s",
                }}
              >
                <div className="text-[10px] font-mono uppercase tracking-widest font-bold mb-0.5" style={{ color: "var(--color-lime)" }}>
                  Kompetitor
                </div>
                <div className="text-xs font-bold text-white">10 video / hari</div>
              </div>

              <div
                className="absolute -left-6 bottom-10 px-3 py-2 rounded-2xl shadow-lg animate-float"
                style={{
                  background: "rgba(20, 20, 20, 0.85)",
                  backdropFilter: "blur(12px)",
                  border: "1px solid rgba(255, 87, 34, 0.4)",
                  animationDelay: "3s",
                }}
              >
                <div className="flex items-center gap-1.5">
                  <Zap className="w-3 h-3" style={{ color: "var(--color-orange)" }} />
                  <span className="text-xs font-bold text-white">PeningLab catch up</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* USP Strip — three killer differentiators, immediately after hero */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 -mt-4 mb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* USP 1 — Speed: 100 video / 1 minute */}
          <div
            className="relative overflow-hidden rounded-3xl p-7 border"
            style={{
              background:
                "linear-gradient(135deg, rgba(255,87,34,0.08) 0%, rgba(255,87,34,0.02) 100%)",
              borderColor: "rgba(255,87,34,0.25)",
            }}
          >
            <div
              className="absolute -top-12 -right-12 w-40 h-40 rounded-full pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle, rgba(255,87,34,0.25), transparent 70%)",
                filter: "blur(30px)",
              }}
            />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(255,87,34,0.15)", border: "1px solid rgba(255,87,34,0.3)" }}
                >
                  <Zap className="w-5 h-5" style={{ color: "var(--color-orange)" }} strokeWidth={2.4} />
                </div>
                <span className="text-[10px] font-mono uppercase tracking-widest font-bold" style={{ color: "var(--color-orange)" }}>
                  Kelajuan
                </span>
              </div>
              <h3 className="font-display font-extrabold text-3xl mb-2 text-[var(--color-text-primary)]">
                100 video <span style={{ color: "var(--color-orange)" }}>/ 1 minit</span>
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                Generate seluruh content month plan dalam masa anda makan lunch. Kompetitor tak boleh catch up.
              </p>
            </div>
          </div>

          {/* USP 2 — Price: cheapest on planet */}
          <div
            className="relative overflow-hidden rounded-3xl p-7 border"
            style={{
              background:
                "linear-gradient(135deg, rgba(200,245,62,0.08) 0%, rgba(200,245,62,0.02) 100%)",
              borderColor: "rgba(200,245,62,0.3)",
            }}
          >
            <div
              className="absolute -top-12 -right-12 w-40 h-40 rounded-full pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle, rgba(200,245,62,0.25), transparent 70%)",
                filter: "blur(30px)",
              }}
            />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(200,245,62,0.15)", border: "1px solid rgba(200,245,62,0.35)" }}
                >
                  <Wallet className="w-5 h-5" style={{ color: "var(--color-lime)" }} strokeWidth={2.4} />
                </div>
                <span className="text-[10px] font-mono uppercase tracking-widest font-bold" style={{ color: "var(--color-lime)" }}>
                  Harga
                </span>
              </div>
              <h3 className="font-display font-extrabold text-3xl mb-2 text-[var(--color-text-primary)]">
                Termurah <span style={{ color: "var(--color-lime)" }}>di planet ni</span>
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                Bermula RM35/bulan untuk akses penuh — 4 tier ikut bajet. Kompetitor charge RM500+. Maths senang — ROI dalam 1 video viral.
              </p>
            </div>
          </div>

          {/* USP 3 — Easy: simplest, best result */}
          <div
            className="relative overflow-hidden rounded-3xl p-7 border"
            style={{
              background:
                "linear-gradient(135deg, rgba(255,183,0,0.08) 0%, rgba(255,183,0,0.02) 100%)",
              borderColor: "rgba(255,183,0,0.3)",
            }}
          >
            <div
              className="absolute -top-12 -right-12 w-40 h-40 rounded-full pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle, rgba(255,183,0,0.25), transparent 70%)",
                filter: "blur(30px)",
              }}
            />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(255,183,0,0.15)", border: "1px solid rgba(255,183,0,0.35)" }}
                >
                  <Sparkles className="w-5 h-5" style={{ color: "var(--color-amber)" }} strokeWidth={2.4} />
                </div>
                <span className="text-[10px] font-mono uppercase tracking-widest font-bold" style={{ color: "var(--color-amber)" }}>
                  Senang
                </span>
              </div>
              <h3 className="font-display font-extrabold text-3xl mb-2 text-[var(--color-text-primary)]">
                Senang. <span style={{ color: "var(--color-amber)" }}>Hasil terbaik.</span>
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                3 step: letak link → AI plan → download. Anak 12 tahun pun boleh handle. Hasil siap auto-post.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Fear question hook — dark dramatic break, rekalab-style direct attack */}
      <section className="relative z-10 my-12">
        <div className="mx-auto max-w-6xl px-6">
          <div
            className="relative overflow-hidden rounded-3xl text-center py-14 sm:py-20 px-6"
            style={{
              background:
                "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #312e81 100%)",
            }}
          >
            {/* Decorative glow */}
            <div
              className="absolute"
              style={{
                top: "20%",
                left: "10%",
                width: 300,
                height: 300,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, rgba(239,68,68,0.25), transparent 70%)",
                filter: "blur(40px)",
              }}
            />
            <div
              className="absolute"
              style={{
                bottom: "10%",
                right: "5%",
                width: 250,
                height: 250,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, rgba(245,158,11,0.2), transparent 70%)",
                filter: "blur(40px)",
              }}
            />

            <div className="relative">
              <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full bg-red-500/15 border border-red-400/30">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                <span className="text-xs font-bold uppercase tracking-widest text-red-300">
                  Realiti pahit
                </span>
              </div>
              <h2 className="font-display font-extrabold text-3xl sm:text-5xl md:text-6xl text-white leading-[1.1] mb-6 max-w-4xl mx-auto">
                Orang lain dah pecut dengan AI.
                <br />
                <span
                  style={{
                    background:
                      "linear-gradient(135deg, #f87171 0%, #fb923c 50%, #fbbf24 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  Anda masih struggle?
                </span>
              </h2>
              <p className="text-base sm:text-lg text-white/70 leading-relaxed max-w-2xl mx-auto mb-8">
                Setiap pagi anda buka TikTok Shop. Sales lambat. Reach turun.
                Energy habis. Sementara itu, kompetitor anda dah post 10 video
                baru — guna AI yang anda belum jumpa.
              </p>
              <Link
                href="/register"
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl font-bold text-sm sm:text-base shadow-2xl hover:scale-[1.03] transition-transform"
                style={{ background: "var(--color-lime)", color: "#0a0a0a" }}
              >
                <Flame className="w-4 h-4" style={{ color: "#0a0a0a" }} />
                Saya nak catch up sekarang
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar — boxed container, lime accent numbers */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-12">
        <div
          className="relative overflow-hidden rounded-3xl px-6 sm:px-10 py-8 sm:py-10 border"
          style={{
            background:
              "linear-gradient(135deg, rgba(200,245,62,0.05) 0%, rgba(200,245,62,0.02) 100%)",
            borderColor: "rgba(200,245,62,0.2)",
          }}
        >
          <div
            className="absolute -top-24 -right-24 w-72 h-72 rounded-full pointer-events-none"
            style={{
              background:
                "radial-gradient(circle, rgba(200,245,62,0.15), transparent 70%)",
              filter: "blur(40px)",
            }}
          />
          <div className="relative grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12 text-center">
            {STATS.map((s, i) => (
              <div key={i}>
                <div
                  className="font-display font-extrabold text-4xl sm:text-5xl md:text-6xl tracking-tight"
                  style={{ color: "var(--color-lime)" }}
                >
                  {s.num}
                </div>
                <div className="text-xs sm:text-sm text-[var(--color-text-secondary)] mt-2 font-medium">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pain agitation */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-24">
        <div className="text-center mb-12">
          <div className="chip mb-5">
            <Flame className="w-3.5 h-3.5" />
            <span>Realiti seller TikTok Shop</span>
          </div>
          <h2 className="section-heading max-w-3xl mx-auto">
            Setiap hari tanpa video baru ={" "}
            <span className="gradient-text-warm">duit hilang</span>.
          </h2>
        </div>

        <div className="grid md:grid-cols-3 lg:grid-cols-5 gap-4">
          {[
            {
              icon: Clock,
              title: "Tak Cukup Masa",
              desc: "Antara reply customer, pack barang, fikir ad — masa untuk shoot video memang takde.",
            },
            {
              icon: Camera,
              title: "Ketandusan Content",
              desc: "Idea video dah habis. Recycle yang sama je. Algorithm tak suka — reach makin turun.",
            },
            {
              icon: Brain,
              title: "Zero Knowledge AI",
              desc: "Banyak tool AI tapi semua kompleks. Setiap satu kena pelajari sendiri. Pening kepala.",
            },
            {
              icon: TrendingUp,
              title: "Susah Nak Grow",
              desc: "Competitor post 5–10 video sehari. Anda sorang? Mustahil nak menang algorithm + impression.",
            },
            {
              icon: Gauge,
              title: "Production Slow",
              desc: "Brief creator → 1 minggu. Edit → 2–3 hari. Dapat satu video, idea dah basi pulak.",
            },
          ].map((p, i) => {
            const Icon = p.icon;
            return (
              <div key={i} className="card group" style={{ borderColor: "rgba(239,68,68,0.18)" }}>
                {/* Subtle red glow on hover */}
                <div
                  className="absolute -top-10 -right-10 w-32 h-32 rounded-full pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{
                    background:
                      "radial-gradient(circle, rgba(239,68,68,0.25), transparent 70%)",
                    filter: "blur(20px)",
                  }}
                />
                <div className="relative">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
                    style={{
                      background: "rgba(239,68,68,0.12)",
                      border: "1px solid rgba(239,68,68,0.3)",
                    }}
                  >
                    <Icon className="w-7 h-7 text-red-400" strokeWidth={2.2} />
                  </div>
                  <h3 className="font-display font-bold text-2xl mb-3 text-[var(--color-text-primary)]">
                    {p.title}
                  </h3>
                  <p className="text-[var(--color-text-secondary)] leading-relaxed">
                    {p.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom callout — dark dramatic on dark theme */}
        <div
          className="relative mt-12 mx-auto max-w-3xl text-center p-8 sm:p-10 rounded-3xl overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(255,87,34,0.08) 100%)",
            border: "1px solid rgba(255,87,34,0.35)",
          }}
        >
          <div
            className="absolute -top-20 -left-20 w-64 h-64 rounded-full pointer-events-none"
            style={{
              background:
                "radial-gradient(circle, rgba(239,68,68,0.3), transparent 70%)",
              filter: "blur(40px)",
            }}
          />
          <div
            className="absolute -bottom-20 -right-20 w-64 h-64 rounded-full pointer-events-none"
            style={{
              background:
                "radial-gradient(circle, rgba(255,87,34,0.3), transparent 70%)",
              filter: "blur(40px)",
            }}
          />
          <div className="relative">
            <div className="font-display font-extrabold text-2xl md:text-3xl mb-3 text-[var(--color-text-primary)] leading-tight">
              Sementara anda fikir, kompetitor anda{" "}
              <span
                style={{
                  background:
                    "linear-gradient(135deg, #f87171 0%, #fb923c 50%, #fbbf24 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                post 10 video sehari
              </span>
              .
            </div>
            <p className="text-[var(--color-text-secondary)] leading-relaxed">
              Algorithm TikTok suka volume + consistency. Yang lambat, kalah.
            </p>
          </div>
        </div>
      </section>

      {/* Capabilities Bento Grid — distinctive layout */}
      <section
        id="features"
        className="relative z-10 mx-auto max-w-7xl px-6 py-24"
      >
        <div className="text-center mb-10">
          <div className="chip mb-5">
            <Flame className="w-3.5 h-3.5" />
            <span>Advantage anda — yang kompetitor tak nak anda jumpa</span>
          </div>
          <h2 className="section-heading max-w-3xl mx-auto">
            5 senjata yang akan buat kompetitor anda{" "}
            <span className="gradient-text-warm">menyesal lambat sehari</span>.
          </h2>
          <p className="mt-5 text-lg text-[var(--color-text-secondary)] max-w-2xl mx-auto">
            Setiap saat anda baca ni, kompetitor post 1 video lagi. Algorithm tak tunggu —{" "}
            <strong className="text-[var(--color-text-primary)]">yang lambat, kalah</strong>.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Large card — Auto Content (FEAR: writer's block costs sales) */}
          <div className="md:col-span-2 bento relative overflow-hidden" style={{ minHeight: 380 }}>
            {/* Hero image overlay — subtle, behind content */}
            <div className="absolute inset-0 opacity-25 pointer-events-none">
              <Image
                src="https://zoxgcqlqovkvlrmpcikt.supabase.co/storage/v1/object/public/demos/bento-auto-content.png"
                alt=""
                width={600}
                height={600}
                style={{ width: "100%", height: "auto" }}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-white via-white/85 to-white/30" />
            </div>
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-violet-50 border border-orange-100 flex items-center justify-center">
                  <Wand2 className="w-6 h-6 text-violet-600" strokeWidth={2.2} />
                </div>
                <div className="tag-mono">★ STOP THE PANIC</div>
              </div>
              <h3 className="font-display font-extrabold text-3xl md:text-4xl mb-3 leading-tight">
                10 hari content.
                <br />
                <span className="gradient-text-violet">Sekali klik.</span>
              </h3>
              <p className="text-[var(--color-text-secondary)] leading-relaxed mb-6 max-w-md">
                Stop fikir nak shoot apa esok. AI Creative Director plan 10 video — framework, hook, dialog BM, CTA — siap untuk minggu depan tanpa anda angkat phone.
              </p>
              {/* Real video poster thumbnails — first frame from actual demo reels */}
              <div className="flex gap-2.5">
                {[
                  { src: "reel-1.mp4", label: "v1" },
                  { src: "reel-2.mp4", label: "v2" },
                  { src: "reel-7.mp4", label: "v3" },
                ].map((v, i) => (
                  <div
                    key={i}
                    className="flex-1 aspect-[9/16] max-w-[80px] rounded-xl overflow-hidden border border-white/10 shadow-md bg-black relative"
                  >
                    <LazyVideo
                      src={`https://zoxgcqlqovkvlrmpcikt.supabase.co/storage/v1/object/public/demos/${v.src}#t=1`}
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                    <div className="absolute bottom-1.5 left-1.5 text-[8px] font-bold text-white">
                      {v.label}
                    </div>
                  </div>
                ))}
                <div
                  className="flex-1 aspect-[9/16] max-w-[80px] rounded-xl border-2 border-dashed flex items-center justify-center text-[10px] font-bold"
                  style={{
                    borderColor: "rgba(255,87,34,0.4)",
                    color: "var(--color-orange)",
                  }}
                >
                  +17
                </div>
              </div>
            </div>
          </div>

          {/* Gen Image — Avatar UGC (EMOTION: privacy + scale) */}
          <div className="bento relative overflow-hidden">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center">
                <ImageIcon className="w-5 h-5 text-blue-600" strokeWidth={2.2} />
              </div>
              <div className="tag-mono tag-mono-blue">PROTECT IDENTITY</div>
            </div>
            <h3 className="font-display font-bold text-2xl mb-2 leading-tight">
              Muka anda{" "}
              <span className="text-blue-600">bukan jenama</span> anda.
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-4">
              Tak nak muka anda jadi viral di TikTok? Pakai avatar AI. Hijab, no-hijab, lelaki, perempuan — tukar ikut market sambil identity terlindung.
            </p>
            {/* Real avatar faces — generated, not placeholder gradients */}
            <div className="flex gap-2">
              {[
                "avatar-hijab-young.png",
                "avatar-hijab-mature.png",
                "avatar-male-young.png",
                "avatar-no-hijab.png",
              ].map((file, i) => (
                <div
                  key={i}
                  className="w-12 h-12 rounded-full overflow-hidden border-2 border-white shadow-lg ring-2 ring-blue-100"
                >
                  <Image
                    src={`https://zoxgcqlqovkvlrmpcikt.supabase.co/storage/v1/object/public/demos/${file}`}
                    alt=""
                    width={48}
                    height={48}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
              <div className="w-12 h-12 rounded-full border-2 border-dashed border-blue-300 flex items-center justify-center text-xs text-blue-500 font-bold">
                +∞
              </div>
            </div>
          </div>

          {/* Gen Video (URGENCY: time decay) */}
          <div className="bento relative overflow-hidden">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-xl bg-pink-50 border border-pink-100 flex items-center justify-center">
                <Video className="w-5 h-5 text-pink-600" strokeWidth={2.2} />
              </div>
              <div className="tag-mono tag-mono-pink">ALGORITHM TAK TUNGGU</div>
            </div>
            <h3 className="font-display font-bold text-2xl mb-2 leading-tight">
              Sambil baca ni —{" "}
              <span className="text-pink-600">kompetitor post 3 video</span>.
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-3">
              AI keluarkan video siap dalam 60 saat. Lambat sehari = kena 3× harder esok.
            </p>
            {/* Hero image — viral phone with notification bubbles */}
            <div className="relative aspect-[16/10] rounded-xl overflow-hidden border border-pink-100 mb-3 bg-gradient-to-br from-pink-50 to-orange-50">
              <Image
                src="https://zoxgcqlqovkvlrmpcikt.supabase.co/storage/v1/object/public/demos/bento-veo-viral.png"
                alt=""
                width={600}
                height={600}
                style={{ width: "100%", height: "auto" }}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="px-2 py-1 rounded bg-pink-50 text-pink-700 border border-pink-100">8s</span>
              <span className="px-2 py-1 rounded bg-pink-50 text-pink-700 border border-pink-100">16s</span>
              <span className="text-[var(--color-text-muted)]">9:16 · Real lip-sync · UGC</span>
            </div>
          </div>

          {/* Clone Mode (EMOTION: secret weapon) */}
          <div className="bento relative overflow-hidden">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center">
                <Layers className="w-5 h-5 text-amber-600" strokeWidth={2.2} />
              </div>
              <div className="tag-mono tag-mono-amber">REVERSE-ENGINEER</div>
            </div>
            <h3 className="font-display font-bold text-2xl mb-2 leading-tight">
              Video orang dah viral?{" "}
              <span className="text-amber-600">Curi formula dia.</span>
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-3">
              Upload video kompetitor yang hits. AI extract setiap shot, dialog, hook — recreate dengan produk dan muka anda.
            </p>
            <div className="relative aspect-[16/10] rounded-xl overflow-hidden border border-amber-100 mb-3 bg-gradient-to-br from-amber-50 to-orange-50">
              <Image
                src="https://zoxgcqlqovkvlrmpcikt.supabase.co/storage/v1/object/public/demos/bento-clone-spy.png"
                alt=""
                width={600}
                height={600}
                style={{ width: "100%", height: "auto" }}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="px-2 py-1 rounded-md bg-amber-50 border border-amber-100 text-amber-700 font-semibold">
                Viral
              </span>
              <ChevronRight className="w-3 h-3 text-amber-400" />
              <span className="px-2 py-1 rounded-md bg-amber-100 border border-amber-200 text-amber-800 font-semibold">
                Versi anda
              </span>
            </div>
          </div>

          {/* Auto Post (EMOTION: passive income while sleeping) */}
          <div className="bento relative overflow-hidden">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                <Send className="w-5 h-5 text-emerald-600" strokeWidth={2.2} />
              </div>
              <div className="tag-mono tag-mono-emerald">SLEEP, AI WORKS</div>
            </div>
            <h3 className="font-display font-bold text-2xl mb-2 leading-tight">
              Tidur. AI hantar.{" "}
              <span className="text-emerald-600">Sales masuk pagi.</span>
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-3">
              Schedule 30 hari sekaligus. Kompetitor masih buat manual — anda dah dapat data peak hour.
            </p>
            <div className="relative aspect-[16/10] rounded-xl overflow-hidden border border-emerald-100 mb-3 bg-gradient-to-br from-emerald-50 to-slate-50">
              <Image
                src="https://zoxgcqlqovkvlrmpcikt.supabase.co/storage/v1/object/public/demos/bento-autopost-sales.png"
                alt=""
                width={600}
                height={600}
                style={{ width: "100%", height: "auto" }}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex -space-x-1">
                <div className="w-5 h-5 rounded bg-emerald-200 border border-white" />
                <div className="w-5 h-5 rounded bg-emerald-300 border border-white" />
                <div className="w-5 h-5 rounded bg-emerald-400 border border-white" />
              </div>
              <span className="text-xs text-[var(--color-text-muted)] font-mono">Mon→Sun • 24/7</span>
            </div>
          </div>
        </div>
      </section>

      {/* Live AI-generated demo reel */}
      <DemoReel />

      {/* Before / After */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="section-heading">
            Manual vs <span className="gradient-text-violet">PeningLab</span>
          </h2>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {/* Manual — red-tinted dark card */}
          <div
            className="card relative"
            style={{
              background:
                "linear-gradient(180deg, rgba(239,68,68,0.06) 0%, var(--color-bg-card) 100%)",
              borderColor: "rgba(239,68,68,0.25)",
            }}
          >
            <div className="text-xs font-mono uppercase tracking-wider text-red-400 mb-3 font-bold">
              ❌ Cara lama
            </div>
            <h3 className="font-display font-bold text-2xl mb-5 text-[var(--color-text-primary)]">
              Shoot manual
            </h3>
            <ul className="space-y-3">
              {[
                "Cari freelancer creator (1–2 minggu)",
                "Brief + script (4 jam)",
                "Shoot video (1 hari)",
                "Edit + revise (2–3 hari)",
                "Tulis caption + hashtag (30 min)",
                "Upload manual setiap video",
                "Total: ~7 hari, 10 video, ~RM300/video",
              ].map((t, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2.5 text-sm text-[var(--color-text-secondary)]"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-2 flex-shrink-0" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* PeningLab — lime-tinted dark card */}
          <div
            className="card relative"
            style={{
              background:
                "linear-gradient(180deg, rgba(200,245,62,0.06) 0%, var(--color-bg-card) 100%)",
              borderColor: "rgba(200,245,62,0.3)",
            }}
          >
            <div
              className="absolute top-4 right-4 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
              style={{ background: "var(--color-lime)", color: "#0a0a0a" }}
            >
              750× lebih murah
            </div>
            <div
              className="text-xs font-mono uppercase tracking-wider mb-3 font-bold"
              style={{ color: "var(--color-lime)" }}
            >
              ✓ Cara PeningLab
            </div>
            <h3 className="font-display font-bold text-2xl mb-5 text-[var(--color-text-primary)]">
              Auto dengan AI
            </h3>
            <ul className="space-y-3">
              {[
                "Paste link produk (10 saat)",
                "Pilih kuantiti + duration (5 saat)",
                "AI Director plan 10 video (30 saat)",
                "AI generate 10 video parallel (2 min)",
                "Caption + hashtag auto-tulis (auto)",
                "Auto-post ke TikTok atau download MP4",
                "Total: ~3 minit, 100 video, ~40 sen/video",
              ].map((t, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2.5 text-sm text-[var(--color-text-primary)]"
                >
                  <CheckCircle2
                    className="w-4 h-4 mt-0.5 flex-shrink-0"
                    style={{ color: "var(--color-lime)" }}
                  />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Marquee testimonials */}
      <section className="relative z-10 py-24">
        <div className="text-center mb-12 px-6">
          <div className="chip mb-5">
            <Quote className="w-3.5 h-3.5" />
            <span>Real seller, real result</span>
          </div>
          <h2 className="section-heading">Bukan janji kosong.</h2>
        </div>

        <div className="relative marquee-mask">
          <div className="marquee-track py-4">
            {[...TESTIMONIALS, ...TESTIMONIALS].map((t, i) => (
              <div
                key={i}
                className="card flex-shrink-0 w-[340px]"
              >
                <div className="flex items-center gap-0.5 mb-3">
                  {[...Array(5)].map((_, j) => (
                    <Star
                      key={j}
                      className="w-3.5 h-3.5 fill-amber-400 text-amber-400"
                    />
                  ))}
                </div>
                <p className="text-[var(--color-text-primary)] leading-relaxed mb-5 text-sm">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="flex items-center gap-3 pt-4 border-t border-[var(--color-border)]">
                  <div
                    className={`w-9 h-9 rounded-full bg-gradient-to-br ${t.avatar}`}
                  />
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
        </div>
      </section>

      {/* Pricing */}
      <section
        id="pricing"
        className="relative z-10 mx-auto max-w-6xl px-6 py-24"
      >
        <div className="text-center mb-10">
          <div className="chip mb-5">Pricing</div>
          <h2 className="section-heading">
            Pilih plan, mula{" "}
            <span className="gradient-text-warm">scale UGC</span>.
          </h2>
          <p className="mt-5 text-lg text-[var(--color-text-secondary)] max-w-2xl mx-auto">
            Pilih tier ikut bajet — setiap plan datang dengan kredit RM
            terus boleh generate. Setiap generate auto-deduct ikut rate.
          </p>
        </div>

        {/* Countdown timer */}
        <Countdown />

        {/* 4-tier pricing grid */}
        <div className="mt-2">
          <PricingTiersGrid mode="marketing" />
        </div>

        {/* Livehost — separate package (RM500/mo), own card + dashboard */}
        <div className="mt-6">
          <LivehostCard mode="marketing" />
        </div>

        {/* Rate-deduction explainer */}
        <div className="card max-w-3xl mx-auto mt-10 p-6 md:p-7 bg-orange-50/40 border-orange-100">
          <div className="grid md:grid-cols-3 gap-5">
            <div className="flex items-start gap-3">
              <div className="step-pill flex-shrink-0">1</div>
              <div>
                <div className="font-display font-bold text-base mb-1">
                  Subscribe plan
                </div>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  Pilih tier (Starter / Standard / Pro / Premium) ikut bajet —
                  semua tier unlock features yang sama.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="step-pill flex-shrink-0">2</div>
              <div>
                <div className="font-display font-bold text-base mb-1">
                  Dapat kredit RM serta-merta
                </div>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  Setiap plan datang dengan RM credits sekali. Tak perlu top
                  up berasingan.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="step-pill flex-shrink-0">3</div>
              <div>
                <div className="font-display font-bold text-base mb-1">
                  Generate, auto-deduct
                </div>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  Image 20 sen, video 40 sen — auto-tolak setiap generate.
                </p>
              </div>
            </div>
          </div>
          <div className="mt-5 pt-5 border-t border-orange-100 text-center text-sm text-[var(--color-text-secondary)]">
            <span className="font-mono text-xs uppercase tracking-wider text-orange font-bold">
              Contoh
            </span>{" "}
            — Plan Pro RM100 + RM50 credits ={" "}
            <span className="font-bold text-[var(--color-text-primary)]">
              250 image
            </span>{" "}
            atau{" "}
            <span className="font-bold text-[var(--color-text-primary)]">
              125 video 8s
            </span>
            .
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-[var(--color-text-muted)]">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>30-day money back</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>Cancel bila-bila</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>FPX online banking via Chip</span>
          </div>
        </div>
      </section>

      {/* Checkout — direct continuation of pricing, same page */}
      <CheckoutForm />

      {/* FAQ */}
      <section className="relative z-10 mx-auto max-w-3xl px-6 py-24">
        <div className="text-center mb-12">
          <div className="chip mb-5">
            <Brain className="w-3.5 h-3.5" />
            <span>Soalan biasa</span>
          </div>
          <h2 className="section-heading">FAQ</h2>
        </div>

        <div className="space-y-3">
          {FAQ.map((f, i) => (
            <details key={i} className="faq-item">
              <summary>{f.q}</summary>
              <div className="faq-body">{f.a}</div>
            </details>
          ))}
        </div>
      </section>

      {/* Floating social proof toast */}
      <SocialProofToast />

      {/* Footer */}
      <footer className="relative z-10 border-t border-[var(--color-border)] mt-12">
        <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-[var(--color-text-muted)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-400 via-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/30">
              <Sparkles className="w-4 h-4 text-black" strokeWidth={2.5} />
            </div>
            <span className="font-display font-bold text-[var(--color-text-primary)]">
              PeningLab
            </span>
            <span>© 2026</span>
          </div>
          <div className="flex items-center gap-6">
            <a
              href="#"
              className="hover:text-[var(--color-text-primary)] transition"
            >
              Terms
            </a>
            <a
              href="#"
              className="hover:text-[var(--color-text-primary)] transition"
            >
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
