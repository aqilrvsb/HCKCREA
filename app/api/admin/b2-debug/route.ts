import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Diagnostic — returns the exact presigned URL we generate so we can
// inspect SignedHeaders and other query params. Admin only.
export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const c = new S3Client({
    region: process.env.B2_REGION || "us-east-005",
    endpoint: process.env.B2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.B2_KEY_ID || "",
      secretAccessKey: process.env.B2_APP_KEY || "",
    },
    forcePathStyle: false,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  const url = await getSignedUrl(
    c,
    new PutObjectCommand({
      Bucket: process.env.B2_BUCKET_PRIVATE || "",
      Key: `users/${user.id}/test/debug.bin`,
    }),
    {
      expiresIn: 300,
      signableHeaders: new Set(["host", "x-amz-content-sha256"]),
    }
  );

  const parsed = new URL(url);
  const params: Record<string, string> = {};
  parsed.searchParams.forEach((v, k) => { params[k] = v; });

  return NextResponse.json({
    ok: true,
    url,
    host: parsed.host,
    path: parsed.pathname,
    queryParams: params,
    signedHeaders: params["X-Amz-SignedHeaders"],
  });
}
