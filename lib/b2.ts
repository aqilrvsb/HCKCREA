// Backblaze B2 client (S3-compatible API).
// Used by /api/storage/* routes to copy temp Crun URLs into the user's
// permanent storage folder, and by the storage list/delete endpoints.
//
// Env vars (set in Vercel + Modal secrets):
//   B2_ENDPOINT                 e.g. https://s3.us-east-005.backblazeb2.com
//   B2_REGION                   e.g. us-east-005
//   B2_KEY_ID                   the SCOPED Application Key id (NOT master)
//   B2_APP_KEY                  the application key secret
//   B2_BUCKET_PRIVATE           e.g. peninglab-storage
//   B2_BUCKET_PUBLIC            e.g. peninglab-fairytale-public (optional)

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  const endpoint = process.env.B2_ENDPOINT;
  const region = process.env.B2_REGION || "us-east-005";
  const accessKeyId = process.env.B2_KEY_ID;
  const secretAccessKey = process.env.B2_APP_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("B2 not configured — set B2_ENDPOINT / B2_KEY_ID / B2_APP_KEY env vars");
  }
  _client = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: false,
    // AWS SDK v3.729+ defaults to flexible checksums (CRC32) which use
    // STREAMING-AWS4-HMAC-SHA256-PAYLOAD + chunked transfer encoding.
    // Backblaze B2 rejects that with "The request body was too small".
    // Force WHEN_REQUIRED so we send a plain PUT with Content-Length.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return _client;
}

export type StorageType = "image" | "video" | "ugc" | "auto" | "cinema" | "fairytale" | "fairytale-scene" | "clone" | "seedance";

// Standard layout: users/{user_id}/{type}/{history_id}.{ext}
export function buildKey(opts: {
  userId: string;
  type: StorageType;
  historyId: string;
  ext: string; // mp4 / png / jpg / wav etc.
}): string {
  const ext = opts.ext.replace(/^\./, "").toLowerCase();
  return `users/${opts.userId}/${opts.type}/${opts.historyId}.${ext}`;
}

export function bucketPrivate(): string {
  const b = process.env.B2_BUCKET_PRIVATE;
  if (!b) throw new Error("B2_BUCKET_PRIVATE env var missing");
  return b;
}

// Upload a remote URL into B2.
//
// We use a presigned PUT + plain fetch(), NOT s3.send(PutObjectCommand).
// AWS SDK v3 (any flavor) signs the PUT with x-amz-content-sha256 =
// STREAMING-AWS4-HMAC-SHA256-PAYLOAD, which makes the request body a
// chunked, per-chunk-signed stream. Backblaze B2 rejects that with
// "The request body was too small" no matter what flexible-checksum
// flags we pass to S3Client. A presigned URL signs a single, fixed-length
// payload, so the actual upload is a vanilla single-shot HTTP PUT — and
// B2 accepts it cleanly.
export async function uploadFromUrl(opts: {
  url: string;
  key: string;
  contentType?: string;
  bucket?: string;
}): Promise<{ key: string; size: number }> {
  const r = await fetch(opts.url);
  if (!r.ok) {
    throw new Error(`Source URL fetch failed: HTTP ${r.status}`);
  }
  const ct = opts.contentType || r.headers.get("content-type") || "application/octet-stream";
  const ab = await r.arrayBuffer();
  const body = Buffer.from(ab);

  if (body.length === 0) {
    throw new Error(`Source URL returned 0 bytes: ${opts.url}`);
  }

  const bucket = opts.bucket || bucketPrivate();

  // Don't include ContentType in the signed command — that would force the
  // actual PUT to send the exact same header. We send Content-Type at upload
  // time as an unsigned header; B2 still stores it correctly.
  const presignedPut = await getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: bucket,
      Key: opts.key,
    }),
    { expiresIn: 300 }
  );

  // The SDK signs the URL assuming x-amz-content-sha256: UNSIGNED-PAYLOAD.
  // We must echo that header on the wire — without it B2 hashes the body
  // and the signature check fails with SignatureDoesNotMatch.
  const putResp = await fetch(presignedPut, {
    method: "PUT",
    headers: {
      "Content-Type": ct,
      "Content-Length": String(body.length),
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    },
    body,
  });

  if (!putResp.ok) {
    const errText = await putResp.text().catch(() => "");
    throw new Error(
      `B2 PUT failed: HTTP ${putResp.status} ${errText.slice(0, 300)}`
    );
  }

  return { key: opts.key, size: body.length };
}

// Generate a presigned GET URL — defaults to 7 days.
// Frontend caches this; refreshes via /api/storage/refresh-url when expired.
export async function signedGetUrl(opts: {
  key: string;
  bucket?: string;
  expiresInSec?: number;
}): Promise<string> {
  return await getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: opts.bucket || bucketPrivate(),
      Key: opts.key,
    }),
    { expiresIn: opts.expiresInSec || 60 * 60 * 24 * 7 }
  );
}

// HEAD to confirm the file exists + get size + content type
export async function head(opts: { key: string; bucket?: string }) {
  return await client().send(
    new HeadObjectCommand({ Bucket: opts.bucket || bucketPrivate(), Key: opts.key })
  );
}

export async function deleteObject(opts: { key: string; bucket?: string }): Promise<void> {
  await client().send(
    new DeleteObjectCommand({ Bucket: opts.bucket || bucketPrivate(), Key: opts.key })
  );
}

// List ALL objects under a user's prefix — used by /api/storage/list.
// B2 paginates at 1000 per response; we stitch.
export async function listUserObjects(userId: string, type?: StorageType): Promise<{
  key: string;
  size: number;
  lastModified?: Date;
}[]> {
  const prefix = type ? `users/${userId}/${type}/` : `users/${userId}/`;
  const out: { key: string; size: number; lastModified?: Date }[] = [];
  let continuationToken: string | undefined;
  do {
    const r = await client().send(
      new ListObjectsV2Command({
        Bucket: bucketPrivate(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of r.Contents || []) {
      if (obj.Key) {
        out.push({
          key: obj.Key,
          size: obj.Size || 0,
          lastModified: obj.LastModified,
        });
      }
    }
    continuationToken = r.NextContinuationToken;
  } while (continuationToken);
  return out;
}

