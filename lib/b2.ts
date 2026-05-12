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
import { SignatureV4 } from "@smithy/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import { HttpRequest } from "@smithy/protocol-http";
import { NodeHttpHandler } from "@smithy/node-http-handler";

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

// Use the SDK's own SignatureV4 signer (same one HEAD/GET/LIST/DELETE
// use successfully) — but apply it to a hand-constructed PUT request
// and send it via Node's raw https module. This bypasses the SDK's
// PutObject middleware chain that was forcing chunked upload encoding
// (which B2 rejects with "The request body was too small").

// PUT a Buffer to B2 at the given key. Returns { key, size }.
export async function uploadBuffer(opts: {
  body: Buffer;
  key: string;
  contentType?: string;
  bucket?: string;
}): Promise<{ key: string; size: number }> {
  const body = opts.body;
  const ct = opts.contentType || "application/octet-stream";

  if (body.length === 0) {
    throw new Error("uploadBuffer: body is empty");
  }

  const endpoint = (process.env.B2_ENDPOINT || "").trim();
  const region = (process.env.B2_REGION || "us-east-005").trim();
  const accessKeyId = (process.env.B2_KEY_ID || "").trim();
  const secretAccessKey = (process.env.B2_APP_KEY || "").trim();
  const bucket = opts.bucket || bucketPrivate();

  const endpointUrl = new URL(endpoint);
  const host = `${bucket}.${endpointUrl.host}`;
  const path = "/" + opts.key.split("/").map(encodeURIComponent).join("/");

  const signer = new SignatureV4({
    credentials: { accessKeyId, secretAccessKey },
    region,
    service: "s3",
    sha256: Sha256,
    applyChecksum: false,
  });

  const { createHash } = await import("crypto");
  const bodyHash = createHash("sha256").update(body).digest("hex");

  const reqToSign = new HttpRequest({
    method: "PUT",
    protocol: "https:",
    hostname: host,
    path,
    headers: {
      host,
      "content-length": String(body.length),
      "content-type": ct,
      "x-amz-content-sha256": bodyHash,
    },
    body,
  });

  const signedReq = (await signer.sign(reqToSign, { unsignableHeaders: new Set() })) as HttpRequest;

  const handler = new NodeHttpHandler();
  const { response } = await handler.handle(signedReq);

  const respBody: string = await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    response.body.on("data", (c: Buffer) => chunks.push(c));
    response.body.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    response.body.on("error", reject);
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`B2 PUT failed: HTTP ${response.statusCode} ${respBody.slice(0, 200)}`);
  }

  return { key: opts.key, size: body.length };
}

// Variant of uploadBuffer that uses the SEPARATE peninglab-content
// credentials (B2_CONTENT_KEY_ID / B2_CONTENT_APP_KEY / etc.). These
// are scoped to write only to peninglab-content, so they're safer to
// expose if a scoped key ever leaks. Set by the previous auto-mirror
// plan and still in Vercel env vars.
// 30 days = 2592000s. Matches the B2 lifecycle rule on peninglab-content.
// `immutable` tells browsers "never revalidate" so even a force-reload
// hits the disk cache. Verified via Playwright: with this header, warm
// fetch is ~30ms vs ~900ms without it.
const CONTENT_CACHE_CONTROL = "public, max-age=2592000, immutable";

export async function uploadBufferToContent(opts: {
  body: Buffer;
  key: string;
  contentType?: string;
}): Promise<{ key: string; size: number; publicUrl: string }> {
  const body = opts.body;
  const ct = opts.contentType || "application/octet-stream";

  if (body.length === 0) {
    throw new Error("uploadBufferToContent: body is empty");
  }

  const endpoint = (process.env.B2_CONTENT_ENDPOINT || process.env.B2_ENDPOINT || "").trim();
  const region = (process.env.B2_CONTENT_REGION || process.env.B2_REGION || "us-east-005").trim();
  const accessKeyId = (process.env.B2_CONTENT_KEY_ID || "").trim();
  const secretAccessKey = (process.env.B2_CONTENT_APP_KEY || "").trim();
  const bucket = (process.env.B2_CONTENT_BUCKET || "peninglab-content").trim();

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "B2_CONTENT_* env vars missing — set B2_CONTENT_ENDPOINT / B2_CONTENT_KEY_ID / B2_CONTENT_APP_KEY"
    );
  }

  const endpointUrl = new URL(endpoint);
  const host = `${bucket}.${endpointUrl.host}`;
  const path = "/" + opts.key.split("/").map(encodeURIComponent).join("/");

  const signer = new SignatureV4({
    credentials: { accessKeyId, secretAccessKey },
    region,
    service: "s3",
    sha256: Sha256,
    applyChecksum: false,
  });

  const { createHash } = await import("crypto");
  const bodyHash = createHash("sha256").update(body).digest("hex");

  const reqToSign = new HttpRequest({
    method: "PUT",
    protocol: "https:",
    hostname: host,
    path,
    headers: {
      host,
      "content-length": String(body.length),
      "content-type": ct,
      // Persisted as object metadata. B2 (S3-compatible) honors this
      // on uploads — every GET response gets the same value back.
      "cache-control": CONTENT_CACHE_CONTROL,
      "x-amz-content-sha256": bodyHash,
    },
    body,
  });

  const signedReq = (await signer.sign(reqToSign, { unsignableHeaders: new Set() })) as HttpRequest;

  const handler = new NodeHttpHandler();
  const { response } = await handler.handle(signedReq);

  const respBody: string = await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    response.body.on("data", (c: Buffer) => chunks.push(c));
    response.body.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    response.body.on("error", reject);
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`B2 content PUT failed: HTTP ${response.statusCode} ${respBody.slice(0, 200)}`);
  }

  // Always return the S3-style URL — verified ~30ms warm fetch vs ~900ms
  // for the f005.backblazeb2.com friendly-URL format. Ignores
  // B2_CONTENT_PUBLIC_BASE env var because it's set to the slow format
  // from the prior attempt.
  const publicUrl = `https://${bucket}.${endpointUrl.host}/${opts.key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

  return { key: opts.key, size: body.length, publicUrl };
}

// Fetch any URL and upload its body to the peninglab-content bucket.
export async function uploadFromUrlToContent(opts: {
  url: string;
  key: string;
  contentType?: string;
}): Promise<{ key: string; size: number; publicUrl: string }> {
  const r = await fetch(opts.url);
  if (!r.ok) {
    throw new Error(`Source URL fetch failed: HTTP ${r.status}`);
  }
  const ct = opts.contentType || r.headers.get("content-type") || "application/octet-stream";
  const ab = await r.arrayBuffer();
  const body = Buffer.from(ab);
  return uploadBufferToContent({ body, key: opts.key, contentType: ct });
}

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
  return uploadBuffer({ body, key: opts.key, contentType: ct, bucket: opts.bucket });
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

