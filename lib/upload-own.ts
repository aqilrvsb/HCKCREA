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
  // every try gets its own link: the Modal accounts take turns, and a retry skips the one that just failed
  // (network drop, 5xx, 404 = a switched-off workspace); up to 3 tries
  let failedHost = "";
  const once = async (): Promise<string> => {
    const r = await fetch("/api/motion/upload-url", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: f.name, size: f.size, kind: video ? (from === "clipper" ? "clip" : "video") : "image", from, avoid: failedHost || undefined }),
    }).catch(() => { throw Object.assign(new Error("Upload gagal — semak sambungan internet."), { retry: true }); });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d?.upload_url) throw Object.assign(new Error(d?.error || "Tak dapat link upload"), { retry: r.status >= 500 });
    const host = (() => { try { return new URL(d.upload_url).host; } catch { return ""; } })();
    return new Promise<string>((resolve, reject) => {
      const fail = (msg: string, retry: boolean) => { failedHost = host; reject(Object.assign(new Error(msg), { retry })); };
      const xhr = new XMLHttpRequest();
      xhr.open("POST", d.upload_url);
      xhr.setRequestHeader("Content-Type", f.type || (video ? "video/mp4" : "image/jpeg"));
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => {
        const retry = xhr.status >= 500 || xhr.status === 404;
        try {
          const j = JSON.parse(xhr.responseText || "{}");
          if (xhr.status >= 200 && xhr.status < 300 && j?.url) resolve(String(j.url));
          else fail(j?.error || `Upload gagal (${xhr.status})`, retry);
        } catch { fail(`Upload gagal (${xhr.status})`, retry); }
      };
      xhr.onerror = () => fail("Upload gagal — semak sambungan internet.", true);
      xhr.send(f);
    });
  };
  for (let k = 1; ; k++) {
    try {
      return { url: await once(), video };
    } catch (e: unknown) {
      if (k >= 3 || !(e as { retry?: boolean })?.retry) throw e;
      await new Promise((res) => setTimeout(res, 1500 * k));
    }
  }
}
