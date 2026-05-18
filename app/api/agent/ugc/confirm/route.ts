import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { priceFor } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";
import { getCachedProductOcr } from "@/lib/product-ocr";
import { loadConversation } from "@/lib/agent";
import { buildVeoLocks, pickVoiceFromPrompt } from "@/lib/veo-voices";

// Build a PRODUCT INFO LOCK block for the USP/description the user typed
// in the product-reference modal. Pinned to the front of every variant
// prompt at fire time so Veo sees it verbatim regardless of what the
// agent's tool call did or didn't fold into product_description.
function productInfoLockBlock(usp?: string | null): string {
  const trimmed = String(usp || "").trim();
  if (!trimmed) return "";
  return `PRODUCT INFO (user-provided — respect verbatim, anchor scene around these facts):
${trimmed}

`;
}

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

// Locks come from lib/veo-voices.ts — single source shared with the UGC
// agent, manual UGC route, and Auto Content. Don't duplicate here.
//
// VOICE CHARACTER is strict-picked from the 30-voice catalog. The agent
// generates a freeform variant prompt that mentions the character (e.g.
// "Malay woman in her 30s..."); pickVoiceFromPrompt parses gender / age
// / vibe from that text and resolves to a specific catalog voice ID like
// "callirrhoe" or "fenrir". buildVeoLocks then emits the canonical
// "VOICE CHARACTER (LOCKED): <Name> — <traits>" line. Same prompt =>
// same voice across retries / segment-chain / Extend continuations.
function withLocks(corePrompt: string, voiceLine?: string): string {
  const autoPickedVoiceId = pickVoiceFromPrompt(corePrompt);
  return `${corePrompt.trim()}${buildVeoLocks({ voiceId: autoPickedVoiceId, voiceLine })}`;
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
  // useIngredient is now a function call below since we don't yet know
  // about the character ref at this point. It's redefined after we read
  // characterImageUrl off conversation state.
  let useIngredient = !!productImageUrl;

  // Pull the USP the user typed in the product-reference modal — it lives
  // on conversation state.last_product_usp (persisted in lib/agent.ts on
  // each turn that brought a product image). We hard-inject it into every
  // variant prompt so Veo sees the description verbatim regardless of what
  // the agent's tool-call args contained.
  const conv = await loadConversation(user.id, projectId, "ugc");
  const productUsp = String(conv?.state?.last_product_usp || "").trim();
  const productInfoBlock = productInfoLockBlock(productUsp);
  // Optional character reference image — when the user attached one via
  // the UserCircle2 icon in the chat panel, lib/agent.ts persists its
  // public URL on conv.state.last_character_image_url. We pass it as a
  // SECOND ingredient ref alongside the product so Veo locks the same
  // face / hair / wardrobe across every generated scene.
  const characterImageUrl = String(
    conv?.state?.last_character_image_url || ""
  ).trim();
  // Use ingredient mode whenever EITHER a product OR a character ref is
  // attached. Pure text-to-video only when both are absent.
  useIngredient = !!productImageUrl || !!characterImageUrl;
  // Compose ingredient image list. Order matters — Veo treats imageUrls[0]
  // as the primary visual anchor. Product image goes first when present
  // (since label fidelity is mission-critical for affiliate clips); the
  // character ref slots in second so the same face reads the script.
  // When only character is supplied, it becomes the primary ref.
  const ingredientImageUrls: string[] = [];
  if (productImageUrl) ingredientImageUrls.push(productImageUrl);
  if (characterImageUrl) ingredientImageUrls.push(characterImageUrl);

  // Build per-variant seg-1 prompts upfront (fast — no I/O).
  type Prepared = { v: any; idx: number; seg1Prompt: string };
  const prepared: Prepared[] = variants.map((v: any, idx: number) => {
    let seg1Prompt = v.prompt;
    if (is16s && v.character_lock) {
      seg1Prompt = `${v.prompt.trim()}\n\n${v.character_lock.trim()}`;
      seg1Prompt = withLocks(seg1Prompt, v.voice_line || undefined);
    }
    // Pin the user's USP/description to the front of the final prompt.
    // No-op if no USP was typed.
    if (productInfoBlock) seg1Prompt = `${productInfoBlock}${seg1Prompt}`;
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
            userId: user.id,
            prompt: seg1Prompt,
            // Multi-ingredient: product first (label anchor), then
            // character (face/wardrobe anchor). Either or both — empty
            // array falls through to imageMode='text' below.
            imageUrls: ingredientImageUrls,
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
                provider: created.provider || "p2",
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
