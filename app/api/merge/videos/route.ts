import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { falMergeVideos } from "@/lib/fal";

// POST /api/merge/videos — combine N existing video clips into one.
//
// Body: { history_ids: string[]  // 2..10 history.id, all owned by caller,
//                                 // all status='done' with output_url
//
// Hot path: getSession → validate ownership → insert pending placeholder
// row → return history_id (~500ms target).
// after():  call fal ffmpeg-concat → update row with merged URL, status=done
//
// The merged result is stored as a NEW history row (not appended as a slide
// to the first source). It inherits the source's tab so it shows up in the
// same grid. metadata.merged_from preserves the source IDs for traceability.
//
// Tab support: 'video' (UGC), 'auto' (Auto Content), and 'cinema' all flow
// through here. Up to 10 sources per merge to keep fal request bounded.

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_SOURCES = 10;
const MIN_SOURCES = 2;

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.history_ids)
    ? body.history_ids.filter((v: any): v is string => typeof v === "string")
    : [];
  if (ids.length < MIN_SOURCES) {
    return NextResponse.json(
      { error: `Need at least ${MIN_SOURCES} videos to merge` },
      { status: 400 }
    );
  }
  if (ids.length > MAX_SOURCES) {
    return NextResponse.json(
      { error: `Cannot merge more than ${MAX_SOURCES} clips at once` },
      { status: 400 }
    );
  }

  // Validate all sources: owned by caller, done, have output_url. Same query
  // also gives us tab/project_id/duration so the placeholder inherits cleanly.
  const admin = createAdminClient();
  const { data: sources, error: srcErr } = await admin
    .from("history")
    .select("id, user_id, tab, status, output_url, project_id, duration")
    .in("id", ids);

  if (srcErr || !sources || sources.length !== ids.length) {
    return NextResponse.json(
      { error: "One or more source clips not found" },
      { status: 404 }
    );
  }
  for (const s of sources) {
    if (s.user_id !== user.id) {
      return NextResponse.json(
        { error: "Source clip does not belong to you" },
        { status: 403 }
      );
    }
    if (s.status !== "done" || !s.output_url) {
      return NextResponse.json(
        { error: "All source clips must be finished before merging" },
        { status: 400 }
      );
    }
  }

  // Preserve source order from the request (important for concat sequence).
  // Map for fast lookup since .in() doesn't preserve order.
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const ordered = ids.map((id) => sourceMap.get(id)!).filter(Boolean);
  const sourceUrls = ordered.map((s) => s.output_url as string);
  const totalDuration = ordered.reduce(
    (sum, s) => sum + (Number(s.duration) || 8),
    0
  );

  // All sources are in the same tab (the UI only allows selection within one
  // grid); use the first source's tab. project_id same way.
  const tab = ordered[0].tab;
  const projectId = ordered[0].project_id || null;

  // Insert merged placeholder NOW. status='pending', task_id stays null
  // because there's no Crun task — fal merge happens inline in after().
  // Setting task_id=null + status=pending means pg_cron's stale-cleanup will
  // catch it at 10 min if after() never completes; Stage-1 polling skips it
  // (requires task_id IS NOT NULL).
  const { data: hist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: projectId,
      type: "video",
      tab,
      status: "pending",
      prompt: `Merge of ${ordered.length} clips`,
      reference_url: null,
      task_id: null,
      duration: totalDuration,
      cost: 0, // merge is free — no provider rate, just our fal usage
      metadata: {
        merged_from: ids,
        merge_count: ordered.length,
        merge_status: "queued",
      },
    })
    .select("id")
    .single();

  if (insErr || !hist) {
    return NextResponse.json(
      { error: "DB insert failed", detail: insErr?.message },
      { status: 500 }
    );
  }

  const historyId = hist.id;

  after(async () => {
    try {
      const mergeRes = await falMergeVideos(sourceUrls);
      if (!mergeRes.ok || !mergeRes.url) {
        await admin
          .from("history")
          .update({
            status: "failed",
            error_message: mergeRes.error || "Merge failed",
            metadata: {
              merged_from: ids,
              merge_count: ordered.length,
              merge_status: "failed",
            },
          })
          .eq("id", historyId);
        return;
      }
      await admin
        .from("history")
        .update({
          status: "done",
          output_url: mergeRes.url,
          merged_url: mergeRes.url,
          thumbnail_url: mergeRes.url,
          metadata: {
            merged_from: ids,
            merge_count: ordered.length,
            merge_status: "done",
            merged_at: new Date().toISOString(),
          },
        })
        .eq("id", historyId);
    } catch (e: any) {
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: e?.message || "Background merge error",
          metadata: {
            merged_from: ids,
            merge_count: ordered.length,
            merge_status: "failed",
          },
        })
        .eq("id", historyId);
    }
  });

  return NextResponse.json({
    ok: true,
    history_id: historyId,
    merge_count: ordered.length,
  });
}
