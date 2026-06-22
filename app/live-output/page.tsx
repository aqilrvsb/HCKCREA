"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import LivehostStudio from "@/app/dashboard/livehost-studio";

// PUBLIC, NO-LOGIN OBS OUTPUT PAGE — /live-output?t=<token>
// Outside /dashboard so the auth middleware doesn't redirect to /login. It
// exchanges the per-client output_token for a real session (output-auth →
// setSession), then renders the Livehost studio in clean output mode (only the
// 1080x1920 stage). This page IS the single live stream (one WebRTC peer per
// GPU) — point OBS Browser Source here. The host's dashboard tab is setup-only.

export default function LiveOutputPage() {
  const [phase, setPhase] = useState<"auth" | "ready" | "error">("auth");
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const t = new URLSearchParams(window.location.search).get("t");
        if (!t) throw new Error("Missing ?t token");
        const r = await fetch(`/api/livehost/output-auth?t=${encodeURIComponent(t)}`);
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.access_token) throw new Error(d.error || `auth failed (${r.status})`);
        const sb = createClient();
        const { error } = await sb.auth.setSession({ access_token: d.access_token, refresh_token: d.refresh_token });
        if (error) throw error;
        setPhase("ready");
      } catch (e: any) {
        setErr(e?.message || "error");
        setPhase("error");
      }
    })();
  }, []);

  const box = (msg: string) => (
    <div style={{ height: "100vh", background: "#000", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", fontSize: 14, textAlign: "center", padding: 24 }}>{msg}</div>
  );
  if (phase === "error") return box(`OBS output error: ${err}`);
  if (phase !== "ready") return box("Connecting…");
  return (
    <div style={{ height: "100vh", background: "#000" }}>
      <LivehostStudio view="live" embedOutput />
    </div>
  );
}
