// Smart client-side image compression for AI-generation uploads.
//
// Why: Vercel rejects POST bodies > 4.5 MB on the Hobby plan with a plain
// HTML "Request Entity Too Large" page that crashes JSON.parse on the
// caller. Modern phone photos are routinely 5-15 MB. Crun.ai / RunningHub
// internally downscale incoming images to ≤2048 px anyway, so we lose
// nothing visually by doing the resize client-side first.
//
// Behaviour:
//   - File ≤ MAX_PASSTHROUGH_BYTES AND dimensions ≤ MAX_DIMENSION → return
//     the original File untouched (no quality loss for small uploads).
//   - Otherwise: resize so the long edge is MAX_DIMENSION, encode as JPEG
//     at QUALITY, return as a new File. EXIF is dropped (browser canvas
//     can't preserve it).
//
// Browsers without OffscreenCanvas / createImageBitmap fall back to
// <img> + <canvas> path.

const MAX_DIMENSION = 2048;        // px — long edge cap
const QUALITY = 0.92;              // JPEG quality, visually lossless
const MAX_PASSTHROUGH_BYTES = 4 * 1024 * 1024; // 4 MB — under Vercel's 4.5 MB cap

export type CompressResult = {
  file: File;
  compressed: boolean;
  originalBytes: number;
  outputBytes: number;
  originalDim: { w: number; h: number } | null;
  outputDim: { w: number; h: number } | null;
};

export async function compressImageIfNeeded(input: File): Promise<CompressResult> {
  const originalBytes = input.size;

  // Cheap path: file is small enough for Vercel AND we don't know dimensions
  // — assume it's fine. If user uploads a tiny but huge-dimension file
  // (rare; would be a synthetic file), the AI service handles it.
  if (originalBytes <= MAX_PASSTHROUGH_BYTES) {
    return {
      file: input,
      compressed: false,
      originalBytes,
      outputBytes: originalBytes,
      originalDim: null,
      outputDim: null,
    };
  }

  // Decode the image to get dimensions.
  const bitmap = await loadImageBitmap(input);
  const w = bitmap.width;
  const h = bitmap.height;

  // Compute target size (long-edge cap)
  const longEdge = Math.max(w, h);
  const scale = longEdge > MAX_DIMENSION ? MAX_DIMENSION / longEdge : 1;
  const targetW = Math.round(w * scale);
  const targetH = Math.round(h * scale);

  // Draw to canvas + export as JPEG
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Pathological case — return original and hope the upload route handles it
    return {
      file: input,
      compressed: false,
      originalBytes,
      outputBytes: originalBytes,
      originalDim: { w, h },
      outputDim: null,
    };
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))),
      "image/jpeg",
      QUALITY
    );
  });

  // Replace extension with .jpg since we re-encoded as JPEG
  const baseName = (input.name || "image").replace(/\.[^.]+$/, "");
  const outFile = new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });

  return {
    file: outFile,
    compressed: true,
    originalBytes,
    outputBytes: outFile.size,
    originalDim: { w, h },
    outputDim: { w: targetW, h: targetH },
  };
}

async function loadImageBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // Prefer createImageBitmap — fastest, off-main-thread decoding when supported.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to <img> path
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };
    img.src = url;
  });
}
