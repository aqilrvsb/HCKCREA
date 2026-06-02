import { NextResponse } from "next/server";
import { validateMcpKey } from "@/lib/mcp-auth";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/mcp/status/:task_id — the polling endpoint. npm package
// hits this every 60s until status flips to done / failed.
//
// task_id is the history.id (UUID). We re-read the row + the user's
// fresh balance on every call so the caller always gets the latest
// ledger state alongside the output URL.
//
// Returns 404 if the task_id doesn't belong to the API key owner —
// security: one key can only see its own tasks.

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ task_id: string }> }
) {
  const auth = await validateMcpKey(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { task_id } = await params;
  if (!task_id || typeof task_id !== "string") {
    return NextResponse.json({ error: "task_id required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("history")
    .select("id, user_id, status, output_url, cost, prompt, type, duration, error_message, metadata, created_at")
    .eq("id", task_id)
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Fresh balance read so the caller has up-to-date credits even if
  // settle.ts just deducted.
  const { data: profile } = await admin
    .from("profiles")
    .select("credits")
    .eq("id", auth.userId)
    .maybeSingle();
  const balance = Number(profile?.credits ?? 0);

  if (row.status === "done") {
    const meta = (row.metadata as any) || {};
    return NextResponse.json({
      ok: true,
      status: "done",
      task_id: row.id,
      output_url: row.output_url,
      cost: Number(row.cost ?? 0),
      balance,
      duration_sec: row.duration,
      model: meta.model ?? null,
      // Routing info — which cascade slot/provider actually fulfilled
      // this generation. Slot is the routing tier (p2-a, p5, p6-c, etc.)
      // chosen by the admin-configured round-robin cascade. Provider is
      // the upstream vendor (crun, apipod, bytedance, etc.). key_index
      // is set when slot is a p6 multi-key family.
      slot: meta.slot ?? null,
      provider: meta.provider ?? null,
      key_index: meta.p6_key_index ?? null,
      fallback_used: meta.fallback_used ?? null,
      created_at: row.created_at,
    });
  }

  if (row.status === "failed") {
    return NextResponse.json({
      ok: true,
      status: "failed",
      task_id: row.id,
      error: row.error_message ?? "Generation failed",
      balance,
    });
  }

  // pending (cascade still firing) or running (provider task in flight)
  return NextResponse.json({
    ok: true,
    status: "pending",
    task_id: row.id,
    created_at: row.created_at,
    balance,
  });
}
