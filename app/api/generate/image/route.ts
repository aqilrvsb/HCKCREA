import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { priceFor } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";

// POST /api/generate/image — placeholder-first, hot-path optimized.
//
// Old flow:  getUser (~500-1000ms) → priceAndCheck (~300ms) → Crun (~1-2s)
//            → insert row → return  (~2-3s perceived)
// New flow:  getSession (local, ~5ms) → insert placeholder → return
//            → after() runs priceFor + Crun + row update  (~300-500ms perceived)
//
// Auth is the cookie-local getSession() call (no Supabase API roundtrip).
// Funds check is dropped on the hot path — the dashboard nav gate already
// blocks users with credits below RM1 from reaching the tab, so by the time
// a Generate click reaches us, funds are guaranteed sufficient. priceFor
// runs in after() purely to set the correct cost on the placeholder row
// for accurate deduction at settle time.
//
// If Crun create fails, the row flips to 'failed' with the upstream error.
// pg_cron's 10-min stale cutoff is the final safety net for any orphan rows.

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
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

  // Insert placeholder NOW. task_id + cost both populated in after().
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
      cost: 0, // overwritten with the plan-correct rate by after()
      metadata: {
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

  // Background work — model resolution + plan rate + Crun create_task + row
  // update. All of this runs after the response is sent to the client, on
  // the same Vercel function invocation (Next.js after() keeps it alive).
  // Failure flips the row to 'failed' with the error so the card shows a
  // useful state.
  after(async () => {
    try {
      const [cfg, rate] = await Promise.all([
        getP2Config(),
        priceFor(user.id, "image_generate"),
      ]);
      const modelKey = requestedModel || cfg.imageDefault || "nano-banana-pro";
      const modelId = (cfg.imageModels as any)?.[modelKey] || modelKey;

      const created = await p2CreateTask({
        model: modelId,
        prompt,
        imageUrls,
        aspectRatio,
      });

      const provider = created.provider || "p2";
      if (!created.ok || !created.task_id) {
        await admin
          .from("history")
          .update({
            status: "failed",
            cost: rate,
            error_message: created.error || "P2 create failed",
            metadata: {
              model: modelKey,
              aspectRatio,
              provider,
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
          cost: rate,
          metadata: {
            model: modelKey,
            aspectRatio,
            provider,
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
            aspectRatio,
            upload_status: "failed",
          },
        })
        .eq("id", historyId);
    }
  });

  // Return immediately — placeholder is in the DB, dashboard refresh
  // event will paint the spinner card on the next client poll.
  return NextResponse.json({
    ok: true,
    history_id: historyId,
  });
}
