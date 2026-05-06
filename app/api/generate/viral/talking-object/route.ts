import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask, p2GetStatus } from "@/lib/p2";
import { getCinemaRate, getP2Config } from "@/lib/settings";
import {
  generateTalkingObjectPrompts,
  type TalkingObjectInput,
} from "@/lib/agent-talking-object";

// POST /api/generate/viral/talking-object
//
// Pipeline (all inside Vercel after() so the user gets an instant ack):
//   1. Insert history row (status="pending", tab="cinema",
//      metadata.featureType="talking-object")
//   2. LLM (OpenRouter / model_auto) — system prompt is the master template
//      from lib/agent-talking-object.ts, user prompt is the form data + any
//      existing scene_block/character_block from the project's prior
//      talking-object videos. Returns { image_prompt, video_prompt,
//      dialog_line, scene_block, character_block, language }.
//   3. nano-banana-pro create_task with image_prompt → poll p2 status until
//      the image URL lands (typical 20-60s, capped at 90s).
//   4. Veo 3.1 fast i2v create_task with the video_prompt + image as the
//      ingredient reference. Saves task_id back on the history row.
//   5. Standard webhook + lib/settle.ts handles Veo completion → row done.
//
// All step transitions are best-effort — if the LLM call fails or the
// image gen times out, the row flips to status="failed" with a useful
// error_message so the card surfaces what went wrong.

export const runtime = "nodejs";
export const maxDuration = 300; // up to 5 min — image gen polling can take a while
export const dynamic = "force-dynamic";

type ObjectiveBody = "introduce" | "benefit" | "cons";

