"use client";

import Link from "next/link";
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

const STATS = [
  { num: "1,300+", label: "seller aktif" },
  { num: "47,000+", label: "video di-generate" },
  { num: "3 min", label: "purata satu video" },
  { num: "92%", label: "kadar kepuasan" },
];

const CAPABILITIES = [
  {
    icon: Wand2,
    tag: "AUTO CONTENT",
    tagColor: "violet",
    title: "10 video UGC dalam satu klik",
    desc: "Letak link TikTok Shop. AI Director susun framework, hook, dialog, CTA berbeza setiap video. Dapat 10 video siap caption.",
    size: "large",
  },
  {
    icon: ImageIcon,
    tag: "GEN IMAGE",
    tagColor: "blue",
    title: "Avatar UGC realistik",
    desc: "Hijab/no-hijab, lelaki/perempuan, umur, outfit — pilih sendiri. Bukan AI plastik.",
  },
  {
    icon: Video,
    tag: "GEN VIDEO",
    tagColor: "pink",
    title: "Veo 3.1 — 8s & 16s",
    desc: "Video quality TikTok-ready. Lip-sync sempurna, hand gesture natural, produk lock.",
  },
  {
    icon: Layers,
    tag: "CLONE MODE",
    tagColor: "amber",
    title: "Tiru video viral",
    desc: "Upload video referensi. AI extract setiap shot, recreate dengan produk anda.",
  },
  {
    icon: Send,
    tag: "AUTO POST",
    tagColor: "emerald",
    title: "Auto-post ke TikTok Shop",
    desc: "Schedule post automatik dengan caption + hashtag. Wake up, video dah live.",
  },
];

const STEPS = [
  {
    num: "01",
    title: "Letak link produk",
    desc: "Paste TikTok Shop URL. AI scrape gambar, harga, deskripsi automatik.",
    accent: "violet",
  },
  {
    num: "02",
    title: "AI Director susun plan",
    desc: "10 video unique — hook, framework, dialog Bahasa Melayu, CTA. Semua auto.",
    accent: "blue",
  },
  {
    num: "03",
    title: "Veo 3.1 generate video",
    desc: "8 saat atau 16 saat. Lip-sync, hand gesture, produk lock — quality UGC sebenar.",
    accent: "pink",
  },
  {
    num: "04",
    title: "Auto-post atau download",
    desc: "Caption + 5 hashtag siap. Schedule auto-post atau download MP4.",
    accent: "emerald",
  },
];

const TESTIMONIALS = [
  {
    quote: "Dulu spend RM3k sebulan kat creator. Sekarang RM147 dapat video lagi banyak. Sales naik 40%.",
    name: "Aina R.",
    title: "Skincare seller, KL",
    avatar: "from-violet-300 to-pink-300",
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
    avatar: "from-blue-300 to-violet-300",
  },
];

