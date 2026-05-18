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
    .select("id, user_id, type, status, output_url, error_message, metadata")
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

  // Expected key follows the Modal convention: users/{user_id}/fairytale/{id}.mp4
  const key = `users/${row.user_id}/fairytale/${row.id}.mp4`;
  const client = contentClient();

  let head: any = null;
  try {
    head = await client.send(
      new HeadObjectCommand({ Bucket: B2_CONTENT_BUCKET, Key: key })
    );
  } catch (e: any) {
    // 404 / NotFound = file isn't on B2 → merge truly failed.
    // Any other error = surface so the user knows recheck itself broke.
    const status = e?.$metadata?.httpStatusCode || e?.statusCode || 0;
    const code = e?.name || e?.Code || "";
    if (status === 404 || /NotFound|NoSuchKey/i.test(code)) {
      return NextResponse.json({
        ok: false,
        found: false,
        reason: "not_found_in_b2",
        message: "Merged video is NOT in B2. Modal merge didn't finish. Delete this row and click Merge again.",
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
  const meta = (row.metadata as Record<string, any>) || {};
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
