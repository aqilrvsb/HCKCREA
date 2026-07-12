import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { orChat } from "@/lib/openrouter";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// POST /api/generate/video-ref-dialog
// Body: { product_name, product_detail, seg_count (1-3), style? }
//
// Generates natural Malaysian Bahasa Melayu UGC dialog for the Video
// Reference guided mode — one line per segment, ~10s each (24-28 words,
// Seller/TikTok pace). Continuous across segments. NO Indonesian slang.
// Same model slot as the master plan / caption generator.

export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const productName = String(body?.product_name || "").trim();
  const productDetail = String(body?.product_detail || "").trim();
  const segCount = Math.max(1, Math.min(3, Math.round(Number(body?.seg_count) || 1)));

  if (!productName && !productDetail) {
    return NextResponse.json(
      { error: "Isi Product Name / Detail Product dulu sebelum jana dialog." },
      { status: 400 }
    );
  }

  const systemPrompt = `You write short spoken TikTok UGC dialog in NATURAL MALAYSIAN Bahasa Melayu for an affiliate seller video.

STRICT LANGUAGE RULES:
- Malaysian BM ONLY. Use words like: korang, memang, gila, kan, jom, tau tak, berbaloi, terus, memang power, cuba, try, best.
- ABSOLUTELY NO Indonesian words/slang: never use "banget", "nih", "gue", "loe", "kalian", "pengen", "banget", "aja", "udah", "bikin", "gitu", "doang", "kayak gini", "sih" (Indon style), "yang bikin".
- Conversational, warm, like a real Malaysian friend recommending a product. First person.
- No emojis, no hashtags, no stage directions, no quotation marks — just the spoken words.

LENGTH: each segment line must be ~24-28 words (about 10 seconds of natural speech at a lively Seller/TikTok pace).

${segCount > 1 ? `Write EXACTLY ${segCount} lines forming ONE continuous pitch: line 1 hooks + introduces the product, middle line(s) give the benefit/proof, the last line drives action (jom grab / berbaloi). Each line flows naturally into the next.` : `Write EXACTLY 1 line: a complete hook → benefit → soft call-to-action.`}

Output ONLY a JSON object: {"dialogs": ["line 1"${segCount > 1 ? ', "line 2", ...' : ""}]} with exactly ${segCount} string(s). No markdown, no prose.`;

  const userPrompt = `Product: ${productName || "(unnamed product)"}
Detail / knowledge: ${productDetail || "(none given — infer a believable Malaysian affiliate angle)"}

Write ${segCount} Malaysian BM dialog line(s) as specified. Return JSON only.`;

  // Dialog gen runs on gemini-3.1-flash-lite per user direction — model_auto
  // is configured as exactly that cascade (grsai gemini-3.1-flash-lite →
  // openrouter gemini-3.1-flash-lite fallback), so we point at it directly.
  const llm = await orChat({
    modelKey: "model_auto",
    systemPrompt,
    userPrompt,
    temperature: 0.9,
    maxTokens: 700,
  });
  if (!llm.ok || !llm.content) {
    return NextResponse.json({ error: llm.error || "LLM call failed" }, { status: 502 });
  }

  // Tolerant parse — strip fences, slice to braces.
  let dialogs: string[] = [];
  try {
    let cleaned = llm.content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();
    }
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) cleaned = cleaned.substring(start, end + 1);
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed?.dialogs)) {
      dialogs = parsed.dialogs.map((d: any) => String(d || "").trim()).filter(Boolean);
    }
  } catch {
    // Fallback: split by newlines if the JSON is malformed.
    dialogs = llm.content
      .split(/\n+/)
      .map((l) => l.replace(/^["'\d.\-)\s]+/, "").replace(/["']+$/, "").trim())
      .filter((l) => l.length > 8)
      .slice(0, segCount);
  }

  if (dialogs.length === 0) {
    return NextResponse.json({ error: "Dialog gagal dijana, cuba lagi." }, { status: 502 });
  }

  // Pad/trim to exactly segCount.
  while (dialogs.length < segCount) dialogs.push(dialogs[dialogs.length - 1] || "");
  dialogs = dialogs.slice(0, segCount);

  return NextResponse.json({ ok: true, dialogs });
}
