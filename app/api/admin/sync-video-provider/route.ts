import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/sync-video-provider
//
// Wipes every client's profiles.video_provider override so they all
// fall back to the admin's gen_provider_video setting on their next
// video generation. Used when admin needs every user to follow a
// platform-wide change (e.g. p1 outage → flip admin default to p2 →
// click sync → every user's override clears, everyone is on p2).
//
// In-flight rows are unaffected — their provider was stamped on
// metadata at create time. Only NEW gens after this call read the
// admin default for users whose override was just cleared.
async function adminGate() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) return null;
  return user;
}

export async function POST() {
  const user = await adminGate();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();

  // Count first so we can report back how many overrides we cleared.
  const { count: before } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .not("video_provider", "is", null);

  // Wipe overrides — set NULL so getGenProvider falls through to the
  // admin default on the next gen.
  const { error } = await admin
    .from("profiles")
    .update({ video_provider: null })
    .not("video_provider", "is", null);

  if (error) {
    return NextResponse.json(
      { error: "Update failed", detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    cleared: before || 0,
  });
}
