import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { priceFor } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";
import { getCachedProductOcr } from "@/lib/product-ocr";
import { loadConversation } from "@/lib/agent";

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

// withLocks duplicated from agent-ugc.ts to keep the route self-contained.
// Keep in sync if the canonical block changes there.
const LOCKS_BLOCK = `

ANATOMY LOCK: ONE human only — exactly 2 hands with 5 fingers each (both clearly visible when in frame), symmetric face, normal proportions, no missing limbs, no extra limbs, no fused fingers, no warped joints, no plastic / waxy skin, no uncanny-valley features, no morphing face, no asymmetric eyes, no doubled facial features.
AUDIO LOCK: ONE single voice only — no chatter, no background voices, no whispered second voice, no echo doubles, NO ghost sound, NO phantom audio, NO unexplained noise. NO background music, NO instrumental, NO sound effects, NO ambient music, NO score, NO jingles. All audio is spoken dialog only.
DIALOG LENGTH LOCK: Total spoken dialog in this 8-second clip MUST be 20-24 words (Bahasa Melayu). Beat budget: hook 4-6 words / core message 10-14 words / reaction 0-2 words / outro 4-6 words. Under 18 words = the character will look frozen at the end. Over 26 words = rushed delivery + clipped audio. Hit 20-24 every time.
LANGUAGE LOCK: Spoken dialog is BAHASA MELAYU (Malaysian Malay) ONLY. NEVER Bahasa Indonesia. Use Malaysian markers: korang, aku, ni, tu, memang, gila, kau, lah, je, dah, eh. FORBIDDEN Indonesian words: kalian, gue, lo, banget, sih, dong, kayak, gimana, ngapain, kasihan, doang, mau, nih, tuh.
VOICE CONSISTENCY LOCK: The character's voice has fixed identity — same gender, same age range, same pitch, same Malaysian accent, same speaking rhythm and energy across the entire clip and any future continuation. Voice MUST stay locked so seg-2 / Extend continuations can match seg-1 seamlessly.
PRODUCT LOCK: Product visual is pixel-identical to reference — same color, shape, label, typography, layout, packaging, finish. Sharp focus on label, no warping, no recoloring, no text drift, no relabel, no re-illustration. When a reference image is attached, the reference is the SINGLE source of truth for the product — anchor framing, lighting, and hand-holding around it.
BEG KUNING LOCK: The phrase "beg kuning" (and any equivalent: yellow bag, shopping bag, affiliate icon, shop button) is SPOKEN DIALOG ONLY — NEVER rendered as a visual icon, yellow bag graphic, shopping cart icon, TikTok Shop button, sticker, or any on-screen element. Zero shop icons, zero yellow-bag graphics, zero buttons, zero affiliate stickers anywhere in frame.
UGC AUTHENTICITY: Authentic amateur iPhone UGC — handheld arm's-length, natural skin texture with pores and subtle T-zone shine (NOT airbrushed), no-makeup-makeup, loose hair, ordinary mixed lighting (NOT softbox), lived-in background with minor clutter.
VISUAL LOCK: RAW UNEDITED FOOTAGE — bottom 25% of frame COMPLETELY EMPTY. NO subtitles or text overlays, NO on-screen dialogue text, NO captions, NO animated TikTok captions, NO sticker text, NO icons, NO emojis, NO graphics, NO watermarks, NO UI elements, NO handles, NO hashtags, NO TikTok Shop badges. Clean vertical video frame with no interface overlay, no icons, no overlay elements.

Negative: cartoon, 3D cartoon, anime, airbrushed plastic skin, uncanny valley, glam makeup, salon hair, softbox studio lighting, tripod static shot (unless explicitly chosen), staged background, posed billboard framing, closed mouth while audio plays, duplicate limbs, extra fingers, fused fingers, distorted fingers, deformed hand, hand out of frame, warped product label, blurry product, motion-blurred product, text drift, subtitle burn-in, auto-captions, on-screen dialog text, burned-in lyrics, karaoke text, multiple speakers, second voice, whispered overdub, ghost voice, phantom audio, ambient noise, voiceover narration, music score, background music, instrumental track, sound effects, ambient music, jingles, interface overlay, app overlay, TikTok shop button, yellow bag icon, shopping bag icon, beg kuning icon, affiliate sticker, Bahasa Indonesia, Indonesian accent, Indonesian slang.`;

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

  // Pull the USP the user typed in the product-reference modal — it lives
  // on conversation state.last_product_usp (persisted in lib/agent.ts on
  // each turn that brought a product image). We hard-inject it into every
  // variant prompt so Veo sees the description verbatim regardless of what
  // the agent's tool-call args contained.
  const conv = await loadConversation(user.id, projectId, "ugc");
  const productUsp = String(conv?.state?.last_product_usp || "").trim();
  const productInfoBlock = productInfoLockBlock(productUsp);

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
