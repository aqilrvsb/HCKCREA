"use client";

// Auto-transparency for Livehost templates. Canva's FREE tier can't export a
// transparent PNG, but those live templates use a solid BLACK background — so
// we key out the black (make near-black, achromatic pixels transparent) in the
// browser before upload. Colored design elements (badges, products, gold text)
// keep their colour because they have chroma; only the gray/black backdrop and
// its soft edges go transparent.

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
    const ctx = canvas.getContext("2d");
    if (!ctx) return input;
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);

    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    // Tunables: a pixel is "background" when it's dark AND near-gray (low
    // chroma). LOW→full transparent, ramp to BLACK→keep.
    const LOW = 18;       // <= this brightness → fully transparent
    const BLACK = 64;     // >= this brightness → kept (start of design)
    const CHROMA = 30;    // max channel spread to still count as gray/black
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx - mn < CHROMA) {
        if (mx <= LOW) d[i + 3] = 0;
        else if (mx < BLACK) d[i + 3] = Math.round(((mx - LOW) / (BLACK - LOW)) * d[i + 3]);
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
