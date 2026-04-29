import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRunningHubConfig } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/upload/audio — proxies a local audio file to RunningHub's
// binary upload endpoint and returns the public download_url. Mirrors
// /api/upload/image and /api/upload/video.
//
// Used by the Cinema (Seedance) tab as a reference audio uploader.
// Seedance reference audio limits: mp3/wav, ≤15s, ≤15MB.

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED_TYPES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"];

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  let blob: Blob;
  let contentType: string;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No file" }, { status: 400 });
    }
    contentType = file.type || "audio/mpeg";
    if (!ALLOWED_TYPES.includes(contentType)) {
      return NextResponse.json({ error: `Unsupported type: ${contentType}` }, { status: 415 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Audio too large (max 15MB)" }, { status: 413 });
    }
    blob = file;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Read failed" }, { status: 400 });
  }

  const cfg = await getRunningHubConfig();
  if (!cfg.key || !cfg.uploadUrl) {
    return NextResponse.json(
      { error: "RunningHub not configured (hc_rh_key / hc_rh_upload missing)" },
      { status: 500 }
    );
  }

  const ext = contentType.includes("wav") ? "wav" : "mp3";
  const fd = new FormData();
  fd.append("file", blob, `audio.${ext}`);

  let rhJson: any = null;
  try {
    const res = await fetch(cfg.uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}` },
      body: fd,
    });
    const text = await res.text();
    try { rhJson = JSON.parse(text); } catch { rhJson = { raw: text }; }
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

  if (rhJson?.code !== 0 && rhJson?.code !== 200) {
    return NextResponse.json(
      { error: `RunningHub error: ${rhJson?.message || "unknown"}`, detail: rhJson },
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
