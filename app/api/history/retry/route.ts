import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { getP2Config } from "@/lib/settings";
import { generateImageWithCascade } from "@/lib/image-cascade";
import { generateVideoWithCascade } from "@/lib/video-cascade";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// POST /api/history/retry { history_id }
//
// Re-fires the SAME row that previously failed. Updates status pending +
// new task_id in place — no new history row, no double-charge. Works for
// every generation tab (image / video / ugc / cinema / auto-content) by
// reading the original row's prompt + reference_url + metadata and picking
// the right Crun.ai model from app_settings.
//
// Auth model: user must own the row. We re-use whatever was stored on the
// row (prompt, reference_url, metadata.model, imageMode, duration) so the
// retry is byte-identical to the first attempt.
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const historyId = String(body?.history_id || "").trim();
  // Optional prompt override from the failed-card edit textarea. If
  // present (and non-empty), Resubmit uses this instead of the
  // original row.prompt — and persists it back to row.prompt so the
  // edit sticks for future retries / extends.
  const promptOverride = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!historyId) {
    return NextResponse.json({ error: "history_id required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: row, error: selErr } = await admin
    .from("history")
    .select(
      "id, user_id, type, tab, status, prompt, reference_url, duration, cost, metadata, error_message"
    )
    .eq("id", historyId)
    .maybeSingle();

  if (selErr || !row) {
    return NextResponse.json({ error: "History row not found" }, { status: 404 });
  }
  // Owner can retry their own rows. Admins can retry anyone's row (used
  // by /admin/errors). When an admin retries, the cascade still runs
  // under row.user_id so cost / rate-limit / metadata stay attributed
  // to the original owner — admin acting on behalf, not impersonating.
  let actingUserId = user.id;
  if (row.user_id !== user.id) {
    const { data: me } = await sb
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (!me?.is_admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    actingUserId = row.user_id;
  }
  if (!row.prompt) {
    return NextResponse.json(
      { error: "Original prompt missing — cannot retry" },
      { status: 400 }
    );
  }

  // Effective prompt for this retry. promptOverride wins if provided.
  const effectivePrompt = promptOverride || row.prompt;
  if (promptOverride) {
    // Persist the edit on the row so future polls / extends see the
    // updated text and admin tooling shows what was actually sent.
    await admin
      .from("history")
      .update({ prompt: effectivePrompt })
      .eq("id", historyId);
  }

  // Block retry on rows that are still in flight or already done. Only
  // failed rows make sense to retry; the user can stop pending rows by
  // letting them settle / fail naturally first.
  if (row.status !== "failed") {
    return NextResponse.json(
      {
        error: `Row is "${row.status}" — only failed rows can be retried`,
      },
      { status: 400 }
    );
  }

  // MANUAL Resubmit approves EVERY failed row — no error-type gate.
  // Per user direction 2026-07-04: the manual button should re-fire any
  // failed row regardless of the original error (client's explicit
  // choice). The isInternalError gate is intentionally NOT applied here.
  // (Auto paths — event-driven settle + auto-resubmit cron — still keep
  // the isInternalError gate; only this manual button is unrestricted.)

  // ATOMIC CLAIM: flip status failed → pending BEFORE firing the
  // cascade. If 0 rows match (because the auto-resubmit cron got here
  // first OR a parallel user click), abort with a clear error so we
  // don't fire a duplicate task at the upstream provider.
  const { data: claimed, error: claimErr } = await admin
    .from("history")
    .update({
      status: "pending",
      error_message: null,
    })
    .eq("id", historyId)
    .eq("status", "failed")
    .select("id");
  if (claimErr || !claimed || claimed.length === 0) {
    return NextResponse.json(
      { error: "Already resubmitting — please wait for the in-flight task to finish." },
      { status: 409 }
    );
  }

  const cfg = await getP2Config();
  const meta = (row.metadata || {}) as Record<string, any>;
  const refImage = row.reference_url || "";

  // Auto UGC rows that failed BEFORE their Banana start frame existed can't
  // retry through the video cascade (Grok i2v needs the frame). Hand them
  // back to the auto-ugc-recover cron: reset the phase + attempts so the
  // next tick regenerates the frame and fires Grok. Status is already
  // "pending" from the claim above, which is exactly the state the worker
  // scans for (pending + task_id null).
  if (row.tab === "auto-ugc" && !refImage && !row.task_id) {
    await admin
      .from("history")
      .update({
        task_id: null,
        metadata: { ...meta, ugc_phase: "startframe_pending", startframe_attempts: 0 },
      })
      .eq("id", historyId);
    return NextResponse.json({
      ok: true,
      mode: "auto-ugc-recover",
      message: "Dihantar ke auto-recover — frame akan dijana semula dan Grok akan fire dalam beberapa minit.",
    });
  }
  // Prefer the full image_urls array stamped at original-fire time so
  // Resubmit re-fires with ALL attachments (up to 3). Falls back to
  // [reference_url] for legacy rows that didn't stamp the full array.
  const allImageUrls: string[] = Array.isArray(meta.image_urls) && meta.image_urls.length > 0
    ? meta.image_urls.filter((u: any) => typeof u === "string" && u.trim())
    : (refImage ? [refImage] : []);
  const aspectRatio = String(meta.aspectRatio || meta.aspect_ratio || "9:16");
  // Preserve the ORIGINAL duration on resubmit/fallback. Veo = 8 or 16;
  // Grok Imagine = 1-15s; Sora 2 = 8 or 12. The old `=== 16 ? "16" : "8"`
  // collapsed everything else to 8, silently downgrading a 15s Grok job
  // (or 12s Sora job) to 8s on retry. row.duration is stamped at original
  // fire time for every provider, so just carry it through.
  const durationMode: string = String(row.duration || 8);
  const imageMode: "frame" | "ingredient" | "text" =
    meta.imageMode === "frame" || meta.imageMode === "ingredient"
      ? meta.imageMode
      : refImage
        ? "ingredient"
        : "text";

  // Pick the right Crun.ai model based on the tab the row originally ran
  // through. metadata.model wins if it's been recorded (auto-content rows
  // record the resolved model so retry is exact-faithful even if admin
  // rotated the model since the original fire).
  let model = String(meta.model || "");
  if (!model) {
    if (row.tab === "image" || row.type === "image") {
      const imgModel =
        meta.image_model ||
        meta.model_override ||
        cfg.imageDefault ||
        "google/nano-banana-pro";
      model = String(imgModel);
    } else if (row.tab === "cinema" || row.tab === "original-video") {
      // Cinema + Original Video can be Veo, Grok, Sora 2, or GeminiOmni
      // — disambiguate via the row's modelChoice tag stamped at insert
      // time. Falls back to Grok for legacy rows that pre-date the
      // modelChoice metadata.
      if (meta.modelChoice === "veo") {
        model = refImage ? cfg.videoR2V : cfg.videoT2V;
      } else if (meta.modelChoice === "sora2") {
        // p6.ts apipodVideoModel maps "sora2" → "sora-2-vip" regardless
        // of refs (sora-2-vip is a single endpoint).
        model = "sora2";
      } else if (meta.modelChoice === "gemini") {
        // GeminiOmni — single Crun model id; p2.ts builds the body
        // shape (img_urls + duration + 1080p) based on imageMode.
        model = "google/gemini-omni";
      } else if (meta.modelChoice === "seedance") {
        // Seedance 2.0 Fast — pass bare "seedance" keyword. p2.ts +
        // p6.ts both auto-resolve to the right t2v/i2v/r2v variant
        // based on refs.
        model = "seedance";
      } else {
        model = refImage ? cfg.grokI2V : cfg.grokT2V;
      }
    } else {
      // video / ugc / auto-content / clone
      model = refImage ? cfg.videoR2V : cfg.videoT2V;
    }
  }

  // Route through the appropriate cascade:
  //   • image / fairytale-scene → image cascade (p2 ↔ p4 bidirectional)
  //   • cinema with Grok        → p2 only (no Grok cascade defined)
  //   • else (video tabs)       → video cascade (p2-A → p2-B, 2 tiers only)
  const isImageRow =
    row.tab === "image" || row.type === "image" || row.type === "fairytale-scene";
  const isSeedance = model.toLowerCase().includes("seedance");

  let newTaskId: string | null = null;
  let newProvider: "p1" | "p2" | "p3" | "p4" | "p5" | "p6" = "p2";
  let newSlot: string | undefined = undefined;
  let newKeyIndex: number | undefined = undefined;
  let newModel: string = model;
  let fallbackUsed = false;
  let tierLog: any = undefined;
  let retryError: string | null = null;

  if (isImageRow) {
    const primaryProvider: "p2" | "p3" | "p4" =
      meta.primary_provider === "p4" || meta.provider === "p4"
        ? "p4"
        : meta.primary_provider === "p3" || meta.provider === "p3"
          ? "p3"
          : "p2";
    // Resubmit: rotate to a different slot than the last one. Read
    // the prior slot from metadata.slot (preferred) or tier_log[0].tier
    // (legacy rows).
    let imgSkipSlot: any = meta.slot;
    if (!imgSkipSlot) {
      const priorImgLog: any[] = Array.isArray(meta.tier_log) ? meta.tier_log : [];
      const lastImg = priorImgLog[priorImgLog.length - 1];
      const parts = String(lastImg?.tier || "").split(":");
      if (parts.length >= 2) imgSkipSlot = parts[1];
    }
    const r = await generateImageWithCascade({
      primaryProvider,
      primaryModel: model.replace(/^google\//, "").replace(/^openai\//, ""),
      primaryModelP2: model,
      prompt: effectivePrompt,
      aspectRatio,
      imageUrls: allImageUrls.length > 0 ? allImageUrls : undefined,
      skipSlot: imgSkipSlot,
      retry: true,
    });
    if (r.ok) {
      newTaskId = r.taskId;
      newProvider = r.actualProvider;
      newSlot = r.actualSlot;
      newKeyIndex = (r as any).keyIndex;
      newModel = r.actualModel;
      fallbackUsed = r.fallbackUsed;
      tierLog = r.tierLog;
    } else {
      retryError = r.error;
      tierLog = r.tierLog;
    }
  } else if (isSeedance) {
    // Seedance: single P1 (GeminiGen) call, no cascade.
    const { p1CreateTask } = await import("@/lib/p1");
    const created = await p1CreateTask({
      model,
      prompt: effectivePrompt,
      imageUrls: allImageUrls,
      durationMode,
      aspectRatio,
      imageMode,
    });
    if (created.ok && created.task_id) {
      newTaskId = created.task_id;
      newProvider = "p1";
    } else {
      retryError = created.error || "Seedance create failed";
    }
  } else {
    // Single-shot video cascade — retry rotates to a different slot.
    // skipSlot tells the cascade to AVOID the slot from the prior
    // attempt (whether it failed at create or during polling). The
    // cascade picks the next valid slot in rotation.
    const priorLog: Array<{ tier?: string; ok?: boolean }> = Array.isArray(
      meta.tier_log
    )
      ? meta.tier_log
      : [];
    let skipSlot: any = undefined;
    const lastEntry = priorLog[priorLog.length - 1];
    if (lastEntry) {
      const parts = String(lastEntry.tier || "").split(":");
      if (parts.length >= 2) skipSlot = parts[1];
    }
    // Fall back to metadata.slot if tier_log is empty (legacy rows).
    if (!skipSlot && meta.slot) skipSlot = meta.slot;
    if (skipSlot) {
      console.warn(
        `[retry] row ${row.id}: avoiding slot ${skipSlot} — cascade will rotate to a different slot`
      );
    }

    // Asset detection — match the cascade pool the row originally
    // fired through so the fallback round-robin uses the same family:
    //   • Sora 2 rows  → tab='sora2' OR modelChoice='sora2' → sora2 cascade
    //   • Seedance rows → tab='seedance' → cinema cascade
    //   • Grok rows     → tab='cinema' or 'original-video' or 'grok' +
    //                     modelChoice='grok' (or model has 'grok') → grok cascade
    //   • Everything else (UGC, Auto, Veo viral, clone) → video cascade
    let asset: "video" | "grok" | "cinema" | "sora2" | "gemini" = "video";
    if (row.tab === "sora2") asset = "sora2";
    else if (meta.modelChoice === "sora2" || /sora/i.test(model)) {
      asset = "sora2";
    }
    else if (meta.modelChoice === "gemini" || /gemini-omni/i.test(model)) {
      // GeminiOmni rows route through the dedicated gemini cascade pool
      // so resubmits walk the same provider family (Crun) the original
      // fire used — not the generic video pool which may route p6/p5.
      asset = "gemini";
    }
    else if (row.tab === "seedance") asset = "cinema";
    else if (meta.modelChoice === "seedance" || /seedance/i.test(model)) {
      // Original Video tab Seedance rows have tab='original-video', not
      // tab='seedance', so they'd fall through to the default 'video'
      // pool without this branch. Route them through the cinema cascade
      // (same pool used by the dedicated Seedance tab).
      asset = "cinema";
    }
    else if (meta.modelChoice === "grok" || /grok/i.test(model)) {
      // Grok Imagine rows route through the dedicated grok cascade pool
      // (p6-a/b/c). modelChoice/model is the authoritative signal — match
      // REGARDLESS of tab. Dialog UGC grok rows are tab="video" (see
      // /api/generate/video), so the old tab gate (cinema/original-video/grok
      // only) sent them to the Veo 'video' pool on resubmit → wrong params →
      // "attempt1: Missing Params or Type Error". Fixed 2026-06-19.
      asset = "grok";
    }

    const r = await generateVideoWithCascade({
      primaryModel: model,
      userId: actingUserId,
      prompt: effectivePrompt,
      imageUrls: allImageUrls,
      durationMode,
      aspectRatio,
      imageMode,
      skipSlot,
      retry: true,
      // Admin Resubmit (single + bulk both flow through this route) →
      // start at the FIRST configured fallback slot, not wherever the
      // round-robin counter is. Per user direction. Event-driven retry
      // in settle.ts keeps the normal round-robin so retries naturally
      // spread across slots.
      forceFirstFallback: true,
      asset,
    });
    if (r.ok) {
      newTaskId = r.taskId;
      newProvider = r.actualProvider;
      newSlot = r.actualSlot;
      newKeyIndex = (r as any).keyIndex;
      newModel = r.actualModel;
      fallbackUsed = r.fallbackUsed;
      tierLog = r.tierLog;
    } else {
      retryError = r.error;
      tierLog = r.tierLog;
    }
  }

  if (!newTaskId) {
    // All cascade tiers failed (or Grok create failed). Stamp the latest
    // error onto the row so the user sees why retry didn't take.
    await admin
      .from("history")
      .update({
        status: "failed",
        error_message: retryError || "Retry failed",
        metadata: {
          ...meta,
          last_retry_error: retryError || "Retry failed",
          last_retry_at: new Date().toISOString(),
          tier_log: tierLog,
        },
      })
      .eq("id", row.id);

    return NextResponse.json(
      { error: retryError || "Retry failed" },
      { status: 502 }
    );
  }

  // Flip the row back to pending with the new task_id so the existing
  // settle / poll path (webhook + cron) picks up the result on the SAME
  // card. Wipe error_message so the failure UI clears immediately.
  //
  // CRITICAL: reset auto_resubmit_count to 0 so the cron + event-driven
  // retry treat this as a FRESH attempt with a full fallback budget.
  // Per user direction: "when admin click resubmit, it starts from
  // first fallback cascade again". Without the reset, an admin click
  // on an already-exhausted row would die after 1 retry because the
  // count was already at the cap.
  await admin
    .from("history")
    .update({
      status: "pending",
      task_id: newTaskId,
      error_message: null,
      metadata: {
        ...meta,
        provider: newProvider,
        slot: newSlot,
        ...(typeof newKeyIndex === "number" ? { p6_key_index: newKeyIndex } : { p6_key_index: undefined }),
        model: newModel,
        fallback_used: fallbackUsed,
        tier_log: tierLog,
        retried_at: new Date().toISOString(),
        retry_count: Number(meta.retry_count || 0) + 1,
        // Reset auto-resubmit counter so the row gets a fresh full
        // cascade walk on subsequent failures.
        auto_resubmit_count: 0,
        last_retry_error: null,
      },
    })
    .eq("id", row.id);

  return NextResponse.json({
    ok: true,
    history_id: row.id,
    task_id: newTaskId,
  });
}
