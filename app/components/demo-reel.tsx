"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Play, X } from "lucide-react";
import manifestData from "../../public/demos/manifest.json";

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
  // Manifest is bundled at build time — page renders instantly with full grid,
  // no fetch, no loading flash. Updated via the generate + upload scripts.
  const manifest = manifestData as Manifest;
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const featuredVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // Pause the featured player whenever a modal video is playing — no
    // double audio. Resume autoplay when the modal closes.
    const v = featuredVideoRef.current;
    if (!v) return;
    if (modalIndex !== null) {
      v.pause();
    } else {
      v.play().catch(() => {});
    }
  }, [modalIndex]);

  useEffect(() => {
    if (modalIndex === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setModalIndex(null);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [modalIndex]);

  const videos = manifest?.videos || [];
  const images = manifest?.images || [];
  const featured = videos[0];
  const modalVideo = modalIndex !== null ? videos[modalIndex] : null;

  return (
    <section id="demo" className="relative z-10 mx-auto max-w-6xl px-6 py-20">
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
                ref={featuredVideoRef}
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

          {/* All variations — clickable grid (excludes the featured-pinned video to avoid duplicate) */}
          <div className="mt-10">
            <div className="text-center mb-5">
              <div className="text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-1">
                ─── {videos.length - 1} variations lagi · klik untuk play
              </div>
              <h3 className="font-display font-bold text-xl">
                Setiap satu dijana dari prompt berbeza.
              </h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {videos.slice(1).map((v, originalOffset) => {
                const i = originalOffset + 1; // index in original videos array (modal lookup)
                const display = originalOffset + 1; // sequential 01..N for the grid label
                return (
                  <button
                    key={v.id}
                    onClick={() => setModalIndex(i)}
                    className="group text-left rounded-2xl overflow-hidden border-2 border-[var(--color-border)] hover:border-orange-300 hover:-translate-y-0.5 transition-all"
                  >
                    <div className="aspect-[9/16] bg-black relative">
                      <video
                        src={v.file + "#t=1"}
                        preload="none"
                        poster=""
                        muted
                        playsInline
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/10 transition-colors">
                        <div className="w-12 h-12 rounded-full bg-white/95 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                          <Play className="w-5 h-5 text-orange ml-0.5" strokeWidth={2.5} fill="currentColor" />
                        </div>
                      </div>
                      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-[9px] font-mono font-bold text-white">
                        {String(display).padStart(2, "0")}
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                        <div className="text-[10px] font-bold text-white truncate">{v.label}</div>
                        <div className="text-[9px] text-white/70">8s · AI</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Modal — plays clicked thumbnail */}
            {modalVideo && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200"
                onClick={() => setModalIndex(null)}
              >
                <button
                  onClick={() => setModalIndex(null)}
                  className="absolute top-5 right-5 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
                <div
                  className="relative rounded-3xl overflow-hidden shadow-2xl bg-black w-full max-w-[420px] aspect-[9/16]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <video
                    key={modalVideo.file}
                    src={modalVideo.file}
                    controls
                    autoPlay
                    playsInline
                    className="w-full h-full object-contain bg-black"
                  />
                  <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md text-[10px] font-bold uppercase tracking-widest text-white pointer-events-none">
                    {String((modalIndex ?? 0) + 1).padStart(2, "0")} · {modalVideo.label}
                  </div>
                </div>
              </div>
            )}
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

    </section>
  );
}
