"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Portal — renders children directly into document.body so position:fixed
// anchors to the viewport, NOT to any transformed/filtered ancestor.
//
// Why this exists: ANY ancestor with `transform`, `filter`, `backdrop-filter`,
// `perspective`, `will-change: transform`, or `contain: paint` creates a new
// containing block for fixed-positioned descendants. That breaks modal centering
// (the modal anchors to the transformed parent's box instead of the viewport).
// Portaling to body bypasses every such ancestor.
//
// SSR-safe — renders nothing on the server (createPortal needs a real DOM).

export default function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
