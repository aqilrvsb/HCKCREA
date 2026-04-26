"use client";

import { useEffect, useState } from "react";
import { Sparkles, Play, Loader2 } from "lucide-react";

type Manifest = {
  generated_at: string;
  videos: { id: string; label: string; file: string; kind: "video" }[];
  images: { id: string; label: string; file: string; kind: "image" }[];
  failed: { id: string; error: string }[];
};

// Auto-discovers /demos/manifest.json. Renders a marquee of generated videos
// + a 4-up grid of avatar images. If manifest is empty/missing, gracefully
// hides itself — page still works without it.
export default function DemoReel() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    fetch("/demos/manifest.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setManifest)
      .catch(() => setManifest(null));
  }, []);

  const videos = manifest?.videos || [];
  const images = manifest?.images || [];

  if (videos.length === 0 && images.length === 0) {
    // Nothing to show — render a strong placeholder section so the layout
    // still feels intentional while we wait for assets.
    return (
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-20">
        <div className="text-center mb-10">
          <div className="chip mb-5">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Live Output Reel</span>
          </div>
          <h2 className="section-heading">
            Output sebenar.{" "}
            <span className="gradient-text-warm">Bukan mockup.</span>
          </h2>
          <p className="mt-5 text-lg text-[var(--color-text-secondary)] max-w-2xl mx-auto">
            Setiap video di bawah dijana sepenuhnya oleh AI dalam 60–90 saat.
            Real face, real Malay accent, real product anchoring.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto">
          {[
            "from-orange-300 to-pink-300",
            "from-amber-300 to-orange-400",
            "from-pink-300 to-orange-300",
            "from-orange-200 to-amber-300",
          ].map((g, i) => (
            <div
              key={i}
              className={`aspect-[9/16] rounded-2xl bg-gradient-to-br ${g} relative overflow-hidden border border-white shadow-lg flex items-center justify-center`}
            >
              <Loader2 className="w-6 h-6 text-white animate-spin opacity-70" />
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-[var(--color-text-muted)] mt-6 font-mono uppercase tracking-widest">
          Generating live demos…
        </p>
      </section>
    );
  }

  const featured = videos[active] || videos[0];

  return (
    <section className="relative z-10 mx-auto max-w-6xl px-6 py-20">
      <div className="text-center mb-10">
        <div className="chip mb-5">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Live Output Reel</span>
        </div>
        <h2 className="section-heading">
          Output sebenar.{" "}
          <span className="gradient-text-warm">Bukan mockup.</span>
        </h2>
        <p className="mt-5 text-lg text-[var(--color-text-secondary)] max-w-2xl mx-auto">
          Setiap video di bawah dijana sepenuhnya oleh AI dalam 60–90 saat.
          Real face, real Malay accent, real product anchoring.
        </p>
      </div>

      {videos.length > 0 && (
        <div className="grid lg:grid-cols-5 gap-5 items-start">
          {/* Featured video — TikTok-style 9:16 vertical, centered */}
          <div className="lg:col-span-3 flex justify-center">
            <div className="relative rounded-3xl overflow-hidden border border-[var(--color-border)] shadow-2xl shadow-orange-500/15 bg-black w-full max-w-[400px]">
              <video
                key={featured?.file}
                src={featured?.file}
                controls
                autoPlay
                muted
                loop
                playsInline
                className="w-full aspect-[9/16] object-contain bg-black"
              />
              <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md text-[10px] font-bold uppercase tracking-widest text-white flex items-center gap-1.5 pointer-events-none">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                AI generated · live
              </div>
              {featured?.label && (
                <div className="absolute top-4 right-4 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md text-[10px] font-bold uppercase tracking-widest text-white pointer-events-none">
                  {featured.label}
                </div>
              )}
            </div>
          </div>

          {/* Side rail — other videos */}
          <div className="lg:col-span-2 space-y-3">
            <div className="text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              ─── More samples
            </div>
            {videos.map((v, i) => (
              <button
                key={v.id}
                onClick={() => setActive(i)}
                className={`w-full text-left rounded-2xl overflow-hidden border-2 transition-all ${
                  i === active
                    ? "border-orange shadow-lg shadow-orange-500/15"
                    : "border-[var(--color-border)] hover:border-orange-200"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-20 aspect-[9/16] flex-shrink-0 bg-black relative">
                    <video
                      src={v.file + "#t=1"}
                      preload="metadata"
                      muted
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <Play
                        className="w-5 h-5 text-white"
                        strokeWidth={2.5}
                        fill="white"
                      />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 py-3 pr-3">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-orange font-bold mb-0.5">
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    <div className="font-bold text-sm truncate">{v.label}</div>
                    <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                      8s · 9:16 · Veo 3.1
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Avatar variations grid */}
      {images.length > 0 && (
        <div className="mt-12">
          <div className="text-center mb-6">
            <div className="text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              ─── Avatar variations
            </div>
            <h3 className="font-display font-bold text-2xl">
              Pilih ikut market anda.
            </h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto">
            {images.map((img) => (
              <div
                key={img.id}
                className="relative aspect-[9/16] rounded-2xl overflow-hidden border border-[var(--color-border)] shadow-md"
              >
                <img
                  src={img.file}
                  alt={img.label}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-white/80 font-bold">
                    {img.label}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Powered by */}
      <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-[var(--color-text-muted)]">
        <span className="font-mono uppercase tracking-widest font-bold">
          Powered by:
        </span>
        <span className="font-bold text-[var(--color-text-primary)]">
          Google Veo 3.1
        </span>
        <span>·</span>
        <span className="font-bold text-[var(--color-text-primary)]">
          GPT Image 2
        </span>
        <span>·</span>
        <span className="font-bold text-[var(--color-text-primary)]">
          Banana Pro
        </span>
      </div>
    </section>
  );
}
