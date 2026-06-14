"use client";

// Shared "Image tab" look for the Livehost library tabs (Scripts / Knowledge /
// Greetings). A light cream canvas with white cards + emoji uppercase headers,
// mirroring app/dashboard/tabs/image.tsx. All inline styles so it overrides the
// dark .lh-studio scope these tabs render inside. Avoid the bare `grid` class
// here — `.lh-studio .grid` would clobber it; use LhGrid / inline grids.

import React from "react";

export const ORANGE = "#facc15";

// Light cream canvas with a subtle radial — overrides the dark parent.
export const LH_SECTION_BG: React.CSSProperties = {
  background:
    "radial-gradient(ellipse 1200px 800px at 50% 0%, #fff7f2 0%, #fafaf7 40%, #f5f5f0 100%)",
  color: "#1a1a1a",
  boxShadow: "0 0 0 1px rgba(255, 87, 34, 0.08)",
};

// Input / textarea / select styling (matches the image tab's Select).
export const LH_FIELD_STYLE: React.CSSProperties = {
  width: "100%",
  background: "#fafaf7",
  border: "1px solid #e8e0d8",
  color: "#1a1a1a",
  borderRadius: 10,
  padding: "10px 14px",
  fontSize: 14,
  fontWeight: 500,
  outline: "none",
  fontFamily: "inherit",
};

export function LhSection({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="rounded-3xl p-5 md:p-7 space-y-5" style={{ ...LH_SECTION_BG, ...style }}>
      {children}
    </div>
  );
}

export function LhCard({
  children,
  borderColor,
}: {
  children: React.ReactNode;
  borderColor?: string;
}) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: "#ffffff",
        border: `1px solid ${borderColor || "#e8e0d8"}`,
        boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 4px 16px -4px rgba(0,0,0,0.04)",
        ...(borderColor ? { borderTopWidth: 3, borderTopColor: borderColor } : {}),
      }}
    >
      {children}
    </div>
  );
}

export function LhCardHeader({
  icon,
  title,
  right,
}: {
  icon: string;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className="text-lg">{icon}</span>
      <span
        className="text-[13px] font-extrabold uppercase tracking-[0.06em]"
        style={{ color: "#1a1a1a" }}
      >
        {title}
      </span>
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
}

export function LhLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10px] font-extrabold uppercase tracking-[0.1em] mb-2"
      style={{ color: "#888" }}
    >
      {children}
    </div>
  );
}

// Primary action button (orange/amber gradient like the image tab buttons).
export function LhButton({
  children,
  onClick,
  disabled,
  variant = "primary",
  style,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
  style?: React.CSSProperties;
  title?: string;
}) {
  const base: React.CSSProperties = {
    borderRadius: 10,
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 800,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "transform .12s",
  };
  const skin: React.CSSProperties =
    variant === "primary"
      ? { background: "linear-gradient(90deg,#f59e0b 0%,#facc15 100%)", color: "#1a1a1a", border: "none", boxShadow: "0 4px 14px rgba(245,158,11,.3)" }
      : { background: "#fafaf7", color: "#1a1a1a", border: "1px solid #e8e0d8" };
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} style={{ ...base, ...skin, ...style }}>
      {children}
    </button>
  );
}

// Light modal popup (Image-tab themed). Renders nothing when closed.
export function LhModal({
  open,
  onClose,
  title,
  children,
  maxWidth = 640,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: number;
}) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 130, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-2xl"
        style={{ width: "100%", maxWidth, maxHeight: "90vh", display: "flex", flexDirection: "column", background: "#ffffff", border: "1px solid #e8e0d8", boxShadow: "0 24px 70px rgba(0,0,0,0.35)", color: "#1a1a1a" }}
      >
        <div className="flex items-center justify-between" style={{ padding: "14px 18px", borderBottom: "1px solid #eee" }}>
          <span className="text-[13px] font-extrabold uppercase tracking-[0.06em]" style={{ color: "#1a1a1a" }}>{title}</span>
          <button type="button" onClick={onClose} aria-label="Tutup"
            style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid #e8e0d8", background: "#fafaf7", color: "#555", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: 18, overflowY: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

// Responsive auto-fit grid that does NOT use the `grid` class (avoids the
// `.lh-studio .grid` collision).
export function LhGrid({
  children,
  min = 220,
  gap = 12,
  style,
}: {
  children: React.ReactNode;
  min?: number;
  gap?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: "grid", gap, gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, ...style }}>
      {children}
    </div>
  );
}
