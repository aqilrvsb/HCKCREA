"use client";

// Placeholder shown while a history surface is loading its first batch
// from SWR. Matches the real card's aspect-ratio + bottom action bar
// so the grid doesn't reflow when real cards swap in.

export default function SkeletonCard() {
  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col"
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div
        className="aspect-[9/16] animate-pulse"
        style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08))" }}
      />
      <div className="p-3 space-y-2">
        <div className="h-3 w-3/4 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.08)" }} />
        <div className="h-2 w-1/2 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.06)" }} />
        <div className="flex gap-2 pt-2">
          <div className="h-7 flex-1 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
          <div className="h-7 w-7 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
          <div className="h-7 w-7 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
        </div>
      </div>
    </div>
  );
}
