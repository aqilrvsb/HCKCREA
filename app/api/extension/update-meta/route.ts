import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authExtensionUser } from "@/lib/extension-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/extension/update-meta
// Body: { history_id, caption?, cover_title?, cover_subtitle? }
//
// Persists post-time edits the user made in the extension's View Videos
// modal. The extension shows the saved caption / cover_title /
// cover_subtitle as placeholders; if any are empty (because settlement-
// time master plan generation failed silently) the user fills them in
// before the post button unlocks. Save persists back so re-posts later
// don't require re-typing.
//
// Auth: extension's three-mode authExtensionUser (x-pl-email primary).
// Owner check: only the row's user_id can mutate it — the admin client
// bypasses RLS, so we enforce it explicitly here.
export async function POST(req: Request) {
  const user = await authExtensionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const historyId = String(body?.history_id || "").trim();
  if (!historyId) {
    return NextResponse.json({ error: "history_id required" }, { status: 400 });
  }

  // Optional fields — only update what's provided. Pass an empty string
  // to clear; null/undefined leaves the existing value alone.
  const caption =
    typeof body?.caption === "string" ? String(body.caption).slice(0, 4000) : undefined;
  const coverTitle =
    typeof body?.cover_title === "string"
      ? String(body.cover_title).slice(0, 80).toUpperCase()
      : undefined;
  const coverSubtitle =
    typeof body?.cover_subtitle === "string"
      ? String(body.cover_subtitle).slice(0, 200).toUpperCase()
      : undefined;

  if (
    caption === undefined &&
    coverTitle === undefined &&
    coverSubtitle === undefined
  ) {
    return NextResponse.json(
      { error: "Nothing to update" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Owner check — fetch the row first so we can verify user_id AND
  // merge into existing metadata rather than overwriting it.
  const { data: row, error: fetchErr } = await admin
    .from("history")
    .select("id, user_id, metadata")
    .eq("id", historyId)
    .maybeSingle();
  if (fetchErr || !row) {
    return NextResponse.json({ error: "Row not found" }, { status: 404 });
  }
  if (row.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updates: Record<string, any> = {};
  if (caption !== undefined) updates.caption = caption;
  if (coverTitle !== undefined || coverSubtitle !== undefined) {
    const meta = (row.metadata || {}) as Record<string, any>;
    updates.metadata = {
      ...meta,
      ...(coverTitle !== undefined ? { cover_title: coverTitle } : {}),
      ...(coverSubtitle !== undefined ? { cover_subtitle: coverSubtitle } : {}),
    };
  }

  const { error: updErr } = await admin
    .from("history")
    .update(updates)
    .eq("id", historyId);
  if (updErr) {
    return NextResponse.json(
      { error: "Update failed", detail: updErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    caption: updates.caption,
    cover_title: updates.metadata?.cover_title,
    cover_subtitle: updates.metadata?.cover_subtitle,
  });
}
