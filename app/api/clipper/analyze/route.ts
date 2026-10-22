import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";
import { motionStart, newPlanToken, siteUrl } from "@/lib/motion";
import { CLIPPER_JOB_TAB, cleanOptions, cleanSource, clipperYoutubeAuth } from "@/lib/clipper";

// POST /api/clipper/analyze { source: {type, url, name?}, options, project_id? } — CLIPPER step 1: a Modal job reads
// the video (title, transcript, "most replayed"), the director picks the clips. Free; ≤ 3 at a time per client.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BAD_LINK: Record<string, string> = {
  youtube: "Pautan YouTube tidak sah — tampal pautan video (youtube.com/watch?v=… atau youtu.be/…).",
  gdrive: "Pautan Google Drive tidak sah — tampal pautan fail (drive.google.com/file/d/…).",
  upload: "Upload video dahulu.",
};

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isTabAllowedForUser(user.id, "clipper"))) {
    return NextResponse.json({ error: "Tab ini tidak tersedia untuk akaun anda." }, { status: 403 });
  }
  const b = await req.json().catch(() => ({} as any));
  const type = String(b?.source?.type || "");
  const src = cleanSource(type, b?.source?.url, b?.source?.name);
  if (!src) return NextResponse.json({ error: BAD_LINK[type] || "Pilih sumber video." }, { status: 400 });
  const options = cleanOptions(b?.options);

  const admin = createAdminClient();
  const { count } = await admin.from("history").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("tab", CLIPPER_JOB_TAB).eq("status", "pending");
  if ((count ?? 0) >= 3) return NextResponse.json({ error: "3 analisa sedang berjalan — tunggu satu siap dulu." }, { status: 429 });

  const planToken = newPlanToken();
  const projectId = typeof b?.project_id === "string" && /^[0-9a-f-]{36}$/i.test(b.project_id) ? b.project_id : null;
  const { data: row, error } = await admin.from("history").insert({
    user_id: user.id,
    project_id: projectId,
    type: "clipper",
    tab: CLIPPER_JOB_TAB,
    status: "pending",
    prompt: (src.name || src.url).slice(0, 200),
    reference_url: src.url,
    task_id: null,
    cost: 0,
    metadata: { feature: "clipper-analysis", stage: "queued", source: src, options, plan_token: planToken },
  }).select("id").single();
  if (error || !row) return NextResponse.json({ error: error?.message || "Gagal cipta analisa" }, { status: 500 });

  const start = await motionStart({
    flow: "clip-analyze",
    history_id: row.id,
    user_id: user.id,
    source: { type: src.type, url: src.url, name: src.name },
    options,
    plan_url: `${siteUrl()}/api/clipper/plan`,
    vision_url: `${siteUrl()}/api/clipper/vision`,
    plan_token: planToken,
    ...(src.type === "youtube" ? { yt_auth: await clipperYoutubeAuth() } : {}),
  });
  if (!start.ok) {
    await admin.from("history").update({ status: "failed", error_message: `Gagal mula analisa: ${start.error}` }).eq("id", row.id);
    return NextResponse.json({ error: `Gagal mula analisa: ${start.error}` }, { status: 502 });
  }
  await admin.from("history").update({
    task_id: start.callId,
    metadata: { feature: "clipper-analysis", stage: "queued", source: src, options, plan_token: planToken, provider: "modal-motion" },
  }).eq("id", row.id);
  return NextResponse.json({ ok: true, id: row.id });
}
