import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRunningHubConfig } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// POST /api/scrape/rehost { url }
//
// Fetches the given image URL (typically a TikTok CDN URL whose RH-hosted
// counterpart has expired) and re-uploads it to RunningHub, returning a
// fresh signed URL valid for 24h. The Auto Content tab calls this on
// submit when its current imageData is the TikTok URL — the AI generation
// pipelines (Crun.ai / GeminiGen) sometimes can't fetch TikTok CDN from
// their region, so RH-rehosting is a guaranteed-working hand-off.
//
// Idempotent: passing an already-RH URL just re-uploads (caller can skip
// the call when the URL already looks like an RH endpoint).
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const url = String(body?.url || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  const rhCfg = await getRunningHubConfig();
  if (!rhCfg.key || !rhCfg.uploadUrl) {
    return NextResponse.json(
      { error: "RunningHub not configured" },
      { status: 500 }
    );
  }

  try {
    const imgRes = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!imgRes.ok) {
      return NextResponse.json(
        { error: `Source image fetch failed (HTTP ${imgRes.status})` },
        { status: 502 }
      );
    }
    const blob = await imgRes.blob();
    const fd = new FormData();
    fd.append("file", blob, "rehost.jpg");
    const upRes = await fetch(rhCfg.uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${rhCfg.key}` },
      body: fd,
    });
    const upJson: any = await upRes.json().catch(() => null);
    const rhUrl =
      upJson?.data?.download_url ||
      upJson?.data?.url ||
      upJson?.data?.fileUrl ||
      null;
    if (!upRes.ok || !rhUrl) {
      return NextResponse.json(
        { error: "RunningHub upload failed" },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, url: rhUrl });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Rehost failed" },
      { status: 500 }
    );
  }
}
