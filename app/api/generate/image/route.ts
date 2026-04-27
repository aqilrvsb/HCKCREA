import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { priceAndCheck } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";

// POST /api/generate/image — placeholder-first.
//
// Old flow:  pre-check → call Crun (~1-2s) → insert row → return  (~2-3s perceived)
// New flow:  pre-check → insert placeholder → return → after() calls Crun & updates row
//
// User sees the placeholder card the moment Vercel responds (~300ms typical).
// The Crun create_task call happens on the same Vercel function invocation,
// just *after* the response is sent — Next.js `after()` keeps the function
// alive until the work completes.
//
// If Crun create fails, the row is flipped to status='failed' with the upstream
// error so the user sees a useful message on the card instead of forever-spin.
// pg_cron's 10-min stale cutoff is the final safety net for any orphan rows.

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt || "").trim();
  const referenceUrl = body?.reference_url ? String(body.reference_url) : undefined;
  const referenceUrls: string[] = Array.isArray(body?.reference_urls)
    ? body.reference_urls.filter(Boolean).map(String)
    : [];
  const aspectRatio = String(body?.aspect_ratio || "9:16");
  const requestedModel = body?.model ? String(body.model) : null;
  const projectId = body?.project_id ? String(body.project_id) : null;

  if (!prompt) return NextResponse.json({ error: "Prompt required" }, { status: 400 });

  // Pre-flight credit check (sync — must reject before placeholder is shown
  // if user can't afford it, otherwise they'd see a placeholder that fails
  // for a non-actionable reason)
  const { rate: cost, hasFunds } = await priceAndCheck(user.id, "image_generate");
  if (!hasFunds) {
    return NextResponse.json(
      { error: "Kredit tak cukup. Top up dulu." },
      { status: 402 }
    );
  }

  // Resolve model registry (sync — config read is cached, ~1ms)
  const cfg = await getP2Config();
  const modelKey = requestedModel || cfg.imageDefault || "nano-banana-pro";
  const modelId = (cfg.imageModels as any)?.[modelKey] || modelKey;

  // Insert placeholder NOW. task_id stays null until after() fires Crun.
  // poll-pending's Stage-1 query requires task_id IS NOT NULL, so this row
  // won't be re-polled before after() updates it. The 10-min stale cutoff
  // catches it if after() never runs (Vercel kill, exception, etc).
  const admin = createAdminClient();
  const { data: hist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: projectId,
      type: "image",
      tab: "image",
      status: "pending",
      prompt,
      reference_url: referenceUrl,
      task_id: null,
      cost,
      metadata: {
        model: modelKey,
        aspectRatio,
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
  const imageUrls = referenceUrls.length ? referenceUrls : (referenceUrl ? [referenceUrl] : []);

  // Background work — Crun create_task + row update. Runs after the response
  // is sent to the client. Failure here flips the row to 'failed' with the
  // error message so the dashboard card shows a useful state.
  after(async () => {
    try {
      const created = await p2CreateTask({
        model: modelId,
        prompt,
        imageUrls,
        aspectRatio,
      });

      if (!created.ok || !created.task_id) {
        await admin
          .from("history")
          .update({
            status: "failed",
            error_message: created.error || "P2 create failed",
            metadata: {
              model: modelKey,
              aspectRatio,
              upload_status: "failed",
            },
          })
          .eq("id", historyId);
        return;
      }

      await admin
        .from("history")
        .update({
          task_id: created.task_id,
          metadata: {
            model: modelKey,
            aspectRatio,
            upload_status: "done",
          },
        })
        .eq("id", historyId);
    } catch (e: any) {
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: e?.message || "Background error",
          metadata: {
            model: modelKey,
            aspectRatio,
            upload_status: "failed",
          },
        })
        .eq("id", historyId);
    }
  });

  // Return immediately — placeholder is already in the DB, dashboard refresh
  // event will paint the spinner card within ~30s of the next client poll.
  return NextResponse.json({
    ok: true,
    history_id: historyId,
    cost,
  });
}
