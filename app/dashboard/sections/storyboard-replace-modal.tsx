"use client";

// "Tukar sub" picker — regenerate one storyboard in place with a new sub.
// Opened from a storyboard History card. Pick MAIN → SUB → replace.

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import Portal from "./portal";

const THEME = "#f5b100";
const MAIN_OPTIONS = [
  { value: "ugc" as const, label: "UGC", desc: "Realistik · TikTok/Reels" },
  { value: "pc" as const, label: "Product Commercial", desc: "Premium · sinematik" },
];
// Must mirror the SUBS_PAGES in tabs/storyboard-mode.tsx so a page-2/3 row is
// offered its OWN sub-styles when swapping. Page 1 verbatim = proven set.
const SUBS_PAGES: Record<1 | 2 | 3, Record<"ugc" | "pc", string[]>> = {
  1: {
    ugc: ["UGC Review", "Unboxing", "Unboxing ASMR", "Unboxing Try-On", "Virtual Try-On", "Before/After", "Tutorial", "UGC Addiction", "Giant Figure", "Testimoni Selfie", "Talking Head", "Secret Tips/Hack", "Lifestyle", "Masalah→Solusi"],
    pc: ["TV Spot", "Cinematic", "Crush Test", "Hyper Motion", "Mystery Box", "Reboxing", "Pro Virtual Try-On", "Product Studio", "Pix Story", "Stop Motion", "Motion Graphics", "Wild Card"],
  },
  2: {
    ugc: ["Countdown Clock", "Macro Tap ASMR", "Mirror Selfie", "WhatsApp Chat", "Walk-and-Talk", "Palm-Wipe Swap", "Tier-List Drag", "Caught Startle", "Voice-Memo Waveform", "Camera-Roll Dump", "Drive-Home Monologue", "Empty-Chair Address", "Screenshot React", "Then-Now Split"],
    pc: ["Liquid Gold Pour", "Ink Bloom", "Ferrofluid Spikes", "Frozen Splash Crown", "Glass-Block Shatter", "Bullet-Time Orbit", "Zero-G Float", "Macro-to-Cosmos", "Origami Fold", "Cross-Section Slice", "Infinite Recursion", "Liquid Typography"],
  },
  3: {
    ugc: ["Top-Down Restock", "Overhead Journal", "Notes-App Manifesto", "Ring-Light Off", "Held-Object Trigger", "Receipt Rip", "Basket Avalanche", "Trolley Cam", "Mystery Blind-Pull", "Empties Tower", "Barcode Beep", "Palm-Squeeze Test", "Bag-Weight Hang", "Ceiling-Fan Strobe"],
    pc: ["Botanical Bloom", "Chrome-Liquid Morph", "Product Colossus", "Escher Architecture", "Thermal False-Colour", "Particle Assembly", "Molten Wax Reveal", "Silk Wind Wrap", "Colored Gel Duel", "Prism Spectrum", "Volumetric Godrays", "Tilt-Shift Miniature"],
  },
};

export default function StoryboardReplaceModal({ historyId, subPage = 1, onClose }: { historyId: string; subPage?: 1 | 2 | 3; onClose: () => void }) {
  const SUBS = SUBS_PAGES[subPage] || SUBS_PAGES[1];
  const [main, setMain] = useState<"ugc" | "pc" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function replace(sub: string) {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/generate/storyboard/replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history_id: historyId, main, sub, page: subPage }),
      });
      const t = await r.text();
      let d: any = {};
      try { d = JSON.parse(t); } catch { d = { error: t.replace(/<[^>]+>/g, " ").slice(0, 120) }; }
      if (!r.ok || !d?.ok) throw new Error(d?.error || `Gagal (HTTP ${r.status})`);
      window.dispatchEvent(new CustomEvent("history:refresh"));
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Ralat");
      setBusy(false);
    }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
        <div className="w-full max-w-md rounded-2xl p-5" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <span className="text-[15px] font-bold text-[var(--color-text-primary)]">🔄 Tukar sub-style</span>
            <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}><X className="w-4 h-4" /></button>
          </div>

          {!main ? (
            <div className="grid grid-cols-2 gap-2">
              {MAIN_OPTIONS.map((o) => (
                <button key={o.value} onClick={() => setMain(o.value)} className="text-left px-3 py-2.5 rounded-lg" style={{ border: `1px solid ${THEME}55`, background: "var(--color-bg-card)" }}>
                  <span className="block text-[13px] font-bold text-[var(--color-text-primary)]">{o.label}</span>
                  <span className="block text-[11px] text-[var(--color-text-muted)]">{o.desc}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <button onClick={() => setMain(null)} className="text-[11px] mb-2 text-[var(--color-text-muted)]">← Kategori lain</button>
              <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
                {SUBS[main].map((s) => (
                  <button key={s} disabled={busy} onClick={() => replace(s)} className="text-[12px] font-semibold px-2.5 py-2 rounded-lg text-left" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}>{s}</button>
                ))}
              </div>
            </>
          )}

          {busy && <div className="mt-3 flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]"><Loader2 className="w-4 h-4 animate-spin" /> Menjana semula…</div>}
          {err && <div className="mt-3 text-[12px] px-3 py-2 rounded-lg" style={{ background: "#3a0a0a", color: "#fca5a5", border: "1px solid #7f1d1d" }}>⚠️ {err}</div>}
        </div>
      </div>
    </Portal>
  );
}
