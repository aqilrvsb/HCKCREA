import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";
import { getMotionConfig } from "@/lib/motion";

// POST /api/motion/merge { urls: string[] } — Motion "🔗 Gabung jadi 1 video": the client's uploaded clips, in the
// order given, joined into ONE video on Modal (fitted to one frame, 30 fps, even loudness) and saved as an ordinary
// upload. The page then sends that one video to /api/motion/edit exactly like a single upload — the normal Edit Video
// flow is untouched (an option of its own, off by default). No charge here: the edit is charged by the joined length.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_CLIPS = 20;

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isTabAllowedForUser(user.id, "motion"))) {
    return NextResponse.json({ error: "Tab ini tidak tersedia untuk akaun anda." }, { status: 403 });
  }
  const b = await req.json().catch(() => ({} as any));
  const urls = (Array.isArray(b?.urls) ? b.urls : []).map((u: unknown) => String(u ?? "").trim());
  // only this client's own uploads (motion-uploads/<their id>/…)
  const own = new RegExp(`^https://peninglab-content\\.s3\\.[a-z0-9-]+\\.backblazeb2\\.com/motion-uploads/${user.id.replace(/[^A-Za-z0-9_-]/g, "")}/[A-Za-z0-9_.-]+$`);
  if (urls.length < 2 || urls.length > MAX_CLIPS || !urls.every((u: string) => own.test(u))) {
    return NextResponse.json({ error: `Pilih 2–${MAX_CLIPS} video untuk digabung.` }, { status: 400 });
  }
  const cfg = await getMotionConfig({ work: "motion" });
  if (!cfg) return NextResponse.json({ error: "Motion renderer not configured" }, { status: 503 });
  try {
    const r = await fetch(`${cfg.api_url}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: cfg.secret, urls, user_id: user.id }),
      signal: AbortSignal.timeout(290_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok || !j?.url) return NextResponse.json({ error: j?.error || `Gagal gabung video (HTTP ${r.status})` }, { status: 502 });
    return NextResponse.json({ ok: true, url: j.url, duration: Number(j.duration) || 0, clips: j.clips });
  } catch (e: any) {
    return NextResponse.json({ error: `Gagal gabung video: ${e?.name === "TimeoutError" ? "masa tamat — cuba video lebih pendek" : e?.message || "network"}` }, { status: 502 });
  }
}
