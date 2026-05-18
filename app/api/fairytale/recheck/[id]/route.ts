import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";

// POST /api/fairytale/recheck/[id]
//
// Recovery path for failed Storytelling merge rows. Verifies whether
// Modal actually produced the merged MP4 (and uploaded it to B2) even
// when the row was marked failed — most commonly because Vercel's
// after() hook timed out or Modal returned 422 AFTER the merge work
// completed. Resubmit would waste 60s+ of Modal compute re-rendering
// what already exists, so this endpoint avoids that by checking B2
// directly.
//
// Flow:
//   1. Fetch the row, verify owner + type=fairytale
//   2. Build the expected B2 key (users/{user_id}/fairytale/{id}.mp4 —
//      same convention Modal's _b2_key_for uses)
//   3. HEAD the object on peninglab-content
//      - File present → update row: status='done', output_url=<public S3>,
//        error_message=null. Recovered.
//      - File absent → return ok=false with "not_found_in_b2" so the
//        client can surface "merge truly failed, click Delete + restart"
//   4. Same idempotent guarantees as settle.ts — safe to call repeatedly

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const B2_CONTENT_BUCKET = process.env.B2_CONTENT_BUCKET || "peninglab-content";

function contentClient(): S3Client {
  // Mirror lib/b2.ts uploadBufferToContent's credential resolution
  // (B2_CONTENT_* preferred, falling back to generic B2_* env vars).
  const endpoint = process.env.B2_CONTENT_ENDPOINT || process.env.B2_ENDPOINT || "";
  const region = process.env.B2_CONTENT_REGION || process.env.B2_REGION || "us-east-005";
  const accessKeyId = process.env.B2_CONTENT_KEY_ID || process.env.B2_KEY_ID || "";
  const secretAccessKey = process.env.B2_CONTENT_APP_KEY || process.env.B2_APP_KEY || "";
  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: false,
  });
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: row, error: fetchErr } = await admin
    .from("history")
    .select("id, user_id, type, status, output_url, error_message, metadata, created_at")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr || !row) {
    return NextResponse.json({ error: "Row not found" }, { status: 404 });
  }
  if (row.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (row.type !== "fairytale") {
    return NextResponse.json(
      { error: `Recheck only applies to Storytelling merged videos (type=fairytale, got type=${row.type})` },
      { status: 400 }
    );
  }
  if (row.status === "done" && row.output_url) {
    // Already recovered — nothing to do.
    return NextResponse.json({
      ok: true,
      already_done: true,
      output_url: row.output_url,
    });
  }

  // ─── PATH 1: ask Modal directly via the new check_render endpoint ───
  //
  // If the row was created via the new start_render flow, its metadata
  // carries a modal_call_id. Modal can tell us authoritatively whether
  // the function call is queued/running/done/failed/expired — no more
  // guessing via "is the file on B2" + age heuristics.
  //
  // This is the path Vercel uses going forward; legacy rows (no
  // modal_call_id) still fall through to the B2 HEAD path below.
  const meta = (row.metadata as Record<string, any>) || {};
  const callId: string | undefined = meta.modal_call_id;
  const modalEndpoint = process.env.MODAL_FAIRYTALE_ENDPOINT || "";
  const checkRenderEndpoint = modalEndpoint.replace(
    /-render-story\.modal\.run/,
    "-check-render.modal.run"
  );
  if (callId && checkRenderEndpoint && checkRenderEndpoint !== modalEndpoint) {
    try {
      const r = await fetch(checkRenderEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: callId }),
      });
      const j: any = await r.json().catch(() => null);
      if (j?.ok) {
        const modalStatus: string = String(j.status || "unknown");
        if (modalStatus === "queued" || modalStatus === "running") {
          return NextResponse.json({
            ok: false,
            found: false,
            reason: "still_rendering",
            message:
              `Modal says: ${modalStatus}. The render is still in progress — ` +
              `the card will auto-update when it finishes. Please wait.`,
            modal_status: modalStatus,
            call_id: callId,
          });
        }
        if (modalStatus === "done") {
          // Modal completed. The impl writes status='done' + output_url
          // to the row directly, but SWR poll might not have refreshed
          // yet — re-read the row to surface the current state.
          const { data: fresh } = await admin
            .from("history")
            .select("status, output_url")
            .eq("id", row.id)
            .maybeSingle();
          return NextResponse.json({
            ok: true,
            recovered: fresh?.status === "done",
            output_url: fresh?.output_url || j.output_url || null,
            modal_status: "done",
            message:
              fresh?.status === "done"
                ? "Modal finished — video is ready."
                : "Modal finished — refreshing the row now, please wait a moment.",
          });
        }
        if (modalStatus === "failed") {
          return NextResponse.json({
            ok: false,
            found: false,
            reason: "modal_failed",
            message:
              `Modal render failed: ${j.error || "unknown error"}. ` +
              `Delete this row and click Merge again.`,
            modal_status: "failed",
            modal_error: j.error,
          });
        }
        if (modalStatus === "expired") {
          // Modal's output retention expired — fall through to the B2
          // HEAD path so we can still recover the file if it was
          // uploaded before retention lapsed.
          // (no early return)
        }
      }
      // Modal check returned !ok or an unknown shape — fall through to
      // B2 HEAD as a safety net. We don't surface the Modal error here
      // because the B2 path may still recover the row.
    } catch (e: any) {
      // Network error reaching Modal — fall through to B2 HEAD.
      console.warn(`[recheck] check_render unreachable for ${row.id}: ${e?.message}`);
    }
  }

  // ─── PATH 2 (fallback): HEAD B2 for the expected key ───
  // For legacy rows (no modal_call_id) OR when check_render is
  // unreachable / returns expired. Same logic as before — file present
  // = recover the row, file absent + recent = "still rendering", file
  // absent + old = real failure.
  // Expected key follows the Modal convention: users/{user_id}/fairytale/{id}.mp4
  const key = `users/${row.user_id}/fairytale/${row.id}.mp4`;
  const client = contentClient();

  let head: any = null;
  try {
    head = await client.send(
      new HeadObjectCommand({ Bucket: B2_CONTENT_BUCKET, Key: key })
    );
  } catch (e: any) {
    // 404 / NotFound = file isn't on B2 (yet).
    //
    // Two possibilities:
    //   • Modal is STILL RENDERING (typical render = 60-180s for a 12-scene
    //     story at 120fps). The file legitimately isn't on B2 yet.
    //   • Modal genuinely failed and the file will never appear.
    //
    // Use row age as a proxy: if the row was created less than 8 minutes ago,
    // assume Modal might still be working and tell the user to wait. After
    // 8 minutes, anything still missing IS a real failure (largest 15-scene
    // stories cap out around 5-6 min render time).
    const status = e?.$metadata?.httpStatusCode || e?.statusCode || 0;
    const code = e?.name || e?.Code || "";
    if (status === 404 || /NotFound|NoSuchKey/i.test(code)) {
      const createdAt = row.created_at ? new Date(row.created_at).getTime() : 0;
      const ageSec = createdAt ? Math.floor((Date.now() - createdAt) / 1000) : 0;
      const STILL_RENDERING_WINDOW_SEC = 8 * 60; // 8 minutes
      if (ageSec > 0 && ageSec < STILL_RENDERING_WINDOW_SEC) {
        const remainingSec = STILL_RENDERING_WINDOW_SEC - ageSec;
        return NextResponse.json({
          ok: false,
          found: false,
          reason: "still_rendering",
          message:
            `Modal is probably still rendering (started ${Math.floor(ageSec / 60)}m ${ageSec % 60}s ago). ` +
            `12-scene stories typically take 2-5 minutes at 120fps. ` +
            `Please wait — the card will auto-update when the video is ready. ` +
            `If nothing happens in ${Math.ceil(remainingSec / 60)} more minutes, click recheck again to confirm the merge truly failed.`,
          age_sec: ageSec,
          checked_key: key,
          bucket: B2_CONTENT_BUCKET,
        });
      }
      return NextResponse.json({
        ok: false,
        found: false,
        reason: "not_found_in_b2",
        message:
          `Merged video is NOT in B2 after ${Math.floor(ageSec / 60)}m ${ageSec % 60}s. ` +
          `Modal merge truly didn't finish. Delete this row and click Merge again.`,
        age_sec: ageSec,
        checked_key: key,
        bucket: B2_CONTENT_BUCKET,
      });
    }
    return NextResponse.json(
      {
        ok: false,
        found: false,
        reason: "b2_error",
        message: `B2 HEAD failed: ${code || status || e?.message || "unknown"}`,
        checked_key: key,
      },
      { status: 502 }
    );
  }

  // File exists on B2 — Modal completed the merge, the row just got
  // stuck in failed state. Build the public URL the same way Modal's
  // _b2_public_s3_url does + recover the row.
  const endpointUrl = new URL(
    process.env.B2_CONTENT_ENDPOINT || process.env.B2_ENDPOINT || ""
  );
  const publicUrl = `https://${B2_CONTENT_BUCKET}.${endpointUrl.host}/${key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

  const sizeBytes = head?.ContentLength || 0;

  // Sanity check — recovered files smaller than 10KB are almost
  // certainly corrupt (a real fairytale MP4 is ≥ a few MB).
  if (sizeBytes > 0 && sizeBytes < 10 * 1024) {
    return NextResponse.json({
      ok: false,
      found: true,
      reason: "file_too_small",
      message: `B2 has the file but only ${sizeBytes} bytes — likely a corrupt upload. Delete + re-merge.`,
      checked_key: key,
      size_bytes: sizeBytes,
    });
  }

  // Recover the row — flip to done + set output_url + clear the error.
  // Preserve existing metadata + tag with recovery info for audit.
  // (Reuses the `meta` already pulled at the top of the function for
  // the Modal call_id check — no need to re-cast.)
  await admin
    .from("history")
    .update({
      status: "done",
      output_url: publicUrl,
      thumbnail_url: publicUrl,
      error_message: null,
      metadata: {
        ...meta,
        recovered_at: new Date().toISOString(),
        recovered_via: "fairytale_recheck",
        recovered_size_bytes: sizeBytes,
      },
    })
    .eq("id", row.id);

  return NextResponse.json({
    ok: true,
    found: true,
    recovered: true,
    output_url: publicUrl,
    size_bytes: sizeBytes,
    checked_key: key,
  });
}
