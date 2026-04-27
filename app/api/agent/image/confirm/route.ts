import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { priceFor } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// POST /api/agent/image/confirm — placeholder-first batch fire.
//
// Hot path: getSession → insert N placeholder rows → return history_ids.
// after():  resolve plan rate + fire N Crun create_task in parallel +
//           update each row with its task_id.
//
// Same trust model as the manual /api/generate/image route — auth gated
// by dashboard layout, funds gated by nav-tab credit floor.
export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const refUrls: string[] = Array.isArray(body?.reference_urls)
    ? body.reference_urls.filter(Boolean).map(String)
    : [];
  const prompt = String(body?.prompt || "");
  const model = body?.model === "gpt-image-2" ? "gpt-image-2" : "nano-banana-pro";
  const aspectRatio = String(body?.aspect_ratio || "1:1");
  const count = Math.min(4, Math.max(1, Math.round(Number(body?.count || 1))));
  const projectId = body?.project_id || null;
  const conversationId = String(body?.conversation_id || "");

  if (!prompt) {
    return NextResponse.json({ error: "Prompt required" }, { status: 400 });
  }

  // Insert N placeholder rows now. task_id + cost populated by after().
  const admin = createAdminClient();
  const placeholders = await Promise.all(
    Array.from({ length: count }).map((_, idx) =>
      admin
        .from("history")
        .insert({
          user_id: user.id,
          project_id: projectId,
          type: "image",
          tab: "image",
          status: "pending",
          prompt,
          reference_url: refUrls[0] || null,
          task_id: null,
          cost: 0,
          metadata: {
            idx,
            agent: "image",
            conversation_id: conversationId,
            model,
            reference_count: refUrls.length,
            photographer_skill_id: body?.photographer_skill_id,
            brand_skill_id: body?.brand_skill_id,
            composite_skill_id: body?.composite_skill_id,
            aspectRatio,
            upload_status: "queued",
          },
        })
        .select("id")
        .single()
    )
  );
  const historyIds = placeholders
    .map((r) => r.data?.id)
    .filter((id): id is string => Boolean(id));

  if (historyIds.length === 0) {
    return NextResponse.json({ error: "DB insert failed" }, { status: 500 });
  }

  after(async () => {
    try {
      const [cfg, ratePerImage] = await Promise.all([
        getP2Config(),
        priceFor(user.id, "image_generate"),
      ]);
      const modelId = (cfg.imageModels as any)?.[model] || model;
      const totalCost = Number((ratePerImage * historyIds.length).toFixed(4));

      // Fire all Crun tasks in parallel + write back results to placeholders
      await Promise.all(
        historyIds.map(async (historyId) => {
          const created = await p2CreateTask({
            model: modelId,
            prompt,
            imageUrls: refUrls,
            aspectRatio,
          });
          await admin
            .from("history")
            .update({
              status: created.ok && created.task_id ? "pending" : "failed",
              task_id: created.task_id || null,
              cost: ratePerImage,
              error_message: created.ok ? null : created.error || "P2 create failed",
              metadata: {
                agent: "image",
                conversation_id: conversationId,
                model,
                modelId,
                reference_count: refUrls.length,
                photographer_skill_id: body?.photographer_skill_id,
                brand_skill_id: body?.brand_skill_id,
                composite_skill_id: body?.composite_skill_id,
                aspectRatio,
                upload_status: created.ok ? "done" : "failed",
              },
            })
            .eq("id", historyId);
        })
      );

      // Log the agent action — informational, not on hot path
      await admin.from("agent_actions").insert({
        conversation_id: conversationId,
        user_id: user.id,
        tab: "image",
        tool_name: "confirm_and_fire_image",
        params: { count: historyIds.length, model, aspect: aspectRatio },
        outcome: "fired",
        history_ids: historyIds,
        cost: totalCost,
      });
    } catch (e: any) {
      // Mark all placeholders as failed
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: e?.message || "Background error",
        })
        .in("id", historyIds);
    }
  });

  return NextResponse.json({
    ok: true,
    history_ids: historyIds,
  });
}
