"use client";

import { useEffect, useState } from "react";
import { Activity, ChevronRight, ChevronLeft, X, Image as ImageIcon, Video as VideoIcon, Sparkles } from "lucide-react";

// ActivityFeed — floating right-docked panel showing the platform's
// live activity for SOCIAL PROOF. Encourages users to keep creating
// when they see other people are also creating right now.
//
// Names are anonymized server-side ("Ahmad R." or "ahm***") so we
// never leak full client identities to other clients. The preview
// modal layers a hard-to-strip "PENINGLAB.COM" watermark over every
// asset so you can show off the platform without enabling theft.

type FeedItem = {
  id: string;
  display_name: string;
  tab: string;
  type: string;
  output_url: string | null;
  thumbnail_url: string | null;
  created_at: string;
};

const POLL_MS = 20_000;

// Format ISO timestamp into Malaysia local time (UTC+8). Avoids
// toISOString() which always renders UTC; uses Intl with explicit zone
// so DST + locale formatting are handled by the platform.
function fmtMyTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      year: "2-digit",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function inferKind(item: FeedItem): "image" | "video" | "other" {
  const t = String(item.type || "").toLowerCase();
  const url = String(item.output_url || "").toLowerCase();
  if (t === "image" || t === "fairytale-scene" || /\.(png|jpe?g|webp|gif)(\?|$)/.test(url)) return "image";
  if (
    t === "video" || t === "auto-content" || t === "cinema" ||
    t === "fairytale" || t === "seedance" ||
    /\.(mp4|webm|mov)(\?|$)/.test(url)
  ) return "video";
  return "other";
}

export default function ActivityFeed() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [previewing, setPreviewing] = useState<FeedItem | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      const r = await fetch("/api/activity-feed?limit=30", {
        credentials: "include",
        cache: "no-store",
      });
      if (!r.ok) return;
      const d = await r.json();
      if (Array.isArray(d?.items)) {
        setItems(d.items);
        setLoaded(true);
      }
    } catch {}
  }

  useEffect(() => {
    void load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);

  // Don't render the toggle until the first fetch lands — avoids a
  // brief flash of "Activity (0)" when the user first opens the dashboard.
  if (!loaded) return null;

  return (
    <>
      {/* Toggle button when minimized (right edge tab) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="See who else is creating right now"
          className="fixed right-0 top-1/3 z-40 px-2 py-3 rounded-l-lg flex flex-col items-center gap-1.5 transition-transform hover:scale-105"
          style={{
            background: "var(--color-orange, #facc15)",
            color: "#1a1a1a",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          <span className="relative inline-flex">
            <Activity className="w-4 h-4" />
            {/* Pulsing dot — signals "live" without taking extra width */}
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          </span>
          <span className="text-[9px] font-mono font-bold uppercase tracking-wider [writing-mode:vertical-rl]">
            Live · {items.length}
          </span>
          <ChevronLeft className="w-3 h-3" />
        </button>
      )}

      {/* Expanded panel */}
      {open && (
        <div
          className="fixed right-3 top-3 bottom-3 z-40 w-[380px] max-w-[92vw] flex flex-col rounded-2xl overflow-hidden"
          style={{
            background: "rgba(20, 20, 20, 0.96)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <div className="flex items-center gap-2">
              <span className="relative inline-flex">
                <Activity className="w-4 h-4 text-orange-400" />
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </span>
              <span className="text-sm font-display font-extrabold text-white">Live activity</span>
              <span className="text-[10px] font-mono text-gray-500 ml-1">PeningLab community</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              title="Minimize"
              className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {items.length === 0 && (
              <div className="text-center text-xs text-gray-500 py-8 px-4">
                Nobody's created anything yet today.
                <br />
                <span className="text-gray-600">Be the first.</span>
              </div>
            )}
            {items.map((it) => {
              const kind = inferKind(it);
              const Icon = kind === "image" ? ImageIcon : kind === "video" ? VideoIcon : Sparkles;
              return (
                <div
                  key={it.id}
                  className="px-3 py-2.5 border-b flex items-center gap-2.5"
                  style={{ borderColor: "rgba(255,255,255,0.04)" }}
                >
                  <button
                    onClick={() => setPreviewing(it)}
                    title="Preview"
                    className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 hover:scale-105 transition-transform"
                    style={{
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "#facc15",
                    }}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-bold text-white truncate">
                      {it.display_name}
                    </div>
                    <div className="text-[10px] text-gray-400 flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded font-mono uppercase font-bold tracking-wide" style={{ background: "rgba(250,204,21,0.12)", color: "#fde68a" }}>
                        {it.tab}
                      </span>
                      <span className="font-mono text-gray-500">{fmtMyTime(it.created_at)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-3 py-2 text-[9px] font-mono text-gray-600 text-center border-t" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
            top 10 today (Malaysia time) · names anonymized · previews watermarked
          </div>
        </div>
      )}

      {previewing && (
        <WatermarkedPreview item={previewing} onClose={() => setPreviewing(null)} />
      )}
    </>
  );
}

function WatermarkedPreview({ item, onClose }: { item: FeedItem; onClose: () => void }) {
  const kind = inferKind(item);
  // Repeating diagonal text watermark via inline SVG → data URL. Tiled
  // across the asset with `background-image: repeat`. pointer-events:none
  // so video controls underneath stay clickable.
  const watermarkSvg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280">
      <text x="20" y="160" fill="rgba(255,255,255,0.18)"
            font-family="monospace" font-size="22" font-weight="bold"
            transform="rotate(-30 140 140)">PENINGLAB.COM</text>
    </svg>`
  );
  const watermarkUrl = `url("data:image/svg+xml;utf8,${watermarkSvg}")`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={onClose}
    >
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <span className="text-xs font-mono text-gray-300">{item.display_name} · {item.tab}</span>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div
        className="relative max-w-[92vw] max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {kind === "image" && item.output_url && (
          <img
            src={item.output_url}
            alt=""
            className="max-w-[92vw] max-h-[88vh] object-contain"
            referrerPolicy="no-referrer"
            style={{ display: "block" }}
          />
        )}
        {kind === "video" && item.output_url && (
          <video
            src={item.output_url}
            controls
            playsInline
            className="max-w-[92vw] max-h-[88vh]"
            style={{ display: "block" }}
          />
        )}
        {/* Watermark overlay — pointer-events:none keeps the native
            video controls clickable, while the repeating SVG covers
            every pixel so screenshots all carry the brand mark. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: watermarkUrl,
            backgroundRepeat: "repeat",
            mixBlendMode: "difference",
          }}
        />
      </div>
    </div>
  );
}
