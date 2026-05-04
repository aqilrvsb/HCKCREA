// Single entry point every tab (UGC / Image / Auto Content / Cinema /
// Clone) uses to send a user-picked image to RunningHub via our
// /api/upload/image proxy. Wraps two concerns the tabs were re-doing
// (and getting wrong) on their own:
//
//   1. Smart compression — Vercel rejects POST bodies > 4.5 MB with a
//      plain-text "Request Entity Too Large" page that crashes
//      JSON.parse on the caller. compressImageIfNeeded() resizes any
//      file > 4 MB down to 2048 px / JPEG q=0.92 first.
//   2. Non-JSON-error guard — if the response isn't JSON (which still
//      happens for some Vercel platform errors), surface a friendly
//      "Upload failed: <status>" message instead of the cryptic
//      "Unexpected token 'R', \"Request En\"...".

import { compressImageIfNeeded } from "@/lib/compress-image";

export type UploadImageResult = {
  url: string;
  compressed: boolean;
  originalBytes: number;
  outputBytes: number;
};

export async function uploadImage(file: File): Promise<UploadImageResult> {
  const compressed = await compressImageIfNeeded(file);

  const fd = new FormData();
  fd.append("file", compressed.file, compressed.file.name);

  const r = await fetch("/api/upload/image", {
    method: "POST",
    body: fd,
    credentials: "include",
  });

  // Read as text first so we can degrade gracefully when the server
  // returns plain HTML (Vercel platform errors do this).
  const text = await r.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON — almost always a Vercel platform error page
  }

  if (!r.ok || !parsed?.url) {
    const msg =
      parsed?.error ||
      (r.status === 413
        ? "Image too large for the server. Try a smaller file."
        : `Upload failed (HTTP ${r.status})`);
    throw new Error(msg);
  }

  return {
    url: parsed.url as string,
    compressed: compressed.compressed,
    originalBytes: compressed.originalBytes,
    outputBytes: compressed.outputBytes,
  };
}

// Convenience: convert a data: URL back to a File so existing tab code
// that stores previews as data URLs can still call uploadImage().
export async function dataUrlToFile(
  dataUrl: string,
  filename = "upload.png"
): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], filename, { type: blob.type || "image/png" });
}

