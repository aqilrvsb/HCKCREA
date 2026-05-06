// Mirror a provider URL (Crun, fal, RH temp) to the public peninglab-content
// bucket. Used by lib/settle.ts after a generation succeeds, and by the one-shot
// backfill job. Returns the final stable public URL we store in
// history.output_url.
//
// Why a separate file from lib/b2.ts: the existing wrapper is bound to the
// PRIVATE bucket via B2_KEY_ID / B2_APP_KEY / B2_BUCKET_PRIVATE env vars.
// peninglab-content has its OWN scoped key (B2_CONTENT_*) so files written
// to it are world-readable. Keeping the two helpers separate prevents an
// accidental "save the user's private file to the public bucket" mistake.
//
// Env vars (set on Vercel):
//   B2_CONTENT_BUCKET         e.g. peninglab-content
//   B2_CONTENT_KEY_ID         scoped Application Key id (NOT master)
//   B2_CONTENT_APP_KEY        scoped Application Key secret
//   B2_CONTENT_ENDPOINT       e.g. https://s3.us-east-005.backblazeb2.com
//   B2_CONTENT_REGION         e.g. us-east-005
//   B2_CONTENT_PUBLIC_BASE    e.g. https://f005.backblazeb2.com/file/peninglab-content

import { SignatureV4 } from "@smithy/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import { HttpRequest } from "@smithy/protocol-http";
import { NodeHttpHandler } from "@smithy/node-http-handler";

export type ContentType =
  | "image"
  | "video"
  | "ugc"
  | "auto"
  | "cinema"
  | "fairytale"
  | "fairytale-scene"
  | "clone"
  | "seedance";

// Standard layout: users/{userId}/{type}/{historyId}.{ext}
// Same shape as lib/b2.ts buildKey() so the two buckets share path conventions.
export function buildContentKey(opts: {
  userId: string;
  type: ContentType | string;
  historyId: string;
  ext: string;
}): string {
  const ext = opts.ext.replace(/^\./, "").toLowerCase();
  return `users/${opts.userId}/${opts.type}/${opts.historyId}.${ext}`;
}

// Build the public URL for a key in the content bucket. This is what we
// store in history.output_url after a successful mirror.
export function publicUrlForKey(key: string): string {
  const base = process.env.B2_CONTENT_PUBLIC_BASE;
  if (!base) throw new Error("B2_CONTENT_PUBLIC_BASE env var missing");
  return `${base.replace(/\/$/, "")}/${key}`;
}

// Best-effort extension inference. Order: explicit override → URL path → type fallback.
export function inferExt(opts: {
  url: string;
  type: ContentType | string;
  override?: string;
}): string {
  if (opts.override) return opts.override.replace(/^\./, "").toLowerCase();
  try {
    const u = new URL(opts.url);
    const m = u.pathname.match(/\.([a-zA-Z0-9]{1,5})($|\?)/);
    if (m) return m[1].toLowerCase();
  } catch {
    /* fall through */
  }
  if (opts.type === "image" || opts.type === "fairytale-scene") return "png";
  return "mp4";
}

export function contentTypeFromExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "png") return "image/png";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "webp") return "image/webp";
  if (e === "mp4") return "video/mp4";
  if (e === "webm") return "video/webm";
  return "application/octet-stream";
}

// Stream the source URL (provider) → PUT to peninglab-content at `key`.
// Throws on any non-2xx from either side. Returns size in bytes.
export async function mirrorToContentBucket(opts: {
  providerUrl: string;
  key: string;
  contentType: string;
}): Promise<{ key: string; size: number; publicUrl: string }> {
  const endpoint = (process.env.B2_CONTENT_ENDPOINT || "").trim();
  const region = (process.env.B2_CONTENT_REGION || "us-east-005").trim();
  const accessKeyId = (process.env.B2_CONTENT_KEY_ID || "").trim();
  const secretAccessKey = (process.env.B2_CONTENT_APP_KEY || "").trim();
  const bucket = (process.env.B2_CONTENT_BUCKET || "").trim();
  const publicBase = (process.env.B2_CONTENT_PUBLIC_BASE || "").trim();

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !publicBase) {
    throw new Error(
      "mirror-to-b2: env vars missing — set B2_CONTENT_ENDPOINT / B2_CONTENT_KEY_ID / B2_CONTENT_APP_KEY / B2_CONTENT_BUCKET / B2_CONTENT_PUBLIC_BASE"
    );
  }

  // Pull the source bytes
  const r = await fetch(opts.providerUrl);
  if (!r.ok) {
    throw new Error(
      `mirror-to-b2: source fetch failed: HTTP ${r.status} ${opts.providerUrl.slice(0, 80)}`
    );
  }
  const ab = await r.arrayBuffer();
  const body = Buffer.from(ab);
  if (body.length === 0) {
    throw new Error("mirror-to-b2: source returned empty body");
  }

  // PUT to B2 (same SigV4 pattern as lib/b2.ts uploadBuffer — proven to work
  // around Backblaze's "request body too small" rejection of chunked uploads).
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
      "content-type": opts.contentType,
      "x-amz-content-sha256": bodyHash,
    },
    body,
  });

  const signedReq = (await signer.sign(reqToSign, {
    unsignableHeaders: new Set(),
  })) as HttpRequest;

  const handler = new NodeHttpHandler();
  const { response } = await handler.handle(signedReq);

  const respBody: string = await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    response.body.on("data", (c: Buffer) => chunks.push(c));
    response.body.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    response.body.on("error", reject);
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `mirror-to-b2: B2 PUT failed: HTTP ${response.statusCode} ${respBody.slice(0, 200)}`
    );
  }

  return {
    key: opts.key,
    size: body.length,
    publicUrl: publicUrlForKey(opts.key),
  };
}
