import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt || "").trim();
  const referenceUrl = body?.reference_url ? String(body.reference_url) : undefined;
  const aspectRatio = String(body?.aspect_ratio || "9:16");

  if (!prompt) return NextResponse.json({ error: "Prompt required" }, { status: 400 });

  // Pre-flight credit check
  const cost = await priceFor(user.id, "image_generate");
  if (!(await hasEnoughCredits(user.id, cost))) {
    return NextResponse.json(
      { error: "Kredit tak cukup. Top up dulu." },
      { status: 402 }
    );
  }

  // Resolve image model
  const cfg = await getP2Config();
  const modelKey = cfg.imageDefault || "nano-banana-pro";
  const modelId = (cfg.imageModels as any)?.[modelKey] || modelKey;

  const created = await p2CreateTask({
    model: modelId,
    prompt,
    imageUrl: referenceUrl,
    aspectRatio,
  });
  if (!created.ok || !created.task_id) {
    return NextResponse.json({ error: created.error || "P2 create failed" }, { status: 502 });
  }

  // Insert history row in 'pending' state — deduction happens on poll success
  const admin = createAdminClient();
  const { data: hist } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      type: "image",
      tab: "image",
      status: "pending",
      prompt,
      reference_url: referenceUrl,
      task_id: created.task_id,
      cost,
      metadata: { model: modelKey, aspectRatio },
    })
    .select()
    .single();

  return NextResponse.json({
    ok: true,
    history_id: hist?.id,
    task_id: created.task_id,
    cost,
  });
}
