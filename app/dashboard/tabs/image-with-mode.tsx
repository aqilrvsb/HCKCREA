"use client";

// Images tab shell — radio toggle between the usual Image mode and the new
// Storyboard mode (Load Data → MAIN → SUB → quantity → generate storyboard
// grids). Both write to the same Images history grid below.

import { useState } from "react";
import ImageTab from "./image";
import StoryboardMode from "./storyboard-mode";

export default function ImageTabWithMode({
  projectId,
  // Partner gating: a partner client may be allowed only one of the two modes.
  // Defaults let every non-partner client see both (unchanged behaviour).
  allowImage = true,
  allowStoryboard = true,
}: {
  projectId?: string;
  allowImage?: boolean;
  allowStoryboard?: boolean;
}) {
  const modes = (["image", "storyboard"] as const).filter((m) =>
    m === "image" ? allowImage : allowStoryboard
  );
  const [mode, setMode] = useState<"image" | "storyboard">(allowImage ? "image" : "storyboard");
  // Keep the active mode within what's allowed (e.g. only Storyboard granted).
  const effective = modes.includes(mode) ? mode : (modes[0] || "image");
  return (
    <div className="space-y-4">
      {/* Only show the toggle when BOTH modes are available. */}
      {modes.length > 1 && (
        <div className="flex gap-2 justify-center">
          {modes.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="px-4 py-2 rounded-full text-[13px] font-bold transition-colors"
              style={{
                background: effective === m ? "#f5b100" : "var(--color-bg-card)",
                color: effective === m ? "#1a1a1a" : "var(--color-text-secondary)",
                border: "1px solid var(--color-border)",
              }}
            >
              {m === "image" ? "🖼️ Image Mode" : "🎬 Storyboard Mode"}
            </button>
          ))}
        </div>
      )}
      {effective === "image" ? <ImageTab projectId={projectId} /> : <StoryboardMode projectId={projectId} />}
    </div>
  );
}
