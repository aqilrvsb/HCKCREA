"use client";

import { useEffect, useRef, useState } from "react";
import { X, BookOpen, Lightbulb, ChevronRight } from "lucide-react";
import type { SopPage } from "@/lib/sop-content";

// SopModal — full-screen on mobile, centered card on desktop. Renders
// a structured walkthrough with:
//   - Title + intro
//   - "Bila guna" callout
//   - One or more sections, each with numbered steps
//   - Each step: title + screenshot (responsive) + description + optional tip
//
// Image paths are relative to /public — e.g. "/sop/ugc/step-1.png".
// If the image file doesn't exist yet, the modal gracefully shows a
// placeholder block so the SOP is still usable while screenshots are
// being captured. Same modal works on mobile (390px+) and desktop.

export default function SopModal({
  sop,
  onClose,
}: {
  sop: SopPage;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Esc closes the modal — standard a11y.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock body scroll while the modal is open so background doesn't move.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Auto-flatten all steps for sequential numbering (1, 2, 3, …) across
  // sections. Section headings still split them visually.
  let stepCounter = 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-stretch md:items-center justify-center md:p-6"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="relative flex flex-col w-full md:max-w-3xl md:max-h-[90vh] md:rounded-2xl bg-[var(--color-bg)] overflow-hidden shadow-2xl"
        style={{
          border: "1px solid var(--color-border)",
        }}
      >
        {/* Header — sticky top */}
        <div
          className="flex items-center gap-3 px-5 md:px-7 py-4 border-b flex-shrink-0"
          style={{
            background:
              "linear-gradient(135deg, rgba(250,204,21,0.10), rgba(234,179,8,0.05))",
            borderColor: "var(--color-border)",
          }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background:
                "linear-gradient(135deg, #fde047 0%, #facc15 100%)",
              boxShadow: "0 4px 14px rgba(250,204,21,0.35)",
            }}
          >
            <BookOpen className="w-5 h-5 text-black" strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold text-[var(--color-orange)]">
              Panduan
            </div>
            <h2 className="font-display font-extrabold text-base md:text-xl tracking-tight text-[var(--color-text-primary)] truncate">
              {sop.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup panduan"
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[var(--color-bg-card)] transition-colors flex-shrink-0"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 md:px-7 py-5 md:py-6 space-y-6">
          {/* Subtitle / tagline */}
          {sop.subtitle && (
            <div className="font-mono text-xs text-[var(--color-text-muted)] tracking-wide">
              {sop.subtitle}
            </div>
          )}

          {/* Intro — what is this tab? */}
          <section>
            <h3 className="font-display font-extrabold text-sm uppercase tracking-wider mb-2 text-[var(--color-orange)]">
              Apa ini?
            </h3>
            <p className="text-sm md:text-base leading-relaxed text-[var(--color-text-primary)]">
              {sop.intro}
            </p>
          </section>

          {/* When to use callout */}
          <section
            className="rounded-2xl p-4 md:p-5"
            style={{
              background: "rgba(250,204,21,0.08)",
              border: "1px solid rgba(250,204,21,0.3)",
            }}
          >
            <div className="flex items-start gap-2.5">
              <Lightbulb
                className="w-5 h-5 flex-shrink-0 mt-0.5"
                style={{ color: "var(--color-orange)" }}
                strokeWidth={2.4}
              />
              <div>
                <div className="font-extrabold text-xs uppercase tracking-wider mb-1 text-[var(--color-orange)]">
                  Bila guna tab ni?
                </div>
                <p className="text-sm leading-relaxed text-[var(--color-text-primary)]">
                  {sop.whenToUse}
                </p>
              </div>
            </div>
          </section>

          {/* Sections + steps */}
          {sop.sections.map((section, sIdx) => (
            <section key={sIdx} className="space-y-4">
              <div className="flex items-center gap-2">
                <ChevronRight
                  className="w-4 h-4"
                  style={{ color: "var(--color-orange)" }}
                  strokeWidth={2.5}
                />
                <h3 className="font-display font-extrabold text-base text-[var(--color-text-primary)]">
                  {section.heading}
                </h3>
              </div>

              {section.steps.map((step) => {
                stepCounter += 1;
                const num = stepCounter;
                return (
                  <div
                    key={num}
                    className="rounded-2xl overflow-hidden"
                    style={{
                      background: "var(--color-bg-card)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    {/* Step header — number + title */}
                    <div className="flex items-start gap-3 p-4 md:p-5">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 font-mono font-extrabold text-sm"
                        style={{
                          background:
                            "linear-gradient(135deg, #fde047 0%, #facc15 100%)",
                          color: "#000",
                        }}
                      >
                        {num}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-sm md:text-base text-[var(--color-text-primary)] leading-snug">
                          {step.title}
                        </h4>
                      </div>
                    </div>

                    {/* Screenshot — placeholder if image missing */}
                    {step.image ? (
                      <div
                        className="relative w-full bg-black overflow-hidden"
                        style={{
                          borderTop: "1px solid var(--color-border)",
                          borderBottom: "1px solid var(--color-border)",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={step.image}
                          alt={step.imageAlt || step.title}
                          className="w-full h-auto block"
                          loading="lazy"
                          onError={(e) => {
                            // Hide broken image gracefully — just collapse.
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </div>
                    ) : null}

                    {/* Description + tip */}
                    <div className="p-4 md:p-5 space-y-3">
                      <p className="text-sm leading-relaxed text-[var(--color-text-primary)]">
                        {step.description}
                      </p>
                      {step.tip && (
                        <div
                          className="text-xs md:text-sm leading-relaxed rounded-lg px-3 py-2.5 flex items-start gap-2"
                          style={{
                            background: "rgba(34,197,94,0.08)",
                            border: "1px solid rgba(34,197,94,0.25)",
                            color: "#86efac",
                          }}
                        >
                          <span className="font-extrabold flex-shrink-0">
                            💡 Tip:
                          </span>
                          <span>{step.tip}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}

          {/* Closing note */}
          {sop.closing && (
            <section
              className="rounded-2xl p-4 md:p-5"
              style={{
                background: "rgba(255,87,34,0.08)",
                border: "1px solid rgba(255,87,34,0.25)",
              }}
            >
              <p className="text-sm leading-relaxed text-[var(--color-text-primary)]">
                {sop.closing}
              </p>
            </section>
          )}
        </div>

        {/* Footer — close action on mobile */}
        <div
          className="flex justify-end px-5 md:px-7 py-3 border-t flex-shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg text-sm font-extrabold text-black"
            style={{
              background:
                "linear-gradient(135deg, #fde047 0%, #facc15 100%)",
              boxShadow: "0 4px 14px rgba(250,204,21,0.35)",
            }}
          >
            Faham — tutup
          </button>
        </div>
      </div>
    </div>
  );
}

// Maps pageKey → short label shown next to the BookOpen icon. Keeps the
// label consistent regardless of the long Malay title in SOP_CONTENT.
const SOP_SHORT_LABEL: Record<string, string> = {
  dashboard: "Dashboard",
  image: "Image",
  ugc: "UGC",
  "auto-content": "Auto Content",
  story: "Story",
  cinema: "Cinema",
  "clone-prompt": "Clone",
  billing: "Billing",
  "top-up": "Top Up",
  usage: "Usage",
  "saved-prompts": "Saved Prompts",
  settings: "Settings",
};

// SopButton — floating pill that opens SopModal for the given page.
// Shows "SOP <label>" so users know which panduan they're about to open
// (e.g. SOP Dashboard, SOP Image, SOP UGC). Updates automatically as the
// active tab/view changes.
export function SopButton({ sop }: { sop: SopPage | null }) {
  const [open, setOpen] = useState(false);
  if (!sop) return null;
  const label = SOP_SHORT_LABEL[sop.pageKey] || "Panduan";
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`Panduan ${label}`}
        aria-label={`Buka panduan ${label}`}
        className="fixed top-3 right-3 z-30 h-10 lg:h-11 px-3 lg:px-4 rounded-full flex items-center gap-2 transition-transform hover:scale-105"
        style={{
          background:
            "linear-gradient(135deg, #fde047 0%, #facc15 100%)",
          color: "#000",
          boxShadow: "0 6px 20px rgba(250,204,21,0.35)",
          border: "2px solid rgba(0,0,0,0.15)",
        }}
      >
        <BookOpen className="w-5 h-5 flex-shrink-0" strokeWidth={2.5} />
        <span className="font-extrabold text-xs lg:text-sm tracking-tight whitespace-nowrap">
          SOP {label}
        </span>
      </button>
      {open && <SopModal sop={sop} onClose={() => setOpen(false)} />}
    </>
  );
}
