import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { priceFor } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";
import { getCachedProductOcr } from "@/lib/product-ocr";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// POST /api/agent/ugc/confirm — placeholder-first batch fire (UGC).
//
// Hot path (~500ms target):
//   1. getSession (local)
//   2. Insert N placeholder rows synchronously with FULL metadata. For 16s
//      flows, each row is inserted as the seg-1 PARENT (segment_index=1,
//      metadata.duration_mode="16s", frame_anchor, character_lock, etc).
//      This is critical — the dashboard's segment slider keys on
//      metadata.duration_mode === "16s" to render placeholder thumbs, so
//      setting that field at insert time is what makes seg-1/seg-2/merged
//      thumbs spin from the moment the user clicks Yes.
//   3. Return history_ids → frontend dispatches history:refresh → user
//      sees both the placeholder card AND its slider thumbs immediately.
//
// after() background:
//   4. Resolve plan rate + product OCR (16s only) + Crun config
//   5. Fire N seg-1 Crun create_task in parallel
//   6. Update each row with task_id, cost, and the OCR/lock metadata the
//      seg-2 settle-hook (segment-chain.ts) needs to fire continuation
//
// If after() fails or the function dies, pg_cron's 10-min stale cutoff
// catches orphan placeholders.

// withLocks duplicated from agent-ugc.ts to keep the route self-contained.
// Keep in sync if the canonical block changes there.
const LOCKS_BLOCK = `

ANATOMY: 2 hands with 5 fingers each (both visible), symmetric face, no missing limbs, no plastic skin.
AUDIO: ONE single voice only, no chatter, no background voices.
PRODUCT LOCK: Product is pixel-identical to reference — same color, shape, label, typography, packaging. Sharp focus on label, no warping, no recoloring, no text drift.
UGC AUTHENTICITY: Authentic amateur iPhone UGC — handheld arm's-length, natural skin texture with pores and subtle T-zone shine (NOT airbrushed), no-makeup-makeup, loose hair, ordinary mixed lighting (NOT softbox), lived-in background with minor clutter.
VISUAL: RAW UNEDITED FOOTAGE — bottom 25% of frame COMPLETELY EMPTY. Zero subtitles, captions, animated TikTok captions, sticker text, icons, emojis, graphics, watermarks, UI elements, handles, hashtags.

Negative: cartoon, 3D cartoon, anime, airbrushed plastic skin, uncanny valley, glam makeup, salon hair, softbox studio lighting, tripod static shot (unless explicitly chosen), staged background, posed billboard framing, closed mouth while audio plays, duplicate limbs, distorted fingers, hand out of frame, warped product label, blurry product, motion-blurred product, text drift, subtitle burn-in, auto-captions, multiple speakers, voiceover narration, music score.`;

