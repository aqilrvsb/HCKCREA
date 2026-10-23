"use client";

// The client's own B-roll (a photo or a short video) → our storage: a signed Modal upload to B2
// (/api/motion/upload-url), so it never depends on a third-party host. Progress 0–100.
// from "clipper": checked against the CLIPPER tab (videos go to clipper-uploads/); "motion": the Motion tab.
export async function uploadOwn(f: File, onPct: (n: number) => void, from: "clipper" | "motion" = "clipper"): Promise<{ url: string; video: boolean }> {
  const video = /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name);
  const image = /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);
  if (!video && !image) throw new Error("Pilih gambar (JPG / PNG / WEBP) atau video (MP4 / MOV / WEBM).");
  if (image && f.size > 12 * 1024 * 1024) throw new Error("Gambar terlalu besar (maks 12MB).");
  if (video && f.size > 200 * 1024 * 1024) throw new Error("Video B-roll terlalu besar (maks 200MB) — beberapa saat sudah cukup.");
  const r = await fetch("/api/motion/upload-url", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: f.name, size: f.size, kind: video ? (from === "clipper" ? "clip" : "video") : "image", from }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d?.upload_url) throw new Error(d?.error || "Tak dapat link upload");
  const url = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", d.upload_url);
    xhr.setRequestHeader("Content-Type", f.type || (video ? "video/mp4" : "image/jpeg"));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300 && j?.url) resolve(String(j.url));
        else reject(new Error(j?.error || `Upload gagal (${xhr.status})`));
      } catch { reject(new Error(`Upload gagal (${xhr.status})`)); }
    };
    xhr.onerror = () => reject(new Error("Upload gagal — semak sambungan internet."));
    xhr.send(f);
  });
  return { url, video };
}
