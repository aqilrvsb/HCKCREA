import { NextResponse, after } from "next/server";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasEnoughCredits } from "@/lib/deduct";
import { getSeedanceRate } from "@/lib/settings";
import { generateVideoWithCascade } from "@/lib/video-cascade";
import { withNoIndon } from "@/lib/seedance-lang";

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
  if (!(await isTabAllowedForUser(user.id, "original-video"))) {
    return NextResponse.json({ error: "Tab ini tidak tersedia untuk akaun anda." }, { status: 403 });
  }

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

  // Bake the hardcoded no-Indonesian language rule into the prompt we STORE, so
  // Resubmit / settle / auto-retry all re-fire with it (they re-read hist.prompt).
  // Cascade/fallback routing is untouched — still the dynamic seedance pool.
  const finalPrompt = withNoIndon(prompt);

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
      prompt: finalPrompt,
      reference_url: imageUrls[0] || null,
      task_id: null,
      duration,
      cost: 0,
      metadata: {
        aspectRatio,
        seedance_mode: hasRefs ? "r2v" : "t2v",
        // Authoritative signal for the seedance cascade pool + the model
        // fallback picker on Resubmit / auto-retry (settle.ts, retry route,
        // auto-resubmit cron all read modelChoice).
        modelChoice: "seedance",
        ref_image_count: imageUrls.length,
        ref_video_count: videoUrls.length,
        ref_audio_count: audioUrls.length,
        // Full attachment arrays for Resubmit re-fire
        image_urls: imageUrls,
        video_urls: videoUrls,
        audio_urls: audioUrls,
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
      // Route Seedance through its OWN cascade pool (split out of `cinema`
      // 2026-07-15) so admin can rotate Seedance slots independently in
      // /admin/settings → Cascade → seedance. Each slot's CreateVideo
      // handles the model id mapping internally (p6CreateVideo →
      // seedance-2.0-fast-t2v / -i2v / -r2v; p1CreateTask → seedance-2-omni).
      const imgMode: "frame" | "ingredient" | "text" =
        hasRefs ? "ingredient" : "text";
      const result = await generateVideoWithCascade({
        primaryModel: "seedance",
        userId: user.id,
        prompt: finalPrompt,
        imageUrls,
        durationMode: String(duration),
        aspectRatio,
        imageMode: imgMode,
        asset: "seedance",
      });

      // MERGE metadata, never replace it — the insert stored image_urls /
      // video_urls / audio_urls, and Resubmit + the auto-retry cron re-read
      // them to re-fire with the same attachments. A wholesale overwrite here
      // dropped them, so a failed Seedance row came back with no refs.
      const { data: curFail } = await admin.from("history").select("metadata").eq("id", historyId).single();

      if (!result.ok) {
        await admin.from("history").update({
          status: "failed",
          cost,
          error_message: result.error || "Seedance create failed",
          metadata: {
            ...(curFail?.metadata || {}),
            tier_log: result.tierLog,
            upload_status: "failed",
          },
        }).eq("id", historyId);
        return;
      }

      await admin.from("history").update({
        task_id: result.taskId,
        cost,
        metadata: {
          ...(curFail?.metadata || {}),
          provider: result.actualProvider,
          slot: result.actualSlot,
          ...(result.keyIndex !== undefined ? { p6_key_index: result.keyIndex } : {}),
          model: result.actualModel,
          fallback_used: result.fallbackUsed,
          tier_log: result.tierLog,
          upload_status: "done",
        },
      }).eq("id", historyId);

      // Deduction happens in lib/settle.ts when status flips pending →
      // done. Settle reads the live rate_seedance × duration so admin
      // pricing changes apply even if this row was queued earlier.
    } catch (e: any) {
      // Merge, don't replace — keep image_urls/video_urls/audio_urls so
      // Resubmit re-fires with the same attachments.
      const { data: curErr } = await admin.from("history").select("metadata").eq("id", historyId).single();
      await admin.from("history").update({
        status: "failed",
        cost,
        error_message: e?.message || "Seedance background error",
        metadata: {
          ...(curErr?.metadata || {}),
          upload_status: "failed",
        },
      }).eq("id", historyId);
    }
  });

  return NextResponse.json({ ok: true, history_id: historyId });
}
