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
        <>
          {/* Featured player — centered, 9:16 vertical */}
          <div className="flex justify-center">
            <div className="relative rounded-3xl overflow-hidden border border-[var(--color-border)] shadow-2xl shadow-orange-500/15 bg-black w-full max-w-[380px]">
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

          {/* All variations — clickable grid */}
          <div className="mt-10">
            <div className="text-center mb-5">
              <div className="text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-1">
                ─── {videos.length} variations · klik untuk tukar
              </div>
              <h3 className="font-display font-bold text-xl">
                Setiap satu dijana dari prompt berbeza.
              </h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {videos.map((v, i) => (
                <button
                  key={v.id}
                  onClick={() => setActive(i)}
                  className={`group text-left rounded-2xl overflow-hidden border-2 transition-all ${
                    i === active
                      ? "border-orange shadow-lg shadow-orange-500/20 scale-[1.02]"
                      : "border-[var(--color-border)] hover:border-orange-300 hover:-translate-y-0.5"
                  }`}
                >
                  <div className="aspect-[9/16] bg-black relative">
                    <video
                      src={v.file + "#t=1"}
                      preload="metadata"
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/10 transition-colors">
                      <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                        <Play className="w-4 h-4 text-orange" strokeWidth={2.5} fill="currentColor" />
                      </div>
                    </div>
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-[9px] font-mono font-bold text-white">
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    {i === active && (
                      <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-orange text-[9px] font-bold uppercase tracking-wider text-white">
                        Playing
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                      <div className="text-[10px] font-bold text-white truncate">{v.label}</div>
                      <div className="text-[9px] text-white/70">8s · Veo 3.1</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
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
