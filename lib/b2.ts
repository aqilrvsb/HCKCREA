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
import crypto from "crypto";
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

// Manual SigV4 PUT — no AWS SDK upload path. The SDK's PutObject signs
// with STREAMING-AWS4-HMAC-SHA256-PAYLOAD on Vercel's runtime regardless
// of requestChecksumCalculation, and B2 rejects chunked uploads with
// "The request body was too small". We sign and PUT manually so we
// control exactly what goes on the wire: a single-shot PUT with the
// actual sha256 of the body in x-amz-content-sha256 (signed). This is
// the canonical AWS Signature V4 spec, and B2 accepts it.
function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}
function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
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

  if (body.length === 0) {
    throw new Error(`Source URL returned 0 bytes: ${opts.url}`);
  }

  const endpoint = (process.env.B2_ENDPOINT || "").trim();
  const region = (process.env.B2_REGION || "us-east-005").trim();
  const accessKeyId = (process.env.B2_KEY_ID || "").trim();
  const secretAccessKey = (process.env.B2_APP_KEY || "").trim();
  const bucket = opts.bucket || bucketPrivate();

  const endpointUrl = new URL(endpoint);
  // Virtual-hosted style: bucket.s3.region.backblazeb2.com
  const host = `${bucket}.${endpointUrl.host}`;
  // Encode each segment of the key per RFC 3986 (slashes preserved).
  const canonicalUri =
    "/" + opts.key.split("/").map(encodeURIComponent).join("/");

  const now = new Date();
  const amzDate =
    now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);             // YYYYMMDD

  // Use UNSIGNED-PAYLOAD instead of sha256(body) — B2 accepts this and
  // it sidesteps any body-byte mismatch issues. The actual body integrity
  // is still protected by HTTPS + Content-Length.
  const payloadHash = "UNSIGNED-PAYLOAD";

  // Sign only host + x-amz-* — the minimum SigV4 requires. content-length
  // and content-type can be munged by intermediaries (Vercel, undici) on
  // the wire, which would invalidate the signature even though we set
  // them correctly. Skip them entirely from signing.
  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders =
    Object.keys(headers)
      .sort()
      .map((k) => `${k}:${headers[k].trim()}`)
      .join("\n") + "\n";

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "", // query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac("AWS4" + secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto
    .createHmac("sha256", kSigning)
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // Use Node's https module directly. Vercel's undici fetch was sending
  // chunked transfer encoding regardless of our explicit Content-Length,
  // and B2 saw the body as smaller than expected. Node's raw https.request
  // honors Content-Length and sends a single fixed-length body.
  const { status: putStatus, body: putBody } = await new Promise<{
    status: number;
    body: string;
  }>((resolve, reject) => {
    const req = https.request(
      {
        method: "PUT",
        host,
        path: canonicalUri,
        headers: {
          "Content-Type": ct,
          "Content-Length": body.length,
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": amzDate,
          Authorization: authorization,
          Host: host,
        },
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
    // end(buffer) writes + closes atomically — avoids any backpressure
    // edge case where req.end() races ahead of the buffered write.
    req.end(body);
  });

  if (putStatus < 200 || putStatus >= 300) {
    // Dump enough to debug: the canonical request and signature.
    const canonReqB64 = Buffer.from(canonicalRequest).toString("base64").slice(0, 400);
    throw new Error(
      `B2 PUT failed: HTTP ${putStatus} (body=${body.length}b, sha=${payloadHash.slice(0, 12)}, sig=${signature.slice(0, 12)}, host=${host}, sH=${signedHeaders}, canonB64=${canonReqB64}) ${putBody.slice(0, 200)}`
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