function withLocks(corePrompt: string, voiceLine?: string): string {
  return `${corePrompt.trim()}${voiceLine ? `\n\nVoice direction: ${voiceLine}` : ""}${LOCKS_BLOCK}`;
}

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const variants = Array.isArray(body?.variants) ? body.variants : [];
  if (variants.length === 0) {
    return NextResponse.json({ error: "No variants" }, { status: 400 });
  }

  const projectId = body?.project_id || null;
  const conversationId = String(body?.conversation_id || "");
  const productImageUrl = String(body?.product_image_url || "");
  const productDescription = String(body?.product_description || "");
  const duration = String(body?.duration || "8");
  const aspectRatio = String(body?.aspect_ratio || "9:16");
  const is16s = duration === "16";
  const useIngredient = !!productImageUrl;

  // Build per-variant seg-1 prompts upfront (fast — no I/O).
  type Prepared = { v: any; idx: number; seg1Prompt: string };
  const prepared: Prepared[] = variants.map((v: any, idx: number) => {
    let seg1Prompt = v.prompt;
    if (is16s && v.character_lock) {
      seg1Prompt = `${v.prompt.trim()}\n\n${v.character_lock.trim()}`;
      seg1Prompt = withLocks(seg1Prompt, v.voice_line || undefined);
    }
    return { v, idx, seg1Prompt };
  });

  // Insert N placeholder rows synchronously WITH 16s metadata so the slider
  // thumbs (seg-1, seg-2, merged) can render placeholders the moment the
  // dashboard sees the row. task_id + cost + product_ocr filled in by after().
  const admin = createAdminClient();
  const placeholders = await Promise.all(
    prepared.map(async ({ v, idx, seg1Prompt }) => {
      const { data: hist } = await admin
        .from("history")
        .insert({
          user_id: user.id,
          project_id: projectId,
          type: "video",
          tab: "video",
          status: "pending",
          prompt: seg1Prompt,
          caption: v.caption || "",
          framework: `${v.scene}/${v.persona}/${v.hook || ""}/${v.framework || ""}/${v.cta || ""}`,
          reference_url: productImageUrl || null,
          task_id: null,
          duration: is16s ? 16 : 8,
          cost: 0,
          segment_index: is16s ? 1 : null,
          frame_anchor: is16s ? (v.frame_anchor || "last") : null,
          metadata: {
            idx,
            agent: "ugc",
            conversation_id: conversationId,
            scene: v.scene,
            persona: v.persona,
            hook: v.hook,
            framework: v.framework,
            cta: v.cta,
            voice: v.voice,
            voice_line: v.voice_line || "",
            gender: v.gender,
            hijab: v.hijab,
            age: v.age,
            imageMode: useIngredient ? "ingredient" : "text",
            aspectRatio,
            upload_status: "queued",
            // 16s-only metadata — seg-2 settle hook (segment-chain.ts) reads
            // these to fire seg-2 with the same identity + product locks.
            // product_ocr is filled in by after() once OCR completes.
            ...(is16s
              ? {
                  duration_mode: "16s",
                  seg2_prompt: v.seg2_prompt || "",
                  character_lock: v.character_lock || "",
                  product_image_url: productImageUrl || "",
                  product_description: productDescription,
                }
              : {}),
          },
        })
        .select("id")
        .single();
      return hist?.id ? { id: hist.id, idx, v, seg1Prompt } : null;
    })
  );

  const live = placeholders.filter((p): p is { id: string; idx: number; v: any; seg1Prompt: string } => p !== null);
  const historyIds = live.map((p) => p.id);
  if (historyIds.length === 0) {
    return NextResponse.json({ error: "DB insert failed" }, { status: 500 });
  }

  // Fire-and-forget the slow work — OCR + N × Crun create_task + N × row update.
  after(async () => {
    try {
      const reason = is16s ? "video_16s" : "video_8s";
      const [cfg, ratePerVideo, productOcr] = await Promise.all([
        getP2Config(),
        priceFor(user.id, reason as any),
        is16s && productImageUrl
          ? getCachedProductOcr(user.id, productImageUrl).catch(() => null)
          : Promise.resolve(null),
      ]);
      const model = useIngredient ? cfg.videoR2V : cfg.videoT2V;
      const totalCost = Number((ratePerVideo * historyIds.length).toFixed(4));

      await Promise.all(
        live.map(async ({ id, v, seg1Prompt }) => {
          const created = await p2CreateTask({
            model,
            prompt: seg1Prompt,
            imageUrls: productImageUrl ? [productImageUrl] : [],
            durationMode: "8", // ALWAYS 8 — 16s = TWO 8s gens chained
            aspectRatio,
            imageMode: useIngredient ? "ingredient" : "text",
          });

          await admin
            .from("history")
            .update({
              status: created.ok && created.task_id ? "pending" : "failed",
              task_id: created.task_id || null,
              cost: ratePerVideo,
              error_message: created.ok ? null : created.error || "P2 create failed",
              metadata: {
                idx: v.idx,
                model,
                agent: "ugc",
                conversation_id: conversationId,
                scene: v.scene,
                persona: v.persona,
                hook: v.hook,
                framework: v.framework,
                cta: v.cta,
                voice: v.voice,
                voice_line: v.voice_line || "",
                gender: v.gender,
                hijab: v.hijab,
                age: v.age,
                imageMode: useIngredient ? "ingredient" : "text",
                aspectRatio,
                upload_status: created.ok ? "done" : "failed",
                ...(is16s
                  ? {
                      duration_mode: "16s",
                      seg2_prompt: v.seg2_prompt || "",
                      character_lock: v.character_lock || "",
                      product_ocr: productOcr,
                      product_image_url: productImageUrl || "",
                      product_description: productDescription,
                    }
                  : {}),
              },
            })
            .eq("id", id);
        })
      );

      await admin.from("agent_actions").insert({
        conversation_id: conversationId,
        user_id: user.id,
        tab: "ugc",
        tool_name: "confirm_and_fire_ugc",
        params: {
          variant_count: variants.length,
          duration,
          aspect: aspectRatio,
        },
        outcome: "fired",
        history_ids: historyIds,
        cost: totalCost,
      });

      // Save the master plan as a saved_prompts row so the user can revisit
      // their multi-variant strategy from the Saved Prompts library. One row
      // per fired batch — bucket "master-ugc" hides media in the library UI.
      try {
        const variantSummary = variants
          .map((v: any, i: number) =>
            `${i + 1}. [${v.scene || "?"}] ${v.persona || "?"} · hook=${v.hook || "?"} · framework=${v.framework || "?"} · voice=${v.voice || "?"}`
          )
          .join("\n");
        await admin.from("saved_prompts").insert({
          user_id: user.id,
          project_id: projectId,
          bucket: "master-ugc",
          prompt_text: variantSummary || "(no variants)",
          model: "veo-3.1",
          scene_template: `UGC plan · ${variants.length} variants · ${duration}s`,
          reference_url: productImageUrl || null,
          duration: is16s ? 16 : 8,
          aspect_ratio: aspectRatio,
          cost: totalCost,
          outcome: "success",
          source: "agent-ugc",
        });
      } catch (e) {
        console.error("[ugc/confirm] master-plan save failed:", e);
      }
    } catch (e: any) {
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