const FAQ = [
  {
    q: "Saya tak pandai shoot video, boleh guna ke?",
    a: "Boleh sangat. Itu sebab PeningLab wujud — anda tak perlu sentuh kamera langsung. Cukup paste link produk TikTok Shop, AI akan susun plan, generate video, dan tulis caption. Anda hanya perlu tekan butang.",
  },
  {
    q: "Berapa cepat saya boleh dapat video pertama?",
    a: "3 minit. Daftar sekarang, dapat 10 kredit free. Cukup untuk 2 video 8 saat. Tak perlu credit card.",
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
    q: "Kalau video tak best, ada money-back?",
    a: "Ada 30-day money back guarantee. Kalau anda rasa tak berbaloi, email kami dalam 30 hari, refund penuh — tiada soalan.",
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
          background: "radial-gradient(circle, #c4b5fd, transparent 70%)",
          width: 700,
          height: 700,
          top: -250,
          right: -150,
        }}
      />
      <div
        className="bg-soft-glow"
        style={{
          background: "radial-gradient(circle, #93c5fd, transparent 70%)",
          width: 600,
          height: 600,
          top: 50,
          left: -200,
        }}
      />
      <div className="bg-noise" />

      {/* Nav */}
      <nav className="relative z-20 mx-auto max-w-7xl px-6 py-5 flex items-center justify-between">
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

      {/* Hero — split layout, bold headline + product demo phone */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 pt-12 pb-20">
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          {/* Left: copy */}
          <div className="lg:col-span-7">
            <div
              className="inline-flex items-center gap-2 mb-7 chip chip-pulse animate-fade-in-up"
              style={{ opacity: 0 }}
            >
              <span>Live untuk seller TikTok Shop Malaysia</span>
            </div>

            <h1
              className="font-display font-extrabold tracking-tight text-5xl sm:text-6xl md:text-7xl leading-[0.95] mb-7 animate-fade-in-up"
              style={{ animationDelay: "0.1s", opacity: 0 }}
            >
              <span className="block">10 video UGC</span>
              <span className="block">
                untuk produk anda,{" "}
                <span className="gradient-text-multi">3 minit.</span>
              </span>
            </h1>

            <p
              className="text-lg sm:text-xl text-[var(--color-text-secondary)] mb-8 leading-relaxed max-w-xl animate-fade-in-up"
              style={{ animationDelay: "0.2s", opacity: 0 }}
            >
              Tak perlu shoot. Tak perlu hire creator. Letak link produk TikTok
              Shop — AI hasilkan 10 video UGC dengan dialog Bahasa Melayu, face
              natural, dan caption siap untuk auto-post.
            </p>

            <div
              className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-8 animate-fade-in-up"
              style={{ animationDelay: "0.3s", opacity: 0 }}
            >
              <Link href="/register" className="btn-primary group">
                Cuba Percuma — 10 Kredit
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
              </Link>
              <a href="#how" className="btn-secondary">
                <PlayCircle className="w-4 h-4" />
                Tengok demo
              </a>
            </div>

            <div
              className="flex items-center gap-4 text-sm text-[var(--color-text-muted)] animate-fade-in-up"
              style={{ animationDelay: "0.4s", opacity: 0 }}
            >
              <div className="avatar-stack flex">
                {[
                  "from-violet-400 to-pink-400",
                  "from-blue-400 to-violet-500",
                  "from-pink-400 to-amber-300",
                  "from-emerald-400 to-blue-400",
                ].map((g, i) => (
                  <div
                    key={i}
                    className={`w-8 h-8 rounded-full bg-gradient-to-br ${g} ring-2 ring-white`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className="w-3.5 h-3.5 fill-amber-400 text-amber-400"
                    />
                  ))}
                </div>
                <span>
                  <span className="text-[var(--color-text-primary)] font-bold">
                    1,300+
                  </span>{" "}
                  seller dah scale UGC
                </span>
              </div>
            </div>
          </div>

          {/* Right: phone mockup with TikTok-style preview */}
          <div className="lg:col-span-5 relative">
            <div
              className="relative max-w-[320px] mx-auto animate-fade-in-up"
              style={{ animationDelay: "0.3s", opacity: 0 }}
            >
              <div className="phone-frame animate-float">
                <div className="phone-screen">
                  {/* TikTok-style overlay UI */}
                  <div className="absolute inset-0 flex flex-col">
                    {/* Status bar mock */}
                    <div className="flex items-center justify-between px-5 pt-3 text-[10px] text-white/80 font-mono">
                      <span>9:41</span>
                      <span>•••</span>
                    </div>

                    {/* Video content placeholder — gradient pretending to be a UGC video */}
                    <div className="flex-1 relative">
                      <div
                        className="absolute inset-0"
                        style={{
                          background:
                            "linear-gradient(135deg, #1e1b4b 0%, #312e81 30%, #5b21b6 60%, #9333ea 100%)",
                        }}
                      />
                      {/* Soft "person silhouette" — abstract circle */}
                      <div
                        className="absolute"
                        style={{
                          top: "20%",
                          left: "50%",
                          transform: "translateX(-50%)",
                          width: 110,
                          height: 110,
                          borderRadius: "50%",
                          background:
                            "radial-gradient(circle at 50% 40%, #fde68a, #f59e0b 60%, transparent 80%)",
                          filter: "blur(2px)",
                          opacity: 0.85,
                        }}
                      />
                      {/* Product card hint at bottom */}
                      <div
                        className="absolute"
                        style={{
                          bottom: "16%",
                          left: "10%",
                          width: 70,
                          height: 70,
                          borderRadius: 12,
                          background:
                            "linear-gradient(135deg, #f59e0b, #ef4444)",
                          boxShadow: "0 6px 18px rgba(245, 158, 11, 0.5)",
                        }}
                      />

                      {/* Caption bubble */}
                      <div className="absolute bottom-[24%] left-3 right-16 text-white">
                        <div className="text-[11px] font-bold mb-1">
                          @aqil.skincare
                        </div>
                        <div className="text-[10px] leading-tight opacity-90">
                          Korang serius kena cuba ni 🔥 link beg kuning bawah!
                        </div>
                      </div>

                      {/* Right-side TikTok-style action stack */}
                      <div className="absolute right-2 bottom-[24%] flex flex-col items-center gap-3">
                        {[
                          { icon: "♥", label: "12k" },
                          { icon: "💬", label: "892" },
                          { icon: "⤴", label: "Share" },
                        ].map((a, i) => (
                          <div
                            key={i}
                            className="flex flex-col items-center gap-0.5"
                          >
                            <div className="w-8 h-8 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center text-white text-sm">
                              {a.icon}
                            </div>
                            <span className="text-[8px] text-white font-bold">
                              {a.label}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* AI chip floating */}
                      <div className="absolute top-12 left-3 px-2 py-1 rounded-full bg-white/15 backdrop-blur-md flex items-center gap-1">
                        <Sparkles className="w-2.5 h-2.5 text-white" />
                        <span className="text-[9px] font-bold text-white">
                          AI Generated
                        </span>
                      </div>
                    </div>

                    {/* Bottom nav mock */}
                    <div className="h-12 bg-black/50 backdrop-blur-sm flex items-center justify-around px-4">
                      {["Home", "Shop", "+", "Inbox", "Me"].map((t, i) => (
                        <span
                          key={i}
                          className={`text-[9px] font-semibold ${
                            i === 2 ? "text-white" : "text-white/60"
                          }`}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Floating tags around phone */}
              <div
                className="absolute -left-6 top-12 px-3 py-2 bg-white border border-[var(--color-border)] rounded-2xl shadow-lg animate-float"
                style={{ animationDelay: "1s" }}
              >
                <div className="text-[10px] text-[var(--color-text-muted)] font-mono uppercase tracking-wider mb-0.5">
                  Hook
                </div>
                <div className="text-xs font-bold">Eh korang tengok ni!</div>
              </div>

              <div
                className="absolute -right-4 top-1/3 px-3 py-2 bg-white border border-[var(--color-border)] rounded-2xl shadow-lg animate-float"
                style={{ animationDelay: "2s" }}
              >
                <div className="flex items-center gap-1.5">
                  <Zap className="w-3 h-3 text-amber-500" />
                  <span className="text-xs font-bold">8 saat ready</span>
                </div>
              </div>

              <div
                className="absolute -left-8 bottom-16 px-3 py-2 bg-white border border-[var(--color-border)] rounded-2xl shadow-lg animate-float"
                style={{ animationDelay: "3s" }}
              >
                <div className="text-[10px] text-[var(--color-text-muted)] font-mono uppercase tracking-wider mb-0.5">
                  CTA
                </div>
                <div className="text-xs font-bold">Klik link bawah!</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-12 text-center md:text-left">
          {STATS.map((s, i) => (
            <div key={i} className="relative">
              <div className="stat-num gradient-text-violet">{s.num}</div>
              <div className="text-sm text-[var(--color-text-secondary)] mt-1">
                {s.label}
              </div>
            </div>
          ))}
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

        <div className="grid md:grid-cols-3 gap-5">
          {[
            {
              icon: Camera,
              title: "Tiada team videographer",
              desc: "Tak ada equipment. Tak ada talent UGC. Setiap kali nak buat video, kena cari freelancer baru — quality tak konsisten.",
            },
            {
              icon: Clock,
              title: "1 video = 1 hari penuh",
              desc: "Script, shoot, edit, upload. 30 video sebulan = burnout. Anda jadi videographer, bukan business owner.",
            },
            {
              icon: Wallet,
              title: "RM200–RM500 per video",
              desc: "30 video = RM15,000 sebulan. Margin produk hancur. Belum lagi creator delay, revisi, drama.",
            },
          ].map((p, i) => {
            const Icon = p.icon;
            return (
              <div key={i} className="card">
                <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mb-5">
                  <Icon className="w-7 h-7 text-red-500" strokeWidth={2} />
                </div>
                <h3 className="font-display font-bold text-2xl mb-3">
                  {p.title}
                </h3>
                <p className="text-[var(--color-text-secondary)] leading-relaxed">
                  {p.desc}
                </p>
              </div>
            );
          })}
        </div>

        <div
          className="mt-12 mx-auto max-w-3xl text-center p-8 rounded-3xl"
          style={{
            background:
              "linear-gradient(135deg, #fef3c7 0%, #fce7f3 100%)",
            border: "1px solid #fbbf24",
          }}
        >
          <div className="font-display font-extrabold text-2xl md:text-3xl mb-2">
            Sementara anda fikir, competitor anda{" "}
            <span className="text-pink">post 10 video sehari</span>.
          </div>
          <p className="text-[var(--color-text-secondary)]">
            Algorithm TikTok suka volume + consistency. Yang lambat, kalah.
          </p>
        </div>
      </section>

      {/* Capabilities Bento Grid — distinctive layout */}
      <section
        id="features"
        className="relative z-10 mx-auto max-w-7xl px-6 py-24"
      >
        <div className="text-center mb-14">
          <div className="chip mb-5">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Stack penuh dalam satu platform</span>
          </div>
          <h2 className="section-heading max-w-3xl mx-auto">
            Bukan satu tool —{" "}
            <span className="gradient-text-violet">studio penuh</span> dalam
            cloud.
          </h2>
          <p className="mt-5 text-lg text-[var(--color-text-secondary)] max-w-2xl mx-auto">
            5 capabilities. Satu dashboard. Tak perlu jump-jump tool lain.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Large card — Auto Content */}
          <div className="md:col-span-2 bento" style={{ minHeight: 320 }}>
            <div className="bento-deco" style={{ top: -40, right: -40, width: 200, height: 200 }}>
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "50%",
                  background:
                    "radial-gradient(circle, rgba(139,92,246,0.25), transparent 70%)",
                }}
              />
            </div>
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center">
                  <Wand2 className="w-6 h-6 text-violet-600" strokeWidth={2.2} />
                </div>
                <div className="tag-mono">★ MOST USED</div>
              </div>
              <h3 className="font-display font-extrabold text-3xl md:text-4xl mb-3 leading-tight">
                Auto Content
                <br />
                <span className="gradient-text-violet">10 video, 1 klik.</span>
              </h3>
              <p className="text-[var(--color-text-secondary)] leading-relaxed mb-6 max-w-md">
                AI Creative Director susun framework, hook, dialog Bahasa
                Melayu, dan CTA berbeza setiap video. Optimized untuk pasaran
                tempatan.
              </p>
              {/* Mini visual: 3 video thumbnail row */}
              <div className="flex gap-2.5">
                {[
                  "from-violet-300 to-pink-300",
                  "from-blue-300 to-violet-300",
                  "from-pink-300 to-amber-300",
                ].map((g, i) => (
                  <div
                    key={i}
                    className={`flex-1 aspect-[9/16] max-w-[80px] rounded-xl bg-gradient-to-br ${g} relative overflow-hidden border border-white/40 shadow-md`}
                  >
                    <div className="absolute bottom-1.5 left-1.5 text-[8px] font-bold text-white/90">
                      v{i + 1}
                    </div>
                  </div>
                ))}
                <div className="flex-1 aspect-[9/16] max-w-[80px] rounded-xl border-2 border-dashed border-violet-200 flex items-center justify-center text-[10px] text-violet-400 font-bold">
                  +7
                </div>
              </div>
            </div>
          </div>

          {/* Gen Image */}
          <div className="bento">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center">
                <ImageIcon className="w-5 h-5 text-blue-600" strokeWidth={2.2} />
              </div>
              <div className="tag-mono tag-mono-blue">GEN IMAGE</div>
            </div>
            <h3 className="font-display font-bold text-2xl mb-2">
              Avatar UGC realistik
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-4">
              Hijab/no-hijab, gender, umur, outfit. Tukar ikut market anda.
            </p>
            <div className="flex gap-2">
              {[
                "from-rose-200 to-rose-300",
                "from-amber-200 to-amber-300",
                "from-blue-200 to-blue-300",
              ].map((g, i) => (
                <div
                  key={i}
                  className={`w-9 h-9 rounded-full bg-gradient-to-br ${g} border-2 border-white shadow-md`}
                />
              ))}
              <div className="w-9 h-9 rounded-full border-2 border-dashed border-blue-200 flex items-center justify-center text-[10px] text-blue-400 font-bold">
                +
              </div>
            </div>
          </div>

          {/* Gen Video */}
          <div className="bento">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-xl bg-pink-50 border border-pink-100 flex items-center justify-center">
                <Video className="w-5 h-5 text-pink-600" strokeWidth={2.2} />
              </div>
              <div className="tag-mono tag-mono-pink">GEN VIDEO</div>
            </div>
            <h3 className="font-display font-bold text-2xl mb-2">
              Veo 3.1 — 8s & 16s
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-4">
              Lip-sync sempurna, hand gesture natural, produk pixel-locked.
            </p>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="px-2 py-1 rounded bg-pink-50 text-pink-700 border border-pink-100">
                8s
              </span>
              <span className="px-2 py-1 rounded bg-pink-50 text-pink-700 border border-pink-100">
                16s
              </span>
              <span className="text-[var(--color-text-muted)]">9:16 ratio</span>
            </div>
          </div>

          {/* Clone Mode */}
          <div className="bento">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center">
                <Layers className="w-5 h-5 text-amber-600" strokeWidth={2.2} />
              </div>
              <div className="tag-mono tag-mono-amber">CLONE MODE</div>
            </div>
            <h3 className="font-display font-bold text-2xl mb-2">
              Tiru video viral
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-4">
              Upload video referensi + produk anda. AI extract setiap shot,
              recreate persis.
            </p>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="px-2 py-1 rounded-md bg-amber-50 border border-amber-100 text-amber-700 font-semibold">
                Reference
              </span>
              <ChevronRight className="w-3 h-3 text-amber-400" />
              <span className="px-2 py-1 rounded-md bg-amber-100 border border-amber-200 text-amber-800 font-semibold">
                Your version
              </span>
            </div>
          </div>

          {/* Auto Post */}
          <div className="bento">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                <Send className="w-5 h-5 text-emerald-600" strokeWidth={2.2} />
              </div>
              <div className="tag-mono tag-mono-emerald">AUTO POST</div>
            </div>
            <h3 className="font-display font-bold text-2xl mb-2">
              Schedule auto-post
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-4">
              Caption + hashtag siap. Drop ke TikTok Shop pada timing optimal.
            </p>
            <div className="flex items-center gap-2">
              <div className="flex -space-x-1">
                <div className="w-5 h-5 rounded bg-emerald-200 border border-white" />
                <div className="w-5 h-5 rounded bg-emerald-300 border border-white" />
                <div className="w-5 h-5 rounded bg-emerald-400 border border-white" />
              </div>
              <span className="text-xs text-[var(--color-text-muted)] font-mono">
                Mon→Sun • 24/7
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* How it works — 4 step process */}
      <section id="how" className="relative z-10 py-24">
        <div className="relative mx-auto max-w-6xl px-6">
          <div className="text-center mb-14">
            <div className="chip mb-5">
              <Zap className="w-3.5 h-3.5" />
              <span>Cara guna</span>
            </div>
            <h2 className="section-heading">
              Dari link produk →{" "}
              <span className="gradient-text-blue">10 video viral</span>.
            </h2>
            <p className="mt-5 text-lg text-[var(--color-text-secondary)] max-w-xl mx-auto">
              4 langkah. 3 minit. Auto.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {STEPS.map((s, i) => {
              const accentMap: Record<
                string,
                { bg: string; border: string; text: string }
              > = {
                violet: {
                  bg: "bg-violet-50",
                  border: "border-violet-200",
                  text: "text-violet-600",
                },
                blue: {
                  bg: "bg-blue-50",
                  border: "border-blue-200",
                  text: "text-blue-600",
                },
                pink: {
                  bg: "bg-pink-50",
                  border: "border-pink-200",
                  text: "text-pink-600",
                },
                emerald: {
                  bg: "bg-emerald-50",
                  border: "border-emerald-200",
                  text: "text-emerald-600",
                },
              };
              const a = accentMap[s.accent];
              return (
                <div
                  key={i}
                  className={`card ${a.bg} ${a.border}`}
                  style={{ background: undefined }}
                >
                  <div className="flex items-start gap-4">
                    <div className="step-pill flex-shrink-0">{s.num}</div>
                    <div>
                      <h3 className="font-display font-bold text-2xl mb-2">
                        {s.title}
                      </h3>
                      <p className="text-[var(--color-text-secondary)] leading-relaxed">
                        {s.desc}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Before / After */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="section-heading">
            Manual vs <span className="gradient-text-violet">PeningLab</span>
          </h2>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {/* Manual */}
          <div className="card border-red-100">
            <div className="text-xs font-mono uppercase tracking-wider text-red-500 mb-3">
              ❌ Cara lama
            </div>
            <h3 className="font-display font-bold text-2xl mb-5">
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
                "Total: ~7 hari, ~RM300/video",
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

          {/* PeningLab */}
          <div
            className="card relative"
            style={{
              background: "linear-gradient(180deg, #f5f3ff 0%, #ffffff 100%)",
              borderColor: "#c4b5fd",
            }}
          >
            <div className="absolute top-4 right-4 sticker">2× lebih murah</div>
            <div className="text-xs font-mono uppercase tracking-wider text-violet-600 mb-3">
              ✓ Cara PeningLab
            </div>
            <h3 className="font-display font-bold text-2xl mb-5">
              Auto dengan AI
            </h3>
            <ul className="space-y-3">
              {[
                "Paste link produk (10 saat)",
                "Pilih kuantiti + duration (5 saat)",
                "AI Director plan 10 video (30 saat)",
                "Veo generate video parallel (2 min)",
                "Caption + hashtag auto-tulis (auto)",
                "Auto-post ke TikTok atau download MP4",
                "Total: ~3 minit, ~RM5/video",
              ].map((t, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2.5 text-sm text-[var(--color-text-primary)]"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
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
                style={{ background: "white" }}
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
        <div className="text-center mb-14">
          <div className="chip mb-5">Pricing</div>
          <h2 className="section-heading">
            Pay per video.{" "}
            <span className="gradient-text-warm">Tiada drama.</span>
          </h2>
          <p className="mt-5 text-lg text-[var(--color-text-secondary)] max-w-2xl mx-auto">
            Kredit tak hangus. Top up bila perlu. Cancel bila-bila.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {[
            {
              name: "Starter",
              price: "RM47",
              period: "/bulan",
              desc: "Untuk seller mula auto-UGC",
              credits: "100 kredit",
              features: [
                "~25 video 8 saat",
                "Auto Content + Clone mode",
                "Caption Bahasa Melayu auto",
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
                "Auto-post TikTok scheduler",
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
                "API access (coming)",
              ],
              cta: "Hubungi kami",
              highlighted: false,
            },
          ].map((plan, i) => (
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
              <div className="mb-5">
                <h3 className="font-display font-bold text-xl mb-1">
                  {plan.name}
                </h3>
                <p className="text-sm text-[var(--color-text-muted)]">
                  {plan.desc}
                </p>
              </div>
              <div className="mb-5">
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
              <ul className="space-y-3 mb-7">
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
            <span>Tiada credit card untuk trial</span>
          </div>
        </div>
      </section>

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

      {/* Final CTA */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 py-24 text-center">
        <div
          className="relative overflow-hidden p-12 md:p-20 rounded-[36px]"
          style={{
            background:
              "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #5b21b6 100%)",
            border: "1px solid #6d28d9",
          }}
        >
          <div className="bg-noise" />
          <div
            className="absolute"
            style={{
              top: -100,
              left: -100,
              width: 400,
              height: 400,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(236, 72, 153, 0.5), transparent 70%)",
              filter: "blur(60px)",
            }}
          />
          <div
            className="absolute"
            style={{
              bottom: -100,
              right: -100,
              width: 400,
              height: 400,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(59, 130, 246, 0.5), transparent 70%)",
              filter: "blur(60px)",
            }}
          />

          <div className="relative">
            <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 backdrop-blur-md text-xs font-semibold text-white">
              <Gauge className="w-3 h-3" />
              <span>Mula dalam 60 saat</span>
            </div>
            <h2 className="font-display font-extrabold text-4xl sm:text-5xl md:text-6xl tracking-tight leading-[1.05] mb-5 text-white">
              Stop bayar creator.
              <br />
              <span className="gradient-text-multi">Start scale dengan AI.</span>
            </h2>
            <p className="text-lg text-white/80 mb-8 max-w-xl mx-auto">
              10 kredit free pertama anda — cukup untuk 2 video 8 saat. Tak
              perlu credit card. Tak perlu komitmen.
            </p>
            <Link
              href="/register"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-white text-[var(--color-text-primary)] font-bold text-base shadow-2xl hover:scale-105 transition-transform"
            >
              Daftar Percuma — Sekarang
              <ArrowRight className="w-4 h-4" />
            </Link>
            <div className="mt-6 flex items-center justify-center gap-2 text-sm text-white/60">
              <ShieldCheck className="w-4 h-4 text-emerald-300" />
              <span>30-day money back. Tiada drama.</span>
            </div>
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
