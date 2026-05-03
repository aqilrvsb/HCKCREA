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
import https from "https";

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

  const reqToSign = new HttpRequest({
    method: "PUT",
    protocol: "https:",
    hostname: host,
    path,
    headers: {
      host,
      "content-length": String(body.length),
      "content-type": ct,
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    },
    body,
  });

  const signedReq = await signer.sign(reqToSign, { unsignableHeaders: new Set() });

  const { status: putStatus, body: putBody } = await new Promise<{
    status: number;
    body: string;
  }>((resolve, reject) => {
    const req = https.request(
      {
        method: "PUT",
        host,
        path,
        headers: signedReq.headers as Record<string, string>,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.end(body);
  });

  if (putStatus < 200 || putStatus >= 300) {
    const sentHeaders = JSON.stringify(signedReq.headers).slice(0, 400);
    throw new Error(
      `B2 PUT failed: HTTP ${putStatus} (body=${body.length}b, host=${host}, headers=${sentHeaders}) ${putBody.slice(0, 200)}`
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

