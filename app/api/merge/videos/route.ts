import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runMergeJob, loadMergeSources, inheritedFrom } from "@/lib/merge-videos";

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
  // caption + metadata pulled too so the merged Auto Content row carries
  // caption / cover_title / cover_subtitle / tiktok_product_id / product_name
  // from the first source — needed by the extension's auto-post step.
  const admin = createAdminClient();
  const loaded = await loadMergeSources(admin, ids, user.id);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  const ordered = loaded.ordered;
  const sourceUrls = ordered.map((s) => s.output_url as string);
  const totalDuration = ordered.reduce(
    (sum, s) => sum + (Number(s.duration) || 8),
    0
  );

  // All sources are in the same tab (the UI only allows selection within one
  // grid); use the first source's tab. project_id same way.
  const tab = ordered[0].tab;
  const projectId = ordered[0].project_id || null;

  // Inherit auto-post payload from first source. Auto Content rows already
  // carry caption + cover_title/subtitle + tiktok_product_id + product_name
  // (stamped at master-plan generation time); merge would otherwise drop
  // those, breaking the extension's auto-post step.
  const inheritedCaption = String(ordered[0].caption || "").trim();
  const inherited = inheritedFrom(ordered[0]);

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
      caption: inheritedCaption || null,
      reference_url: null,
      task_id: null,
      duration: totalDuration,
      cost: 0, // merge is free — no provider rate, just our fal usage
      metadata: {
        merged_from: ids,
        merge_count: ordered.length,
        merge_status: "queued",
        ...inherited,
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

  after(() => runMergeJob(admin, { historyId, userId: user.id, tab, ids, sourceUrls, inherited }));

  return NextResponse.json({
    ok: true,
    history_id: historyId,
    merge_count: ordered.length,
  });
}
