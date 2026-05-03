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

// Stream a remote URL straight into B2 — avoids buffering whole file in memory.
// Returns the B2 object key on success.
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
  // Read body as a Node Buffer. B2's S3 API rejects multipart chunks
  // smaller than 5 MB, and the AWS SDK was splitting our Uint8Array body
  // into 2 chunks which violated that. Buffer + explicit ContentLength
  // forces a single-PUT upload that B2 accepts.
  const ab = await r.arrayBuffer();
  const body = Buffer.from(ab);

  if (body.length === 0) {
    throw new Error(`Source URL returned 0 bytes: ${opts.url}`);
  }

  await client().send(
    new PutObjectCommand({
      Bucket: opts.bucket || bucketPrivate(),
      Key: opts.key,
      Body: body,
      ContentType: ct,
      ContentLength: body.length,
    })
  );
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

