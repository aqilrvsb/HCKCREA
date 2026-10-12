import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tokenMatches } from "@/lib/motion";
import { guardCensorWords, guardClassify, guardHits, guardSpeech } from "@/lib/motion-guard";

// POST /api/motion/guard — called BY the Modal job when the client ticked
// "Check Guideline TikTok". Auth = the row's plan_token.
//   kind "speech":  { words }  → { cut: [[a,b]], censor: [i], risk }  claim
//                   statements to cut, isolated words to mute, product risk
//   kind "video" | "broll" | "product":  { texts }  → { risky: [k] }  printed
//                   lines (OCR) to cover with tape
// LLM compliance pass (model_motion cascade) ∪ the rule safety net, so a model
// outage still never lets a disease name through.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({} as any));
  const id = String(b?.history_id || "");
  const token = String(b?.token || "");
  if (!id || !token) return NextResponse.json({ ok: false, error: "history_id + token required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin.from("history").select("id, tab, status, metadata").eq("id", id).maybeSingle();
  if (!row || row.tab !== "motion" || !tokenMatches(token, row.metadata?.plan_token)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  if (row.status !== "pending") return NextResponse.json({ ok: false, error: "row not pending" }, { status: 409 });

  const input = row.metadata?.input || {};
  const product = [input.product, input.description, input.instructions].filter(Boolean).join(" — ").slice(0, 500) || undefined;

  if (b?.kind === "speech") {
    const words: { i: number; w: string }[] = (Array.isArray(b?.words) ? b.words : [])
      .slice(0, 3000)
      .map((w: any) => ({ i: Number(w?.i), w: String(w?.w ?? "").slice(0, 40) }))
      .filter((w: { i: number; w: string }) => Number.isInteger(w.i) && w.i >= 0 && w.w);
    const llm = await guardSpeech({ words, product }).catch(() => null);
    const cutSet = new Set<number>();
    for (const [a, c] of llm?.cut ?? []) for (let i = a; i <= c; i++) cutSet.add(i);
    const censor = new Set<number>(llm?.censor ?? []);
    for (const i of guardCensorWords(words)) if (!cutSet.has(i)) censor.add(i);
    return NextResponse.json({
      ok: true,
      via: llm ? "llm+rules" : "rules",
      cut: llm?.cut ?? [],
      censor: [...censor].sort((a, c) => a - c),
      risk: llm?.risk ?? null,
    });
  }

  const kind = ["video", "broll", "product"].includes(b?.kind) ? b.kind : "video";
  const texts: string[] = (Array.isArray(b?.texts) ? b.texts : []).slice(0, 200).map((t: any) => String(t ?? "").slice(0, 160));
  const llm = await guardClassify({ kind, texts, product }).catch(() => null);
  const risky = new Set<number>(llm?.risky ?? []);
  texts.forEach((t, k) => { if (guardHits(t).length) risky.add(k); });
  return NextResponse.json({ ok: true, via: llm ? "llm+rules" : "rules", risky: [...risky].sort((a, c) => a - c) });
}
