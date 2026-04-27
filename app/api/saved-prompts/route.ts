import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/saved-prompts?project_id=&bucket=&starred=&limit=
//
// Returns the signed-in user's saved prompt library, optionally filtered by
// project, bucket (ugc / cinema / image / auto), or starred-only. Joins the
// linked history row so the UI can show output thumbnails next to each saved
// prompt.
export async function GET(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const projectId = url.searchParams.get("project_id");
  const bucket = url.searchParams.get("bucket");
  const starredOnly = url.searchParams.get("starred") === "true";
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 100)));

  const admin = createAdminClient();
  let q = admin
    .from("saved_prompts")
    .select(
      "id, project_id, history_id, prompt_text, bucket, model, scene_template, reference_url, duration, aspect_ratio, cost, outcome, starred, user_notes, source, created_at, history:history_id(id, type, tab, output_url, thumbnail_url, status, framework)"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (projectId) q = q.eq("project_id", projectId);
  if (bucket) q = q.eq("bucket", bucket);
  if (starredOnly) q = q.eq("starred", true);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, rows: data || [] });
}

// POST /api/saved-prompts
// Body: { history_id, prompt_text?, scene_template?, user_notes? }
//
// Manual save (e.g. user clicks "Save prompt" on a history card). Auto-save
// already runs in lib/settle.ts on every successful generation, so this route
// is mostly used for re-saving with edits or for manually saving prompts the
// agent generated outside the normal flow.
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const historyId = String(body?.history_id || "");
  if (!historyId) return NextResponse.json({ error: "Missing history_id" }, { status: 400 });

  const admin = createAdminClient();

  // Pull the history row so we can derive bucket / model / cost from it.
  const { data: hist } = await admin
    .from("history")
    .select("id, user_id, type, tab, prompt, reference_url, duration, cost, project_id, metadata")
    .eq("id", historyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!hist) return NextResponse.json({ error: "History not found" }, { status: 404 });

  const meta = (hist.metadata as any) || {};
  const promptText = String(body?.prompt_text || hist.prompt || "").trim();
  if (!promptText) return NextResponse.json({ error: "No prompt to save" }, { status: 400 });

  // Bucket inference matches lib/settle.ts so manual + auto saves stay aligned.
  const bucket =
    hist.tab === "video" || hist.tab === "ugc"
      ? "ugc"
      : hist.tab === "cinema"
        ? "cinema"
        : hist.tab === "image"
          ? "image"
          : hist.tab === "auto"
            ? "auto"
            : "ugc";

  // Idempotent — if we already have a row for this history_id, update notes /
  // scene_template instead of inserting a duplicate.
  const { data: existing } = await admin
    .from("saved_prompts")
    .select("id")
    .eq("history_id", historyId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    const updates: Record<string, any> = {};
    if (typeof body?.user_notes === "string") updates.user_notes = body.user_notes;
    if (typeof body?.scene_template === "string") updates.scene_template = body.scene_template;
    if (typeof body?.prompt_text === "string" && body.prompt_text.trim())
      updates.prompt_text = body.prompt_text.trim();
    if (Object.keys(updates).length > 0) {
      await admin.from("saved_prompts").update(updates).eq("id", existing.id);
    }
    return NextResponse.json({ ok: true, id: existing.id, updated: true });
  }

  const { data: row, error } = await admin
    .from("saved_prompts")
    .insert({
      user_id: user.id,
      project_id: hist.project_id,
      history_id: historyId,
      prompt_text: promptText,
      bucket,
      model: meta.model || null,
      scene_template: body?.scene_template || null,
      reference_url: hist.reference_url,
      duration: hist.duration,
      aspect_ratio: meta.aspectRatio || meta.aspect_ratio || null,
      cost: Number(hist.cost || 0),
      outcome: "success",
      starred: !!body?.starred,
      user_notes: body?.user_notes || null,
      source: "manual",
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: row.id });
}

// PATCH /api/saved-prompts
// Body: { id, starred?, user_notes? }
// Toggle starred state or edit notes on an existing saved prompt.
export async function PATCH(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = createAdminClient();
  const updates: Record<string, any> = {};
  if (typeof body?.starred === "boolean") updates.starred = body.starred;
  if (typeof body?.user_notes === "string") updates.user_notes = body.user_notes;
  if (typeof body?.prompt_text === "string" && body.prompt_text.trim())
    updates.prompt_text = body.prompt_text.trim();
  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const { error } = await admin
    .from("saved_prompts")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// DELETE /api/saved-prompts?id=
export async function DELETE(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("saved_prompts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
