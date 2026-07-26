"use client";

// Images tab shell — radio toggle between the usual Image mode and the new
// Storyboard mode (Load Data → MAIN → SUB → quantity → generate storyboard
// grids). Both write to the same Images history grid below.

import { useState } from "react";
import ImageTab from "./image";
import StoryboardMode from "./storyboard-mode";

export default function ImageTabWithMode({ projectId }: { projectId?: string }) {
  const [mode, setMode] = useState<"image" | "storyboard">("image");
  return (
    <div className="space-y-4">
      <div className="flex gap-2 justify-center">
        {(["image", "storyboard"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="px-4 py-2 rounded-full text-[13px] font-bold transition-colors"
            style={{
              background: mode === m ? "#f5b100" : "var(--color-bg-card)",
              color: mode === m ? "#1a1a1a" : "var(--color-text-secondary)",
              border: "1px solid var(--color-border)",
            }}
          >
            {m === "image" ? "🖼️ Image Mode" : "🎬 Storyboard Mode"}
          </button>
        ))}
      </div>
      {mode === "image" ? <ImageTab projectId={projectId} /> : <StoryboardMode projectId={projectId} />}
    </div>
  );
}
