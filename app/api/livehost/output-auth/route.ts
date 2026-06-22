import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/livehost/output-auth?t=<token>
// PUBLIC (no login) — the OBS output page calls this. Validates the per-client
// output_token, then mints a real Supabase session for that user (admin
// generateLink → verifyOtp) and returns the access/refresh tokens. The client
// page calls supabase.auth.setSession(...) with them so the embedded studio's
// normal authed routes work — no password, no login UI. The token is the
// secret (rotate via output-token?regen=1).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") || "";
  if (!token) return NextResponse.json({ error: "missing token" }, { status: 400 });

  const admin = createAdminClient();
  const { data: cfg } = await admin
    .from("live_client_config").select("user_id").eq("output_token", token).maybeSingle();
  if (!cfg?.user_id) return NextResponse.json({ error: "invalid token" }, { status: 403 });

  const { data: u } = await admin.auth.admin.getUserById(cfg.user_id);
  const email = u?.user?.email;
  if (!email) return NextResponse.json({ error: "user has no email" }, { status: 500 });

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = (link as any)?.properties?.hashed_token;
  if (linkErr || !hashed) return NextResponse.json({ error: `link failed: ${linkErr?.message || "no token"}` }, { status: 500 });

  // verify the OTP on a fresh (no-cookie) client to obtain the session tokens.
  const anon = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  let sess: any = null;
  for (const type of ["email", "magiclink"] as const) {
    const { data, error } = await anon.auth.verifyOtp({ type, token_hash: hashed });
    if (!error && data?.session) { sess = data.session; break; }
  }
  if (!sess) return NextResponse.json({ error: "verify failed" }, { status: 500 });

  return NextResponse.json({ access_token: sess.access_token, refresh_token: sess.refresh_token });
}
