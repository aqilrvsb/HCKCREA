import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGenProvider } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/me/provider-video — returns the user's video provider
// preference + the admin default + the effective resolved value.
//   user_pref       — what the user picked in /settings ("p1" / "p2" / null)
//   admin_default   — the admin's gen_provider_video setting
//   effective       — what actually fires (user pref wins if set, else admin)
export async function GET() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("video_provider")
    .eq("id", user.id)
    .maybeSingle();

  const userPref = profile?.video_provider as "p1" | "p2" | null;
  const adminDefault = await getGenProvider("video"); // no userId → admin only
  const effective = await getGenProvider("video", user.id);

  return NextResponse.json({
    ok: true,
    user_pref: userPref || null,
    admin_default: adminDefault,
    effective,
  });
}

// POST /api/me/provider-video { provider: "p1" | "p2" | null }
// null clears the user override and falls back to the admin default.
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const raw = body?.provider;
  let provider: "p1" | "p2" | null = null;
  if (raw === "p1" || raw === "p2") provider = raw;
  else if (raw === null || raw === undefined || raw === "") provider = null;
  else {
    return NextResponse.json(
      { error: "Invalid provider — must be 'p1', 'p2', or null" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({ video_provider: provider })
    .eq("id", user.id);

  return NextResponse.json({ ok: true, user_pref: provider });
}
