import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask, p2GetStatus } from "@/lib/p2";
import { p3CreateImage, p3GetStatus } from "@/lib/p3";
import {
  getCinemaRate,
  getP2Config,
  getViralImageConfig,
} from "@/lib/settings";
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

type ObjectiveBody = "benefit" | "complaint" | "cons";

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
    if (v === "benefit" || v === "complaint" || v === "cons") return v;
    // Back-compat: old "introduce" rows in flight default to benefit.
    return "benefit";
  })();
  const language: "ms" | "en" = body?.language === "en" ? "en" : "ms";
  const purpose = String(body?.purpose || "").trim().slice(0, 200);
  const projectId = body?.project_id ? String(body.project_id) : null;
  const mode: "t2v" | "i2v" = body?.mode === "t2v" ? "t2v" : "i2v";
  const customDialog = String(body?.custom_dialog || "").trim().slice(0, 400);
  const customTarget = String(body?.custom_target || "").trim().slice(0, 200);
  const performance: "action" | "standing" =
    body?.performance === "standing" ? "standing" : "action";

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
      prompt: `[Talking Object] ${object} · ${objective} · ${language} · ${mode}${
        purpose ? ` · ${purpose}` : ""
      }${customTarget ? ` · target:${customTarget}` : ""}`,
      task_id: null,
      duration: 8,
      cost: 0,
      metadata: {
        featureType: "talking-object",
        params: {
          object,
          objective,
          language,
          purpose,
          mode,
          customDialog: customDialog || undefined,
          customTarget: customTarget || undefined,
          performance,
        },
        stage: "queued",
        cinemaProvider: "veo",
        modelChoice: "veo",
        imageMode: mode === "t2v" ? "text" : "image",
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
      mode,
      customDialog: customDialog || undefined,
      customTarget: customTarget || undefined,
      performance,
    };

    const baseParams = {
      object,
      objective,
      language,
      purpose,
      mode,
      customDialog: customDialog || undefined,
      customTarget: customTarget || undefined,
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
            params: baseParams,
            stage: "llm-failed",
            upload_status: "failed",
          },
        })
        .eq("id", historyId);
      return;
    }

    const cfg = await getP2Config();
    const ratePerSec = await getCinemaRate();
    const cost = Number((ratePerSec * 8).toFixed(4));

    // ─── Path A: t2v — skip image gen, go direct to Veo text-to-video ───
    if (mode === "t2v") {
      const veoModel = cfg.videoT2V || cfg.videoI2V || cfg.videoR2V;
      if (!veoModel) {
        await admin
          .from("history")
          .update({
            status: "failed",
            error_message:
              "Veo t2v model not configured (set p2_model_t2v in admin)",
            metadata: {
              featureType: "talking-object",
              params: baseParams,
              stage: "veo-config-missing",
              video_prompt: promptPair.video_prompt,
              dialog_line: promptPair.dialog_line,
              scene_block: promptPair.scene_block,
              character_block: promptPair.character_block,
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
        imageUrls: [],
        durationMode: "8",
        aspectRatio: "9:16",
        imageMode: "text",
      });
      const veoProvider = veoCreate.provider || "p2";

      if (!veoCreate.ok || !veoCreate.task_id) {
        await admin
          .from("history")
          .update({
            status: "failed",
            cost,
            error_message: `Veo create failed: ${veoCreate.error || "unknown"}`,
            metadata: {
              featureType: "talking-object",
              params: baseParams,
              stage: "veo-create-failed",
              video_prompt: promptPair.video_prompt,
              dialog_line: promptPair.dialog_line,
              scene_block: promptPair.scene_block,
              character_block: promptPair.character_block,
              model: veoModel,
              provider: veoProvider,
              cinemaProvider: "veo",
              modelChoice: "veo",
              imageMode: "text",
              resolution: "720p",
              aspectRatio: "9:16",
              upload_status: "failed",
            },
          })
          .eq("id", historyId);
        return;
      }

      await admin
        .from("history")
        .update({
          task_id: veoCreate.task_id,
          cost,
          prompt: promptPair.video_prompt,
          metadata: {
            featureType: "talking-object",
            params: baseParams,
            stage: "veo-pending",
            video_prompt: promptPair.video_prompt,
            dialog_line: promptPair.dialog_line,
            scene_block: promptPair.scene_block,
            character_block: promptPair.character_block,
            model: veoModel,
            provider: veoProvider,
            cinemaProvider: "veo",
            modelChoice: "veo",
            imageMode: "text",
            resolution: "720p",
            aspectRatio: "9:16",
            upload_status: "done",
          },
        })
        .eq("id", historyId);
      return;
    }

    // ─── Path B: i2v — banana-pro image first, then Veo with start frame ───

    // Step 3: nano-banana-pro image gen
    await admin
      .from("history")
      .update({
        prompt: promptPair.video_prompt,
        metadata: {
          featureType: "talking-object",
          params: baseParams,
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

    // Resolve viral image provider + model from admin settings, with
    // fallback to global cfg.imageDefault.
    //   - p3 → Mountsea pathway, accepts nano-banana-pro / nano-banana-2 /
    //          nano-banana-fast (anything else falls back to fast)
    //   - p1 / p2 → Crun pathway with the admin-selected model id
    const viralCfg = await getViralImageConfig();
    const HARDCODED_MODEL_IDS: Record<string, string> = {
      "nano-banana-v2": "google/nano-banana-v2",
      "nano-banana-pro": "google/nano-banana-pro",
      "z-image": "z-image",
      "gpt-image-2": "openai/gpt-image-2-stable",
    };
    const imageModelKey = viralCfg.modelKey || cfg.imageDefault || "nano-banana-pro";
    const imageModel =
      (cfg.imageModels as any)?.[imageModelKey] ||
      HARDCODED_MODEL_IDS[imageModelKey] ||
      imageModelKey;
    const declaredImgProvider = viralCfg.provider; // pre-create-task hint for placeholder row

    // P3/Mountsea natively supports these three model ids. If the admin
    // picked anything outside this set (e.g. "z-image" or "gpt-image-2"
    // which are P2-only), fall back to nano-banana-fast.
    const P3_MODELS = new Set(["nano-banana-pro", "nano-banana-2", "nano-banana-fast"]);
    const p3Model = P3_MODELS.has(imageModelKey) ? imageModelKey : "nano-banana-fast";

    // Insert a PENDING image row UPFRONT so the Images sub-tab shows a
    // loading placeholder card while banana-pro is generating. We update
    // this row to done/failed once polling completes. The soft link
    // back to the parent video lives in metadata.parent_video_history_id
    // (do NOT set parent_history_id — that's reserved for seg-1/seg-2
    // chains in history-grid.tsx).
    let imageHistoryId: string | null = null;
    try {
      const { data: imgRow } = await admin
        .from("history")
        .insert({
          user_id: user.id,
          project_id: projectId,
          type: "image",
          tab: "cinema",
          status: "pending",
          prompt: promptPair.image_prompt,
          output_url: null,
          thumbnail_url: null,
          cost: 0,
          metadata: {
            featureType: "talking-object-image",
            params: baseParams,
            stage: "queued",
            image_prompt: promptPair.image_prompt,
            scene_block: promptPair.scene_block,
            character_block: promptPair.character_block,
            model: declaredImgProvider === "p3" ? p3Model : imageModelKey,
            provider: declaredImgProvider,
            parent_video_history_id: historyId,
            upload_status: "queued",
          },
        })
        .select("id")
        .single();
      imageHistoryId = imgRow?.id || null;
    } catch (e) {
      console.error(
        `[talking-object] pending image-row insert failed for parent ${historyId}:`,
        e
      );
    }

    let imgCreate: { ok: boolean; task_id?: string; provider?: "p1" | "p2" | "p3"; error?: string };
    if (viralCfg.provider === "p3") {
      const r = await p3CreateImage({
        prompt: promptPair.image_prompt,
        model: p3Model,
        aspectRatio: "9:16",
      });
      imgCreate = r.ok
        ? { ok: true, task_id: r.task_id, provider: "p3" }
        : { ok: false, error: r.error, provider: "p3" };
    } else {
      // p1 + p2 share the Crun pathway (p1 is a pass-through alias here).
      const r = await p2CreateTask({
        model: imageModel,
        prompt: promptPair.image_prompt,
        imageUrls: [], // explicitly empty — banana-pro does t2i without a ref
        aspectRatio: "9:16",
      });
      imgCreate = {
        ok: r.ok,
        task_id: r.ok ? r.task_id : undefined,
        provider: r.provider || "p2",
        error: r.ok ? undefined : r.error,
      };
    }
    if (!imgCreate.ok || !imgCreate.task_id) {
      // Flip the placeholder image row to failed so it surfaces the error
      // visually instead of spinning forever.
      if (imageHistoryId) {
        await admin
          .from("history")
          .update({
            status: "failed",
            error_message: `Image create failed: ${imgCreate.error || "unknown"}`,
            metadata: {
              featureType: "talking-object-image",
              params: baseParams,
              stage: "image-create-failed",
              image_prompt: promptPair.image_prompt,
              parent_video_history_id: historyId,
              upload_status: "failed",
            },
          })
          .eq("id", imageHistoryId);
      }
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: `Image create failed: ${imgCreate.error || "unknown"}`,
          metadata: {
            featureType: "talking-object",
            params: baseParams,
            stage: "image-create-failed",
            image_prompt: promptPair.image_prompt,
            video_prompt: promptPair.video_prompt,
            upload_status: "failed",
          },
        })
        .eq("id", historyId);
      return;
    }

    // Stamp the image task_id on the placeholder row so /api/check-status
    // (or any future poller) can re-query it if needed.
    const imgProvider = (imgCreate.provider || viralCfg.provider) as "p1" | "p2" | "p3";
    if (imageHistoryId) {
      await admin
        .from("history")
        .update({
          task_id: imgCreate.task_id,
          metadata: {
            featureType: "talking-object-image",
            params: baseParams,
            stage: "generating",
            image_prompt: promptPair.image_prompt,
            scene_block: promptPair.scene_block,
            character_block: promptPair.character_block,
            model: imgProvider === "p3" ? p3Model : imageModelKey,
            provider: imgProvider,
            parent_video_history_id: historyId,
            upload_status: "queued",
          },
        })
        .eq("id", imageHistoryId);
    }

    // Poll image until done — 90s budget (banana-pro is usually 20-50s).
    const pollDeadline = Date.now() + 90_000;
    let imageUrl = "";
    let imgError = "";
    while (Date.now() < pollDeadline) {
      await new Promise((f) => setTimeout(f, 3500));
      let st: { status: string; outputUrl?: string; error?: string };
      if (imgProvider === "p3") {
        const r = await p3GetStatus(imgCreate.task_id);
        st = {
          status: r.status,
          outputUrl: r.outputUrl,
          error: r.error,
        };
      } else {
        st = await p2GetStatus(imgCreate.task_id, imgProvider as "p1" | "p2");
      }
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
      // Flip the placeholder image row to failed.
      if (imageHistoryId) {
        await admin
          .from("history")
          .update({
            status: "failed",
            error_message:
              imgError || "Image gen timed out (90s) — try again",
            metadata: {
              featureType: "talking-object-image",
              params: baseParams,
              stage: "image-timeout",
              image_prompt: promptPair.image_prompt,
              scene_block: promptPair.scene_block,
              character_block: promptPair.character_block,
              parent_video_history_id: historyId,
              upload_status: "failed",
            },
          })
          .eq("id", imageHistoryId);
      }
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message:
            imgError || "Image gen timed out (90s) — try again",
          metadata: {
            featureType: "talking-object",
            params: baseParams,
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

    // Image done — flip the placeholder image row to status="done" with
    // the final URL. The card on the Images sub-tab morphs from spinner
    // into the actual image without needing a re-fetch.
    if (imageHistoryId) {
      await admin
        .from("history")
        .update({
          status: "done",
          output_url: imageUrl,
          thumbnail_url: imageUrl,
          metadata: {
            featureType: "talking-object-image",
            params: baseParams,
            stage: "done",
            image_prompt: promptPair.image_prompt,
            scene_block: promptPair.scene_block,
            character_block: promptPair.character_block,
            model: imgProvider === "p3" ? p3Model : imageModelKey,
            provider: imgProvider,
            parent_video_history_id: historyId,
            upload_status: "done",
          },
        })
        .eq("id", imageHistoryId);
    }

    // Step 4: Veo i2v with the generated image as the START FRAME.
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
            params: baseParams,
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
      imageMode: "frame",
    });

    const veoProvider = veoCreate.provider || "p2";

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
            params: baseParams,
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

    await admin
      .from("history")
      .update({
        task_id: veoCreate.task_id,
        cost,
        reference_url: imageUrl,
        metadata: {
          featureType: "talking-object",
          params: baseParams,
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
