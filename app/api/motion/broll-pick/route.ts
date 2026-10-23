import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pickHeadlineBroll } from "@/lib/motion-headline";
import { clipContext } from "@/lib/clipper";

// POST /api/motion/broll-pick — "🔄 Cari gambar lain (AI)": another B-roll for one split / corner panel, no upload.
//   { kind: "split" | "pip", want?: what the client typed to show, query?: the panel's current search,
//     text?: the panel's headline words, exclude?: pictures already shown,
//     job_id + start + end (a CLIPPER clip) | id (a Motion edit in review) }
// → { ok, url, video, query } or { ok, none: true, query } (nothing clean fits: the panel keeps its colour surface).
// The pick is copied to our storage (motion-broll/), which the render routes accept like an upload.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").replace(/[<>{}]/g, "").trim().slice(0, n) : "");

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const kind = b?.kind === "pip" ? "pip" as const : b?.kind === "split" ? "split" as const : null;
  if (!kind) return NextResponse.json({ error: "Panel tidak sah." }, { status: 400 });
  const admin = createAdminClient();
  // what the video is about: the picture must fit it
  let topic = "";
  if (typeof b?.job_id === "string" && /^[0-9a-f-]{36}$/i.test(b.job_id)) {
    const { data: job } = await admin.from("history").select("user_id, metadata").eq("id", b.job_id).maybeSingle();
    if (!job || job.user_id !== user.id) return NextResponse.json({ error: "Analisa tidak dijumpai." }, { status: 404 });
    topic = clipContext((job as any).metadata?.analysis, Number(b?.start) || 0, Number(b?.end) || 0);
  } else if (typeof b?.id === "string" && /^[0-9a-f-]{36}$/i.test(b.id)) {
    const { data: row } = await admin.from("history").select("user_id, metadata").eq("id", b.id).maybeSingle();
    if (!row || row.user_id !== user.id) return NextResponse.json({ error: "Video tidak dijumpai." }, { status: 404 });
    const input = (row as any).metadata?.input ?? {};
    topic = [input.product, input.instructions].filter(Boolean).join(" — ").slice(0, 600);
  } else {
    return NextResponse.json({ error: "Klip / video tidak sah." }, { status: 400 });
  }
  const exclude = (Array.isArray(b?.exclude) ? b.exclude : []).filter((u: unknown) => typeof u === "string" && /^https:\/\//.test(u)).slice(0, 60);
  try {
    const r = await pickHeadlineBroll({ kind, want: str(b?.want, 120), query: str(b?.query, 80), text: str(b?.text, 120), topic, exclude });
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Carian gambar gagal" }, { status: 500 });
  }
}
