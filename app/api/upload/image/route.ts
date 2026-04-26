import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRunningHubConfig } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/upload/image
// Forwards the user's reference image to RunningHub's binary upload endpoint
// and returns the public download_url RunningHub gives back. That URL is
// what we then pass to Crun.ai as img_urls. Mirrors the creative-hack-auto
// extension's rhUploadImage() flow exactly.
//
// Why server-side proxy (not direct browser → RunningHub)?
//   - Keeps the RH API key out of the browser (key lives in app_settings).
//   - One place to enforce file size + type limits.
//   - Auth gates so only signed-in users burn quota.
//
// Accepts multipart/form-data with field 'file' (Blob). Returns { url }.

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function POST(req: Request) {
  // Auth — only signed-in users can upload
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Parse incoming file
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 }
    );
  }

  let blob: Blob;
  let contentType: string;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No file" }, { status: 400 });
    }
    contentType = file.type || "image/png";
    if (!ALLOWED_TYPES.includes(contentType)) {
      return NextResponse.json(
        { error: `Unsupported type: ${contentType}` },
        { status: 415 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 12MB)" }, { status: 413 });
    }
    blob = file;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Read failed" }, { status: 400 });
  }

  // Forward to RunningHub
  const cfg = await getRunningHubConfig();
  if (!cfg.key || !cfg.uploadUrl) {
    return NextResponse.json(
      { error: "RunningHub not configured (hc_rh_key / hc_rh_upload missing)" },
      { status: 500 }
    );
  }

  const ext = contentType.split("/")[1] || "png";
  const fd = new FormData();
  fd.append("file", blob, `image.${ext}`);

  let rhJson: any = null;
  try {
    const res = await fetch(cfg.uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}` },
      body: fd,
    });
    const text = await res.text();
    try {
      rhJson = JSON.parse(text);
    } catch {
      rhJson = { raw: text };
    }
    if (!res.ok) {
      return NextResponse.json(
        { error: `RunningHub HTTP ${res.status}`, detail: rhJson },
        { status: 502 }
      );
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: `RunningHub fetch failed: ${e?.message || "network"}` },
      { status: 502 }
    );
  }

  // Extension expects { code: 0, data: { download_url } }
  if (rhJson?.code !== 0 && rhJson?.code !== 200) {
    return NextResponse.json(
      {
        error: `RunningHub error: ${rhJson?.message || "unknown"}`,
        detail: rhJson,
      },
      { status: 502 }
    );
  }

  const url =
    rhJson?.data?.download_url ||
    rhJson?.data?.url ||
    rhJson?.data?.fileUrl ||
    rhJson?.data?.file_url ||
    null;

  if (!url) {
    return NextResponse.json(
      { error: "RunningHub returned no URL", detail: rhJson },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, url });
}
