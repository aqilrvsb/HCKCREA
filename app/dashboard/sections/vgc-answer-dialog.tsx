"use client";

// Motion "Custom Style" (VGC) card — what the AI answered at each step of the
// project (direction, script, plan, the preview's summary) and every preview it
// rendered. The next step is run from the vault (Motion → Custom Style), which
// continues this same project.

import { useState } from "react";
import { Check, Copy, X } from "lucide-react";
import Portal from "./portal";

export type VgcStepView = {
  id?: string | null;
  title?: string | null;
  video?: boolean;
  url?: string | null;
  summary?: string;
  needs_input?: boolean;
  at?: string;
  charged?: number;
};

export default function VgcAnswerDialog({ steps, lastError, onClose }: {
  steps: VgcStepView[];
  lastError?: string | null;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(steps.length - 1);
  const [copied, setCopied] = useState<number | null>(null);
  const copy = async (k: number, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(k); setTimeout(() => setCopied(null), 1500); } catch { /* blocked */ }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-3" style={{ background: "rgba(0,0,0,0.75)" }} onClick={onClose}>
        <div className="w-full max-w-2xl rounded-2xl flex flex-col max-h-[92vh]" style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}
          onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2 px-5 pt-4 pb-2">
            <span className="text-[14px] font-extrabold text-[var(--color-text-primary)]">✨ Custom Style — jawapan AI</span>
            <button type="button" onClick={onClose} className="ml-auto p-1 rounded-lg" aria-label="Tutup">
              <X className="w-4 h-4 text-[var(--color-text-secondary)]" />
            </button>
          </div>
          <p className="px-5 text-[11px] text-[var(--color-text-muted)] leading-snug mb-3">
            Langkah seterusnya: buka Motion → Custom Style, pilih langkah berikutnya dalam flow yang sama dan tekan Jana — ia sambung projek ini.
          </p>
          {lastError && (
            <div className="mx-5 mb-3 rounded-lg px-3 py-2 text-[11px] font-bold" style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.35)" }}>
              Langkah terakhir gagal (kredit dipulangkan): {lastError}
            </div>
          )}
          <div className="px-5 pb-4 overflow-y-auto space-y-2">
            {steps.length === 0 && <p className="text-[12px] text-[var(--color-text-secondary)]">Belum ada jawapan.</p>}
            {steps.map((s, k) => (
              <div key={k} className="rounded-xl" style={{ border: "1px solid var(--color-border)" }}>
                <button type="button" onClick={() => setOpen(open === k ? -1 : k)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
                  <span className="text-[10px] font-mono text-[var(--color-text-muted)]">#{k + 1}</span>
                  <span className="text-[12px] font-extrabold text-[var(--color-text-primary)] flex-1 truncate">{s.title || s.id || "Langkah"}</span>
                  <span className="text-[10px] font-bold" style={{ color: s.url ? "#22c55e" : s.needs_input ? "#f59e0b" : "var(--color-text-muted)" }}>
                    {s.url ? "🎬 Video" : s.needs_input ? "⚠ Perlu input" : "📄 Jawapan"}
                  </span>
                </button>
                {open === k && (
                  <div className="px-3 pb-3 space-y-2">
                    {s.url && (
                      <video src={s.url} controls playsInline preload="metadata" className="w-full max-h-[50vh] rounded-lg bg-black" />
                    )}
                    {s.summary && (
                      <>
                        <pre className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--color-text-primary)] font-sans m-0">{s.summary}</pre>
                        <button type="button" onClick={() => void copy(k, s.summary || "")}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold"
                          style={{ border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
                          {copied === k ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied === k ? "Disalin" : "Salin jawapan"}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Portal>
  );
}
