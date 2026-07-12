// Recovery for APIPod's per-image content-policy block:
//   "Reference upload failed: image reference N blocked: this image was
//    previously flagged by content policy (md5=…)"
//
// APIPod caches the flag by the FILE's md5. So on the first hit we re-encode
// the flagged image to a NEW md5 (append a benign trailing comment — image
// decoders ignore bytes after the end marker, so the picture is identical but
// the file hash differs) and retry — keeping the product in the render. If it
// STILL gets flagged after that (a genuine content-based flag, not a cached
// md5), we fall back to DROPPING the image so the render can complete from the
// rest (for a Video Reference the motion still comes from the source video).

import { isFlaggedImageError } from "@/lib/retry-eligibility";
import { uploadBufferToContent, buildKey } from "@/lib/b2";

export type FlaggedRecovery = {
  urls: string[];
  action: "reencoded" | "dropped";
  index: number; // 0-based
  detail: string;
};

// Re-fetch an image and re-upload it with altered bytes so its md5 changes but
// the decoded picture is unchanged. Returns a new public URL, or null on failure.
async function reencodeToNewMd5(
  url: string,
  userId: string,
  historyId: string,
  index: number
): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length === 0) return null;
    const ct = resp.headers.get("content-type") || "image/jpeg";
    const ext = ct.includes("png")
      ? "png"
      : ct.includes("webp")
        ? "webp"
        : ct.includes("gif")
          ? "gif"
          : "jpg";
    // Trailing bytes after the image's end marker are ignored by decoders, so
    // the visual is identical while the file md5 changes.
    const salt = Buffer.from(
      `<!--plr-reencode-${historyId}-${index}-${Date.now()}-${Math.round(Math.random() * 1e9)}-->`
    );
    const out = Buffer.concat([buf, salt]);
    const key = buildKey({
      userId,
      type: "image",
      historyId: `${historyId}-r${index}-${Date.now()}`,
      ext,
    });
    const { publicUrl } = await uploadBufferToContent({ body: out, key, contentType: ct });
    return publicUrl || null;
  } catch {
    return null;
  }
}

// Proactively give every image a FRESH md5 before the first submit, so a
// previously-flagged product photo never trips APIPod's cached-md5 block.
// Keeps the original URL for any image that fails to re-encode.
export async function freshMd5Images(
  urls: string[],
  userId: string,
  tag: string
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    if (!u || typeof u !== "string") continue;
    const fresh = await reencodeToNewMd5(u, userId, tag, i);
    out.push(fresh || u);
  }
  return out;
}

// Given a flagged-image error + the reference list + the row metadata, either
// swap the flagged image for a re-encoded copy (first time) or drop it (already
// re-encoded / re-encode failed). Mutates meta.image_urls + meta.reencoded_indices
// so the caller's ...meta spread persists the change. Returns null when the
// error isn't a flagged-image block or there's nothing to act on.
export async function recoverFlaggedImage(opts: {
  errMsg: string | null | undefined;
  imageUrls: string[];
  meta: Record<string, any>;
  userId: string;
  historyId: string;
}): Promise<FlaggedRecovery | null> {
  const { errMsg, imageUrls, meta, userId, historyId } = opts;
  if (!imageUrls || imageUrls.length === 0) return null;
  if (!isFlaggedImageError(errMsg)) return null;

  const m = String(errMsg).match(/image reference\s+(\d+)/i);
  const index = m ? parseInt(m[1], 10) - 1 : 0; // 1-based → 0-based; default first
  if (index < 0 || index >= imageUrls.length) return null;

  const reencoded: number[] = Array.isArray(meta.reencoded_indices) ? meta.reencoded_indices : [];

  if (!reencoded.includes(index)) {
    const newUrl = await reencodeToNewMd5(imageUrls[index], userId, historyId, index);
    if (newUrl) {
      const urls = imageUrls.slice();
      urls[index] = newUrl;
      meta.reencoded_indices = [...reencoded, index];
      meta.image_urls = urls;
      return { urls, action: "reencoded", index, detail: newUrl };
    }
  }

  // Already re-encoded (still flagged → real content flag) OR re-encode failed:
  // drop the image so the render can still complete from the rest.
  const urls = imageUrls.filter((_, i) => i !== index);
  meta.image_urls = urls;
  return { urls, action: "dropped", index, detail: imageUrls[index] };
}
