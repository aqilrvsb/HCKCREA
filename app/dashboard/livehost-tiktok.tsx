"use client";

// "TikTok Live" tab — install SOP card (visual port of the Auto Post SOP),
// green-themed for Livehost. Download the extension + step-by-step Load Unpacked.

import { useEffect, useState } from "react";
import { Download, ArrowUpRight } from "lucide-react";

export default function LivehostTiktok({ email }: { email: string }) {
  const [info, setInfo] = useState<{ version: string; download_url: string } | null>(null);
  useEffect(() => {
    fetch("/api/livehost/ext-info").then((r) => r.json()).then(setInfo).catch(() => {});
  }, []);

  const dot = (
    <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "#16a34a" }} />
  );

  return (
    <div className="max-w-md">
      <div className="bg-white rounded-2xl overflow-hidden shadow-2xl">
        {/* Green-gradient header */}
        <div className="px-6 py-5 flex items-center gap-2.5 text-white rounded-t-2xl"
          style={{ background: "linear-gradient(135deg, #16a34a 0%, #22c55e 100%)" }}>
          <span className="text-xl">🎙️</span>
          <h3 className="font-display font-extrabold text-base">PeningLab Livehost — SOP</h3>
        </div>

        {/* Body */}
        <div className="p-6 text-gray-900">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-green-700 text-sm"
              style={{ background: "#bbf7d0" }}>1</div>
            <h4 className="font-display font-extrabold text-lg">Install Extension</h4>
          </div>

          <p className="text-sm font-bold mb-4" style={{ color: "#16a34a" }}>
            Current Version: v{info?.version || "…"}
          </p>

          <ul className="space-y-3 text-sm leading-relaxed">
            <li className="flex items-start gap-2.5">
              {dot}
              <div>
                <div>Download extension</div>
                {info?.download_url ? (
                  <a href={info.download_url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 mt-2 px-4 py-2 rounded-lg font-bold text-sm transition-transform hover:-translate-y-0.5"
                    style={{ background: "#f0fdf4", border: "1px solid #86efac", color: "#16a34a" }}>
                    <Download className="w-4 h-4" />
                    Download Extension <ArrowUpRight className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <div className="text-xs text-gray-500 italic mt-1">
                    Admin belum sediakan link download. Hubungi support.
                  </div>
                )}
              </div>
            </li>
            <li className="flex items-start gap-2.5">{dot}<div>Extract Folder</div></li>
            <li className="flex items-start gap-2.5">{dot}
              <div>Open Chrome, type{" "}
                <span className="font-mono font-bold bg-gray-100 px-1.5 py-0.5 rounded">chrome://extensions/</span>
              </div>
            </li>
            <li className="flex items-start gap-2.5">{dot}<div>Enable <span className="font-bold">Developer Mode</span></div></li>
            <li className="flex items-start gap-2.5">{dot}<div>Click <span className="font-bold">Load Unpacked</span></div></li>
            <li className="flex items-start gap-2.5">{dot}<div>Select the extracted extension folder</div></li>
          </ul>

          <div className="flex items-center gap-3 mt-6 mb-3">
            <div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-green-700 text-sm"
              style={{ background: "#bbf7d0" }}>2</div>
            <h4 className="font-display font-extrabold text-lg">Login &amp; Connect</h4>
          </div>
          <ul className="space-y-3 text-sm leading-relaxed">
            <li className="flex items-start gap-2.5">{dot}<div>Klik ikon extension → panel buka di tepi → <span className="font-bold">Login</span> guna email <span className="font-bold">{email}</span></div></li>
            <li className="flex items-start gap-2.5">{dot}<div>Tab <span className="font-bold">Livehost</span> → <span className="font-bold">On GPU</span> → <span className="font-bold">Start</span> (avatar streaming)</div></li>
            <li className="flex items-start gap-2.5">{dot}<div>OBS: tangkap avatar → push ke TikTok LIVE</div></li>
            <li className="flex items-start gap-2.5">{dot}<div>Buka tab TikTok Shop LIVE → di extension tekan <span className="font-bold">START</span></div></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
