"use client";

// "TikTok Live" tab — download + install the PeningLab Livehost Chrome
// extension and connect a real TikTok LIVE to the AI avatar.

import { useEffect, useState } from "react";

export default function LivehostTiktok({ email }: { email: string }) {
  const [info, setInfo] = useState<{ version: string; download_url: string } | null>(null);
  useEffect(() => {
    fetch("/api/livehost/ext-info").then((r) => r.json()).then(setInfo).catch(() => {});
  }, []);

  const card: React.CSSProperties = {
    background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 16, padding: 20,
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #16a34a, #4ade80)" }}>
          <span style={{ fontSize: 22 }}>🎙️</span>
        </div>
        <div>
          <h1 className="font-display font-extrabold text-2xl">TikTok Live</h1>
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            Sambung TikTok LIVE sebenar anda ke AI avatar — auto greeting, auto reply, auto sound effects.
          </p>
        </div>
      </div>

      <div style={card} className="mb-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="font-bold text-lg">PeningLab Livehost Extension</div>
            <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Versi semasa: <b>{info?.version || "—"}</b> · Chrome
            </div>
          </div>
          {info?.download_url ? (
            <a href={info.download_url} target="_blank" rel="noopener noreferrer"
              className="px-5 py-2.5 rounded-xl text-sm font-bold text-white"
              style={{ background: "linear-gradient(135deg, #16a34a, #22c55e)" }}>
              ⬇ Download Extension
            </a>
          ) : (
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Link download belum disediakan admin</span>
          )}
        </div>
      </div>

      <div style={card}>
        <div className="font-bold mb-3">Cara pasang &amp; guna</div>
        <ol className="text-sm space-y-2" style={{ color: "var(--color-text-secondary)", paddingLeft: 18, listStyle: "decimal" }}>
          <li>Download &amp; unzip extension di atas.</li>
          <li>Buka <b>chrome://extensions</b> → hidupkan <b>Developer mode</b> (atas kanan).</li>
          <li>Klik <b>Load unpacked</b> → pilih folder extension.</li>
          <li>Klik ikon extension → ia buka panel sebelah (boleh seret besar/kecil) → <b>Login</b> guna email PeningLab anda (<b>{email}</b>).</li>
          <li>Di sini: tab <b>Livehost</b> → <b>On GPU</b> → <b>Start</b> (avatar mula streaming).</li>
          <li>OBS: tangkap avatar (Browser/Window source) → push ke TikTok LIVE.</li>
          <li>Buka tab <b>TikTok Shop LIVE console</b> → di extension tekan <b>START</b>. Siap — avatar auto greet &amp; reply.</li>
        </ol>
        <div className="mt-4 text-xs px-3 py-2 rounded-lg"
          style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)", color: "#4ade80" }}>
          Tetapan greeting, produk &amp; sound effects di tab <b>Greetings</b> / <b>Products</b>. Semua interaksi
          direkod di <b>Dashboard</b> secara real-time.
        </div>
      </div>
    </div>
  );
}