export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { session },
  } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const object = String(body?.object || "").trim().slice(0, 80);
  const objective = ((): ObjectiveBody => {
    const v = String(body?.objective || "").toLowerCase();
    if (v === "benefit" || v === "cons" || v === "introduce") return v;
    return "benefit";
  })();
  const language: "ms" | "en" = body?.language === "en" ? "en" : "ms";
  const purpose = String(body?.purpose || "").trim().slice(0, 200);
  const projectId = body?.project_id ? String(body.project_id) : null;

  if (!object) {
    return NextResponse.json({ error: "Object required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // 1. Insert placeholder history row immediately so the dashboard shows a
  //    pending card. cost gets stamped after we know whether we billed
  //    successfully (after Veo returns a task_id).
  const { data: hist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: projectId,
      type: "video",
      tab: "cinema",
      status: "pending",
      prompt: `[Talking Object] ${object} · ${objective} · ${language}${
        purpose ? ` · ${purpose}` : ""
      }`,
      task_id: null,
      duration: 8,
      cost: 0,
      metadata: {
        featureType: "talking-object",
        params: { object, objective, language, purpose },
        stage: "queued",
        cinemaProvider: "veo",
        modelChoice: "veo",
        imageMode: "image",
        resolution: "720p",
        aspectRatio: "9:16",
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

  // 2-4. Background pipeline. after() keeps the function alive after the
  // response is sent so the user sees an instant pending card.
  after(async () => {
    const input: TalkingObjectInput = {
      object,
      objective,
      language,
      purpose,
      projectId,
    };

    let promptPair;
    try {
      // Step 2: LLM call — deterministic, ~3-8s typical
      promptPair = await generateTalkingObjectPrompts(input);
    } catch (e: any) {
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: `LLM prompt-gen failed: ${String(e?.message || e).slice(
            0,
            200
          )}`,
          metadata: {
            featureType: "talking-object",
            params: { object, objective, language, purpose },
            stage: "llm-failed",
            upload_status: "failed",
          },
        })
        .eq("id", historyId);
      return;
    }

    // Step 3: nano-banana-pro image gen
    await admin
      .from("history")
      .update({
        prompt: promptPair.video_prompt, // store the FINAL video prompt as the row's prompt for transparency
        metadata: {
          featureType: "talking-object",
          params: { object, objective, language, purpose },
          stage: "generating-image",
          image_prompt: promptPair.image_prompt,
          video_prompt: promptPair.video_prompt,
          dialog_line: promptPair.dialog_line,
          scene_block: promptPair.scene_block,
          character_block: promptPair.character_block,
          cinemaProvider: "veo",
          modelChoice: "veo",
          imageMode: "image",
          resolution: "720p",
          aspectRatio: "9:16",
          upload_status: "queued",
        },
      })
      .eq("id", historyId);

    const cfg = await getP2Config();
    // Resolve image model id: cfg.imageDefault is the KEY ("nano-banana-pro"),
    // cfg.imageModels[KEY] is the actual provider model id ("google/nano-banana-pro").
    // Mirror exactly how /api/generate/image/route.ts resolves it.
    const imageModelKey = cfg.imageDefault || "nano-banana-pro";
    const imageModel =
      (cfg.imageModels as any)?.[imageModelKey] || imageModelKey;

    const imgCreate = await p2CreateTask({
      model: imageModel,
      prompt: promptPair.image_prompt,
      imageUrls: [], // explicitly empty — banana-pro does t2i without a ref
      aspectRatio: "9:16",
    });
    if (!imgCreate.ok || !imgCreate.task_id) {
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: `Image create failed: ${imgCreate.error || "unknown"}`,
          metadata: {
            featureType: "talking-object",
            params: { object, objective, language, purpose },
            stage: "image-create-failed",
            image_prompt: promptPair.image_prompt,
            video_prompt: promptPair.video_prompt,
            upload_status: "failed",
          },
        })
        .eq("id", historyId);
      return;
    }

    // Poll image until done — 90s budget (banana-pro is usually 20-50s).
    const imgProvider = (imgCreate.provider || "p2") as "p1" | "p2";
    const pollDeadline = Date.now() + 90_000;
    let imageUrl = "";
    let imgError = "";
    while (Date.now() < pollDeadline) {
      await new Promise((f) => setTimeout(f, 3500));
      const st = await p2GetStatus(imgCreate.task_id, imgProvider);
      if (st.status === "succeeded" && st.outputUrl) {
        imageUrl = st.outputUrl;
        break;
      }
      if (st.status === "failed") {
        imgError = st.error || "image gen failed";
        break;
      }
    }
    if (!imageUrl) {
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message:
            imgError || "Image gen timed out (90s) — try again",
          metadata: {
            featureType: "talking-object",
            params: { object, objective, language, purpose },
            stage: "image-timeout",
            image_prompt: promptPair.image_prompt,
            video_prompt: promptPair.video_prompt,
            scene_block: promptPair.scene_block,
            character_block: promptPair.character_block,
            upload_status: "failed",
          },
        })
        .eq("id", historyId);
      return;
    }

    // Insert a child history row for the GENERATED IMAGE so it appears
    // in the Viral tab's "Images" sub-tab alongside the final video.
    // parent_history_id links it back to the video row — Save flow,
    // delete cascade, and the slider can all use this relationship later.
    // Best-effort: a failure here doesn't block the video generation.
    try {
      await admin.from("history").insert({
        user_id: user.id,
        project_id: projectId,
        type: "image",
        tab: "cinema",
        status: "done",
        prompt: promptPair.image_prompt,
        output_url: imageUrl,
        thumbnail_url: imageUrl,
        parent_history_id: historyId,
        cost: 0, // image cost rolled into the parent video row's cost
        metadata: {
          featureType: "talking-object-image",
          params: { object, objective, language, purpose },
          stage: "done",
          image_prompt: promptPair.image_prompt,
          scene_block: promptPair.scene_block,
          character_block: promptPair.character_block,
          model: "nano-banana-pro",
          provider: imgProvider,
          parent_video_history_id: historyId,
          upload_status: "done",
        },
      });
    } catch (e) {
      console.error(
        `[talking-object] image-row insert failed for parent ${historyId}:`,
        e
      );
    }

    // Step 4: Veo i2v with the generated image as the START FRAME.
    // We want pixel-identical character continuity from the banana-pro
    // still → first frame of the Veo video, so use videoI2V (first-frame
    // variant) + imageMode="frame". Falls back to videoR2V if i2v isn't
    // configured (admin-tunable).
    const veoModel = cfg.videoI2V || cfg.videoR2V;
    if (!veoModel) {
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message:
            "Veo i2v model not configured (set p2_model_i2v or p2_model_r2v in admin)",
          metadata: {
            featureType: "talking-object",
            params: { object, objective, language, purpose },
            stage: "veo-config-missing",
            image_prompt: promptPair.image_prompt,
            video_prompt: promptPair.video_prompt,
            scene_block: promptPair.scene_block,
            character_block: promptPair.character_block,
            generated_image_url: imageUrl,
            upload_status: "failed",
          },
        })
        .eq("id", historyId);
      return;
    }

    const veoCreate = await p2CreateTask({
      model: veoModel,
      userId: user.id,
      prompt: promptPair.video_prompt,
      imageUrls: [imageUrl],
      durationMode: "8",
      aspectRatio: "9:16",
      // "frame" = the input image IS the first frame of the video.
      // Pixel-identical character continuity (no re-render).
      imageMode: "frame",
    });

    const veoProvider = veoCreate.provider || "p2";
    const ratePerSec = await getCinemaRate();
    const cost = Number((ratePerSec * 8).toFixed(4));

    if (!veoCreate.ok || !veoCreate.task_id) {
      await admin
        .from("history")
        .update({
          status: "failed",
          cost,
          error_message: `Veo create failed: ${veoCreate.error || "unknown"}`,
          reference_url: imageUrl,
          metadata: {
            featureType: "talking-object",
            params: { object, objective, language, purpose },
            stage: "veo-create-failed",
            image_prompt: promptPair.image_prompt,
            video_prompt: promptPair.video_prompt,
            dialog_line: promptPair.dialog_line,
            scene_block: promptPair.scene_block,
            character_block: promptPair.character_block,
            generated_image_url: imageUrl,
            model: veoModel,
            provider: veoProvider,
            cinemaProvider: "veo",
            modelChoice: "veo",
            imageMode: "image",
            resolution: "720p",
            aspectRatio: "9:16",
            upload_status: "failed",
          },
        })
        .eq("id", historyId);
      return;
    }

    // Success path — task_id stamped, settle.ts will handle the webhook.
    await admin
      .from("history")
      .update({
        task_id: veoCreate.task_id,
        cost,
        reference_url: imageUrl,
        metadata: {
          featureType: "talking-object",
          params: { object, objective, language, purpose },
          stage: "veo-pending",
          image_prompt: promptPair.image_prompt,
          video_prompt: promptPair.video_prompt,
          dialog_line: promptPair.dialog_line,
          scene_block: promptPair.scene_block,
          character_block: promptPair.character_block,
          generated_image_url: imageUrl,
          model: veoModel,
          provider: veoProvider,
          cinemaProvider: "veo",
          modelChoice: "veo",
          imageMode: "image",
          resolution: "720p",
          aspectRatio: "9:16",
          upload_status: "done",
        },
      })
      .eq("id", historyId);
  });

  return NextResponse.json({
    ok: true,
    history_id: historyId,
  });
}
