import { NextResponse } from "next/server";
import { authExtensionUser } from "@/lib/extension-auth";
import { generateUgcPostMetaBatch } from "@/lib/ugc-post-meta-batch";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// POST /api/ugc/generate-post-meta-batch
// Body: { history_ids: string[], product_url?, product_name?, product_detail?,
//         detail_only?, source? }
//
// MASTER-PLAN bulk caption/cover generation for the Editor: plans a chunk of
// videos per LLM call (not one call per video), so a 40-video batch is a handful
// of reliable calls instead of 40 that time out. Returns per-id results.
export async function POST(req: Request) {
  const user = await authExtensionUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.history_ids)
    ? body.history_ids.map((x: any) => String(x || "").trim()).filter(Boolean)
    : [];
  if (!ids.length) return NextResponse.json({ error: "history_ids required" }, { status: 400 });

  const isEditor = String(body?.source || "").trim() === "editor";
  const result = await generateUgcPostMetaBatch(ids, {
    productUrl: String(body?.product_url || "").trim(),
    productName: String(body?.product_name || "").trim(),
    productDetail: String(body?.product_detail || "").trim(),
    detailOnly: body?.detail_only === true,
    userIdGuard: user.id,
    ...(isEditor ? { modelKey: "model_editor_text" as const } : {}),
  });

  return NextResponse.json({ ok: result.ok, results: result.results, errors: result.errors });
}
