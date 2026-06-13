import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";
import { verifyExtToken } from "@/lib/livehost-ext-auth";

// Extension → avatar speech relay. The extension never knows the box secret;
// PeningLab looks up the client's backend_url and forwards to its /say.
// kinds: say (greetings/scripts) | ask (comment replies via the box's LLM).

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const userId = await verifyExtToken(body.token || "");
  if (!userId) return NextResponse.json({ error: "invalid token" }, { status: 401 });
  const kind = body.kind === "ask" ? "ask" : "say";
  const text = String(body.text || "").trim();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: cfg } = await admin
    .from("live_client_config")
    .select("backend_url")
    .eq("user_id", userId)
    .maybeSingle();
  if (!cfg?.backend_url) return NextResponse.json({ error: "no backend" }, { status: 404 });
  const secret = await getSetting<string>("livehost_box_secret");

  try {
    const r = await fetch(`${cfg.backend_url}/say`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, kind, text }),
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json().catch(() => ({}));
    return NextResponse.json({ ok: r.ok, status: r.status, detail: d.error || "" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 100) }, { status: 502 });
  }
}
