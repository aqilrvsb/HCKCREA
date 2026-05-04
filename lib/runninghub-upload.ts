import { getRunningHubConfig } from "@/lib/settings";

// Server-side helper for re-hosting an image on RunningHub. Used by:
//   - /api/upload/image (browser → RH passthrough)
//   - /api/extend/video (re-host stale product image refs at extend time
//     so Crun's seg-2 fetch always succeeds, even when the source row's
//     reference_url has expired Tencent q-sign signatures)
//
// Returns the fresh RH download_url. Throws on any failure — caller decides
// whether to fall back or surface the error.

export async function uploadBlobToRunningHub(
  blob: Blob,
  contentType: string,
  filename = "image.png"
): Promise<string> {
  const cfg = await getRunningHubConfig();
  if (!cfg.key || !cfg.uploadUrl) {
    throw new Error("RunningHub not configured (hc_rh_key / hc_rh_upload missing)");
  }

  const fd = new FormData();
  fd.append("file", blob, filename);

  const res = await fetch(cfg.uploadUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.key}` },
    body: fd,
  });
  const text = await res.text();
  let rhJson: any;
  try {
    rhJson = JSON.parse(text);
  } catch {
    throw new Error(`RunningHub returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(
      `RunningHub HTTP ${res.status}: ${rhJson?.message || rhJson?.error || "unknown"}`
    );
  }
  if (rhJson?.code !== 0 && rhJson?.code !== 200) {
    throw new Error(`RunningHub error: ${rhJson?.message || "unknown"}`);
  }
  const url =
    rhJson?.data?.download_url ||
    rhJson?.data?.url ||
    rhJson?.data?.fileUrl ||
    rhJson?.data?.file_url ||
    null;
  if (!url) throw new Error("RunningHub returned no download URL");
  return String(url);
}

// Convenience wrapper: fetch a remote image URL, then re-upload its bytes
// to RunningHub. Used by extend to rehost stale product images. Returns
// null on any failure (download or upload) — caller falls back gracefully.
export async function rehostUrlOnRunningHub(
  url: string
): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) {
      console.warn(
        `[runninghub-upload] source fetch failed: ${url.slice(0, 80)} → HTTP ${r.status}`
      );
      return null;
    }
    const blob = await r.blob();
    const contentType = blob.type || r.headers.get("content-type") || "image/png";
    if (blob.size === 0) {
      console.warn("[runninghub-upload] source returned 0 bytes");
      return null;
    }
    const ext = contentType.split("/")[1] || "png";
    return await uploadBlobToRunningHub(blob, contentType, `rehost.${ext}`);
  } catch (e: any) {
    console.warn(`[runninghub-upload] rehost threw: ${e?.message || e}`);
    return null;
  }
}
