import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { hasEnoughCredits } from "@/lib/deduct";
import { getSeedanceRate } from "@/lib/settings";

// POST /api/generate/seedance — manual Seedance 2.0 Fast generation.
//
// Body: {
//   prompt        string  — required, 1-5000 chars
//   image_urls    []      — optional ingredient images (≤4)
//   video_urls    []      — optional motion-reference videos (≤3, ≤15s each)
//   audio_urls    []      — optional vibe/audio refs (≤3, ≤15s each)
//   aspect_ratio  "9:16" | "16:9"
//   duration      4..15
//   project_id?
// }
//
// Auto-routing:
//   - If any ref (image/video/audio) is uploaded → P2 r2v / P1 omni-with-refs
//   - If none → P2 t2v / P1 omni-without-refs
//
// Hot-path: getSession + insert pending row + return { history_id }.
// after():  resolve rate + credit check + p2CreateTask + persist task_id.
// Settle:   reuses lib/settle.ts (status response shape matches Crun/GeminiGen).
//
// Audio: always on. No toggle in the API or UI.

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt || "").trim();
  const imageUrls: string[] = Array.isArray(body?.image_urls)
    ? body.image_urls.filter((u: any): u is string => typeof u === "string" && !!u).slice(0, 3)
    : [];
  const videoUrls: string[] = Array.isArray(body?.video_urls)
    ? body.video_urls.filter((u: any): u is string => typeof u === "string" && !!u).slice(0, 3)
    : [];
  const audioUrls: string[] = Array.isArray(body?.audio_urls)
    ? body.audio_urls.filter((u: any): u is string => typeof u === "string" && !!u).slice(0, 3)
    : [];
  const rawAspect = String(body?.aspect_ratio || "9:16");
  const aspectRatio = rawAspect === "16:9" ? "16:9" : "9:16";
  // Cinema minimum is 8s — Seedance under 8s tends to produce truncated
  // motion that doesn't justify the per-second cost.
  const duration = Math.max(8, Math.min(15, Math.round(Number(body?.duration || 8))));
  const projectId = body?.project_id ? String(body.project_id) : null;

  if (!prompt) {
    return NextResponse.json({ error: "Prompt required" }, { status: 400 });
  }
  if (prompt.length > 5000) {
    return NextResponse.json({ error: "Prompt too long (max 5000 chars)" }, { status: 400 });
  }

  const hasRefs = imageUrls.length > 0 || videoUrls.length > 0 || audioUrls.length > 0;

  // Pre-flight credit check — using the Seedance per-second rate × duration.
  const rate = await getSeedanceRate();
  const cost = Number((rate * duration).toFixed(4));
  if (!(await hasEnoughCredits(user.id, cost))) {
    return NextResponse.json(
      { error: `Kredit tak cukup. Perlu RM ${cost.toFixed(2)}.` },
      { status: 402 }
    );
  }

  // Insert placeholder row. task_id populated by after().
  const admin = createAdminClient();
  const { data: hist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: projectId,
      type: "video",
      tab: "seedance",
      status: "pending",
      prompt,
      reference_url: imageUrls[0] || null,
      task_id: null,
      duration,
      cost: 0,
      metadata: {
        aspectRatio,
        seedance_mode: hasRefs ? "r2v" : "t2v",
        ref_image_count: imageUrls.length,
        ref_video_count: videoUrls.length,
        ref_audio_count: audioUrls.length,
        upload_status: "queued",
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
      // Pass model="seedance" — pickProvider routes to gen_provider_seedance.
      // P1 expands this to "seedance-2-omni"; P2 swaps to t2v/r2v based on refs.
      const created = await p2CreateTask({
        model: "seedance",
        userId: user.id,
        prompt,
        imageUrls,
        videoUrls,
        audioUrls,
        durationMode: duration,
        aspectRatio,
        resolution: "720p",
        extra: { mode: "fast" },
      });

      const provider = created.provider || "p2";
      if (!created.ok || !created.task_id) {
        await admin.from("history").update({
          status: "failed",
          cost,
          error_message: created.error || "Seedance create failed",
          metadata: {
            aspectRatio,
            seedance_mode: hasRefs ? "r2v" : "t2v",
            provider,
            upload_status: "failed",
          },
        }).eq("id", historyId);
        return;
      }

      await admin.from("history").update({
        task_id: created.task_id,
        cost,
        metadata: {
          aspectRatio,
          seedance_mode: hasRefs ? "r2v" : "t2v",
          provider,
          model: provider === "p1" ? "seedance-2-omni" : (hasRefs ? "bytedance/seedance2-0-fast-r2v" : "bytedance/seedance2-0-fast-t2v"),
          ref_image_count: imageUrls.length,
          ref_video_count: videoUrls.length,
          ref_audio_count: audioUrls.length,
          upload_status: "done",
        },
      }).eq("id", historyId);

      // Deduction happens in lib/settle.ts when status flips pending →
      // done. Settle reads the live rate_seedance × duration so admin
      // pricing changes apply even if this row was queued earlier.
    } catch (e: any) {
      await admin.from("history").update({
        status: "failed",
        cost,
        error_message: e?.message || "Seedance background error",
        metadata: {
          aspectRatio,
          seedance_mode: hasRefs ? "r2v" : "t2v",
          upload_status: "failed",
        },
      }).eq("id", historyId);
    }
  });

  return NextResponse.json({ ok: true, history_id: historyId });
}
