import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageUsers, manageUsersGroup } from "@/lib/manage-users";
import { PARTNER_TAB_KEYS } from "@/lib/partners";

// POST /api/manage-users/tabs
// Set which PROJECT tabs a specific client (one THIS team created) can see.
// Stored on the client's profiles.settings.visible_tabs; read by the client's
// dashboard + the generate-route gate. Allowlisted + ownership-checked (the
// target must belong to the caller's team). >=1 tab required (no tab-less client).
//
// Body: { user_id, visible_tabs: string[] }
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = manageUsersGroup(user.email);
  const body = await req.json().catch(() => ({}));
  const targetId = String(body?.user_id || "").trim();
  if (!targetId) return NextResponse.json({ error: "user_id diperlukan" }, { status: 400 });

  const admin = createAdminClient();

  // Ownership — target MUST be in the caller's team.
  const { data: target } = await admin.from("profiles").select("id, settings").eq("id", targetId).maybeSingle();
  const targetGroup = (target?.settings as any)?.managed_group || null;
  if (!target || !group || targetGroup !== group) {
    return NextResponse.json({ error: "User ni bukan dalam senarai anda." }, { status: 403 });
  }

  const picked = Array.isArray(body?.visible_tabs)
    ? body.visible_tabs.filter((k: any) => typeof k === "string" && PARTNER_TAB_KEYS.includes(k))
    : [];
  if (picked.length === 0) {
    return NextResponse.json({ error: "Pilih sekurang-kurangnya 1 tab untuk client." }, { status: 400 });
  }
  // Store in canonical order, de-duped.
  const visible_tabs = PARTNER_TAB_KEYS.filter((k) => picked.includes(k));

  const { error } = await admin
    .from("profiles")
    .update({ settings: { ...((target.settings as any) || {}), visible_tabs } })
    .eq("id", targetId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, visible_tabs });
}
