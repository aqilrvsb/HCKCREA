import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// /api/fairytale/drafts
//
// GET  → list the current user's drafts (newest first), thin payload
//        (id, title, step, updated_at, thumb_url) for the Drafts tab.
// POST → upsert a draft. Body: { id?, title?, step, state }.
//        Returns the row id so the client can persist it locally and
//        update the same draft on next Preview click instead of creating
//        a new one every time.
//
// Single-user only (RLS enforced via auth.uid()). Service role is used
// for the actual writes so we can upsert atomically without re-checking
// the RLS predicate twice — but we still gate on user.id before doing
// anything.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_STATE_BYTES = 256 * 1024; // 256 KB — comfortably more than any
                                    // realistic wizard snapshot (12 scenes
                                    // × ~3 KB each = ~36 KB)

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Project-scoped listing — when a project_id is provided we only return
  // drafts that belong to that project, matching the rest of the
  // history grid which scopes by project (UGC/Images/Cinema all do this).
  // Without the filter, the user sees drafts from OTHER projects on
  // the current project's Projects sub-tab. Empty string means "no
  // project filter" (legacy/global view).
  const url = new URL(req.url);
  const projectFilter = (url.searchParams.get("project_id") || "").trim();

  const admin = createAdminClient();
  // Thin list payload — only what the Drafts tab card needs. The full
  // state blob is fetched on click via GET /api/fairytale/drafts/[id].
  let query = admin
    .from("fairytale_drafts")
    .select("id, title, step, updated_at, created_at, state, project_id")
    .eq("user_id", user.id);
  if (projectFilter) {
    query = query.eq("project_id", projectFilter);
  }
  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Project a thumb url from the first scene's image_url if present so
  // the tab card can show a meaningful preview without needing to
  // re-fetch the full state blob.
  const rows = (data || []).map((row) => {
    const firstSceneImg =
      (row.state as any)?.scenes?.find((s: any) => s?.imageUrl || s?.userImageUrl) || null;
    const sceneCount = Array.isArray((row.state as any)?.scenes)
      ? (row.state as any).scenes.length
      : 0;
    return {
      id: row.id,
      title: row.title || "Untitled project",
      step: row.step,
      updated_at: row.updated_at,
      created_at: row.created_at,
      thumb_url: firstSceneImg?.userImageUrl || firstSceneImg?.imageUrl || null,
      scene_count: sceneCount,
    };
  });

  return NextResponse.json({ ok: true, drafts: rows });
}

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const id: string | null = body?.id ? String(body.id) : null;
  const projectId: string | null = body?.project_id ? String(body.project_id) : null;
  const titleRaw = body?.title ? String(body.title).slice(0, 200) : "";
  const step = Number.isFinite(body?.step) ? Math.max(0, Math.min(10, Number(body.step))) : 0;
  const state = body?.state;

  if (!state || typeof state !== "object") {
    return NextResponse.json({ error: "state object required" }, { status: 400 });
  }

  // Bound the blob — clients shouldn't be able to fill the DB with
  // multi-MB drafts. 256 KB is comfortably more than the heaviest
  // wizard snapshot we generate (12 scenes ≈ 36 KB).
  const sizeBytes = JSON.stringify(state).length;
  if (sizeBytes > MAX_STATE_BYTES) {
    return NextResponse.json(
      { error: `Draft state too large (${sizeBytes} bytes; max ${MAX_STATE_BYTES})` },
      { status: 413 }
    );
  }

  // Auto-title from first scene narration when client didn't provide one.
  let title = titleRaw;
  if (!title) {
    const firstNarration = Array.isArray((state as any)?.scenes)
      ? String((state as any).scenes[0]?.narration || "").trim()
      : "";
    title = firstNarration.slice(0, 80) || "Untitled project";
  }

  const admin = createAdminClient();

  if (id) {
    // Update existing draft. Gate on user_id so a forged id can't
    // overwrite someone else's row.
    const { data, error } = await admin
      .from("fairytale_drafts")
      .update({
        project_id: projectId,
        title,
        step,
        state,
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id, updated_at")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      // No row matched (wrong id or wrong user) — fall through and create
      // a new draft instead of silently swallowing.
      const { data: inserted, error: insErr } = await admin
        .from("fairytale_drafts")
        .insert({ user_id: user.id, project_id: projectId, title, step, state })
        .select("id, updated_at")
        .single();
      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, id: inserted!.id, updated_at: inserted!.updated_at, created: true });
    }
    return NextResponse.json({ ok: true, id: data.id, updated_at: data.updated_at, created: false });
  }

  // Insert new draft.
  const { data, error } = await admin
    .from("fairytale_drafts")
    .insert({
      user_id: user.id,
      project_id: projectId,
      title,
      step,
      state,
    })
    .select("id, updated_at")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: data!.id, updated_at: data!.updated_at, created: true });
}
