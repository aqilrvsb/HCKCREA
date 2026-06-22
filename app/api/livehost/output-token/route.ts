import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/livehost/output-token  (authed host)
// Returns a PUBLIC, no-login OBS output URL: /live-output?t=<token>. The token
// is a per-client secret stored on live_client_config.output_token — treat it
// like a password (it mints a session for THAT user on the output page). Pass
// ?regen=1 to rotate it. The output page is the SINGLE live stream (one WebRTC
// peer per GPU) — OBS Browser Source points at it; the dashboard is setup-only.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const admin = createAdminClient();
  const { data: cfg } = await admin
    .from("live_client_config").select("output_token").eq("user_id", user.id).maybeSingle();

  let token = cfg?.output_token || "";
  const regen = new URL(req.url).searchParams.get("regen") === "1";
  if (!token || regen) {
    token = "obs_" + randomBytes(24).toString("hex");
    const nowIso = new Date().toISOString();
    if (cfg) {
      await admin.from("live_client_config").update({ output_token: token, updated_at: nowIso }).eq("user_id", user.id);
    } else {
      // backend_url is NOT NULL → seed "" on a fresh row
      await admin.from("live_client_config").insert({ user_id: user.id, backend_url: "", output_token: token, updated_at: nowIso });
    }
  }

  const origin = new URL(req.url).origin;
  return NextResponse.json({ url: `${origin}/live-output?t=${token}`, token });
}
