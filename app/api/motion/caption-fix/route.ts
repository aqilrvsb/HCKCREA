import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fixTranscript } from "@/lib/motion-captions";
import { clipContext } from "@/lib/clipper";

// POST /api/motion/caption-fix { words: string[], id? | job_id + start + end } — "✨ Auto betulkan": the AI corrects
// misheard / misspelt caption words in the light of what the video is about (a Motion edit's product + brief, or a
// CLIPPER clip's video summary), so the client sees the fixes before the render. → { fixes: [[index, word]] }
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const words = (Array.isArray(b?.words) ? b.words : []).slice(0, 1500).map((w: unknown) => String(w ?? "").slice(0, 40));
  if (!words.length) return NextResponse.json({ error: "Tiada perkataan." }, { status: 400 });
  const admin = createAdminClient();
  let context = "";
  let language: "ms" | "en" | "auto" = "ms";
  if (typeof b?.job_id === "string" && /^[0-9a-f-]{36}$/i.test(b.job_id)) {
    // a CLIPPER clip: the video's title + summary + why the clip was picked
    const { data: job } = await admin.from("history").select("user_id, metadata").eq("id", b.job_id).maybeSingle();
    if (!job || job.user_id !== user.id) return NextResponse.json({ error: "Analisa tidak dijumpai." }, { status: 404 });
    const a = (job as any).metadata?.analysis;
    context = clipContext(a, Number(b?.start) || 0, Number(b?.end) || 0);
    language = a?.language === "en" ? "en" : "ms";
  } else if (typeof b?.id === "string" && /^[0-9a-f-]{36}$/i.test(b.id)) {
    // a Motion edit in review: the product + the client's brief
    const { data: row } = await admin.from("history").select("user_id, metadata").eq("id", b.id).maybeSingle();
    if (!row || row.user_id !== user.id) return NextResponse.json({ error: "Video tidak dijumpai." }, { status: 404 });
    const input = (row as any).metadata?.input ?? {};
    context = [input.product, input.instructions].filter(Boolean).join(" — ").slice(0, 600);
    language = input.language === "en" ? "en" : input.language === "auto" ? "auto" : "ms";
  } else {
    return NextResponse.json({ error: "Klip / video tidak sah." }, { status: 400 });
  }
  const fixes = await fixTranscript(words.map((w: string, i: number) => ({ i, w })), context || undefined, language).catch(() => [] as [number, string][]);
  return NextResponse.json({ ok: true, fixes });
}
