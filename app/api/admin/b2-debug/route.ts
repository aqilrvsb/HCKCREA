import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadFromUrl, listUserObjects, head, bucketPrivate } from "@/lib/b2";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fingerprint(s: string | undefined): string {
  if (!s) return "MISSING";
  return `${s.slice(0, 4)}…${s.slice(-4)} (len=${s.length})`;
}

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const env = {
    B2_ENDPOINT: fingerprint(process.env.B2_ENDPOINT),
    B2_REGION: fingerprint(process.env.B2_REGION),
    B2_KEY_ID: fingerprint(process.env.B2_KEY_ID),
    B2_APP_KEY: fingerprint(process.env.B2_APP_KEY),
    B2_BUCKET_PRIVATE: fingerprint(process.env.B2_BUCKET_PRIVATE),
  };

  const probes: Record<string, any> = {};

  // 1) ListObjectsV2 — needs listFiles permission
  try {
    const items = await listUserObjects(user.id);
    probes.list_objects = { ok: true, count: items.length };
  } catch (e: any) {
    probes.list_objects = { ok: false, error: e?.message?.slice(0, 200), name: e?.name };
  }

  // 2) HEAD on a non-existent key — needs readFiles permission
  // (404 = read perm OK, 403 = no perm)
  try {
    await head({ key: `users/${user.id}/test/__nonexistent__.png` });
    probes.head_object = { ok: true, note: "exists somehow" };
  } catch (e: any) {
    const status = e?.$metadata?.httpStatusCode;
    probes.head_object = { ok: status === 404, status, error: e?.name };
  }

  // 3) PUT — needs writeFiles permission
  const tinyUrl = "https://upload.wikimedia.org/wikipedia/commons/c/ca/1x1.png";
  try {
    const res = await uploadFromUrl({
      url: tinyUrl,
      key: `users/${user.id}/test/tiny-${Date.now()}.png`,
      contentType: "image/png",
    });
    probes.put_object = { ok: true, ...res };
  } catch (e: any) {
    probes.put_object = { ok: false, error: e?.message?.slice(0, 250) };
  }

  return NextResponse.json({ ok: true, env, bucket: bucketPrivate(), probes });
}
