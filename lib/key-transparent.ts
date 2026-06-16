"use client";

// Auto-transparency for Livehost templates (Canva free tier can't export a
// transparent PNG, but the live templates use a solid BLACK background).
//
// Method = magic-wand flood-fill from the image borders, the same way you'd
// "select background → delete" in Photoshop/Canva:
//   1. Treat a pixel as background when it's dark AND near-gray (low chroma).
//   2. Flood-fill from all four edges through connected background pixels and
//      make them transparent. Because it's connectivity-based, black elements
//      INSIDE the design (surrounded by colour) are preserved — unlike a flat
//      global threshold.
//   3. Feather the boundary: kept dark-gray pixels touching a transparent
//      pixel get a brightness-proportional alpha, so anti-aliased edges stay
//      smooth instead of jagged.

const MAX_DIM = 2048;

export async function keyBlackToTransparent(input: File): Promise<File> {
  try {
    const bitmap = await loadBitmap(input);
    const w0 = (bitmap as { width: number }).width;
    const h0 = (bitmap as { height: number }).height;
    const scale = Math.max(w0, h0) > MAX_DIM ? MAX_DIM / Math.max(w0, h0) : 1;
    const w = Math.round(w0 * scale);
    const h = Math.round(h0 * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true } as CanvasRenderingContext2DSettings);
    if (!ctx) return input;
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);

    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const N = w * h;

    // Tunables
    const LOW = 16;     // brightness fully transparent
    const BLACK = 74;   // brightness ceiling for "background"
    const CHROMA = 38;  // max channel spread to still count as gray/black

    const isBg = (px: number): boolean => {
      const i = px << 2;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b);
      if (mx >= BLACK) return false;
      return (mx - Math.min(r, g, b)) < CHROMA;
    };

    // Flood-fill from the borders.
    const visited = new Uint8Array(N);
    const stack = new Int32Array(N);
    let sp = 0;
    const push = (px: number) => { if (!visited[px] && isBg(px)) { visited[px] = 1; stack[sp++] = px; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + (w - 1)); }
    while (sp > 0) {
      const px = stack[--sp];
      const x = px % w;
      const y = (px / w) | 0;
      if (x > 0) push(px - 1);
      if (x < w - 1) push(px + 1);
      if (y > 0) push(px - w);
      if (y < h - 1) push(px + w);
    }

    // Apply: background → transparent; feather kept edge pixels.
    for (let px = 0; px < N; px++) {
      const i = px << 2;
      if (visited[px]) { d[i + 3] = 0; continue; }
      const x = px % w;
      const y = (px / w) | 0;
      const edge =
        (x > 0 && visited[px - 1]) ||
        (x < w - 1 && visited[px + 1]) ||
        (y > 0 && visited[px - w]) ||
        (y < h - 1 && visited[px + w]);
      if (!edge) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b);
      if (mx < BLACK && (mx - Math.min(r, g, b)) < CHROMA) {
        const k = Math.max(0, Math.min(1, (mx - LOW) / (BLACK - LOW)));
        d[i + 3] = Math.round(d[i + 3] * k);
      }
    }

    ctx.putImageData(img, 0, 0);
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b2) => (b2 ? resolve(b2) : reject(new Error("toBlob null"))), "image/png")
    );
    const base = (input.name || "template").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.png`, { type: "image/png" });
  } catch {
    return input; // on any failure, fall back to the original file
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file); } catch {}
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode failed")); };
    im.src = url;
  });
}
