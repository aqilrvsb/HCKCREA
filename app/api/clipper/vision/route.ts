import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractJson, tokenMatches } from "@/lib/motion";
import { orChatVision, withDeadline } from "@/lib/openrouter";
import { CLIPPER_JOB_TAB } from "@/lib/clipper";

// POST /api/clipper/vision — called BY the Modal analysis after the director picked the clips: the top candidates
// as contact sheets (6 frames each, sampled across the clip). The master director (model_motion — DragonAPI
// Sonnet 5.5, vision) LOOKS at them: a visible, expressive speaker and visual moments score up; blank frames,
// slides, nobody on screen, other channels' logos score down. Auth = the analysis row's plan_token.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SHEET_HOST = /^https:\/\/peninglab-content\.s3\.[a-z0-9-]+\.backblazeb2\.com\/users\//;

export async function POST(req: Request) {
  const t0 = Date.now();
  const b = await req.json().catch(() => ({} as any));
  const id = String(b?.history_id || "");
  const token = String(b?.token || "");
  if (!id || !token) return NextResponse.json({ ok: false, error: "history_id + token required" }, { status: 400 });
  const { data: row } = await createAdminClient().from("history").select("id, tab, status, metadata").eq("id", id).maybeSingle();
  if (!row || row.tab !== CLIPPER_JOB_TAB || !tokenMatches(token, row.metadata?.plan_token)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const items = (Array.isArray(b?.items) ? b.items : []).slice(0, 10)
    .map((x: any) => ({ i: Number(x?.i), title: String(x?.title ?? "").slice(0, 90), hook: String(x?.hook ?? "").slice(0, 60), image: String(x?.image ?? "") }))
    .filter((x: { i: number; image: string }) => Number.isInteger(x.i) && x.i >= 0 && SHEET_HOST.test(x.image));
  if (!items.length) return NextResponse.json({ ok: false, error: "no items" }, { status: 400 });

  const list = items.map((x: { title: string; hook: string }, k: number) => `${k + 1}. "${x.title}" — hook "${x.hook}"`).join("\n");
  const r = await withDeadline(t0 + 100_000, () => orChatVision({
    modelKey: "model_motion",
    systemPrompt: `You are PeningLab's master director checking viral clip candidates VISUALLY before they are rendered. Each image is one candidate: 6 frames sampled across the clip (left → right, top → bottom) from a long landscape video that will be reframed to vertical 9:16 around the speaker's face.
Score each candidate 0–10 for how strong it is as a SHORT-FORM VIDEO to look at:
+ a clearly visible speaker face (the crop follows it), expressive moments — gestures, emotion, reactions, laughter, props, a demonstration, visual variety
− blank / black frames, slides or screen recordings with tiny text, nobody on screen, heavy logos / watermarks of another channel, a static wide shot where faces are tiny, low-quality frames
Most candidates are 5–7. "note": ≤ 12 words in Bahasa Melayu (Malaysia) — what you see.
Return ONLY JSON: {"clips": [{"n": 1, "visual": 7, "note": "…"}]} — one entry per image, in order.`,
    textPrompt: `${items.length} candidates, in the order of the images:\n${list}\nJSON only.`,
    images: items.map((x: { image: string }) => x.image),
    temperature: 0.2,
    maxTokens: 1500,
    timeoutMs: 90_000,
    deadline: t0 + 95_000,
  })).catch((e: any) => ({ ok: false, error: e?.message } as { ok: boolean; content?: string; error?: string }));
  if (!r.ok || !r.content) return NextResponse.json({ ok: false, error: r.error || "vision failed" }, { status: 502 });
  let raw: any = null;
  try { raw = extractJson(r.content); } catch { /* bad JSON */ }
  const out = (Array.isArray(raw?.clips) ? raw.clips : []).map((v: any) => {
    const n = Number(v?.n);
    const item = Number.isInteger(n) && n >= 1 && n <= items.length ? items[n - 1] : null;
    const visual = Math.max(0, Math.min(10, Math.round((Number(v?.visual) || 0) * 10) / 10));
    return item ? { i: item.i, visual, note: String(v?.note ?? "").replace(/\s+/g, " ").trim().slice(0, 120) } : null;
  }).filter(Boolean);
  return NextResponse.json({ ok: true, results: out, ms: Date.now() - t0 });
}
