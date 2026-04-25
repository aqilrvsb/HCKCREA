import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2GetStatus } from "@/lib/p2";
import { deduct } from "@/lib/deduct";

// GET /api/generate/status?id=<history_id>
// Server-side poller — verifies P2 status, marks history done/failed, and
// applies the deduction once on the transition to 'done'. Idempotent.
export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = createAdminClient();
  const { data: hist } = await admin
    .from("history")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!hist) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Already settled — return as is
  if (hist.status === "done" || hist.status === "failed") {
    return NextResponse.json({ ok: true, history: hist });
  }
  if (!hist.task_id) {
    return NextResponse.json({ ok: true, history: hist });
  }

  const r = await p2GetStatus(hist.task_id);

  if (r.status === "succeeded" && r.outputUrl) {
    // Apply deduction (only for image/video — clone segments use video reason
    // too; auto_plan rows are deducted upstream by the auto-content route at 0
    // since rate is 0 for auto_plan).
    const reason =
      hist.type === "image"
        ? "image_generate"
        : hist.duration === 16
          ? "video_16s"
          : "video_8s";

    if (Number(hist.cost || 0) > 0) {
      await deduct(user.id, reason as any, Number(hist.cost), hist.id);
    }

    await admin
      .from("history")
      .update({
        status: "done",
        output_url: r.outputUrl,
        thumbnail_url: hist.type === "video" ? r.outputUrl : null,
      })
      .eq("id", hist.id);

    const { data: refreshed } = await admin
      .from("history")
      .select("*")
      .eq("id", id)
      .single();
    return NextResponse.json({ ok: true, history: refreshed });
  }

  if (r.status === "failed") {
    await admin
      .from("history")
      .update({ status: "failed", error_message: r.error || "Generation failed" })
      .eq("id", hist.id);
    const { data: refreshed } = await admin
      .from("history")
      .select("*")
      .eq("id", id)
      .single();
    return NextResponse.json({ ok: true, history: refreshed });
  }

  // Still pending/running
  return NextResponse.json({ ok: true, history: hist, p2_status: r.status });
}
