import { NextResponse } from "next/server";
import { validateMcpKey, validateMcpKeyString, mcpDownloadToken } from "@/lib/mcp-auth";
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
// Long-poll needs the function alive past the hold. Hold is capped at 40s;
// 50s gives headroom for the final DB read + response. MUST exceed the hold.
export const maxDuration = 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(
  req: Request,
  { params }: { params: Promise<{ task_id: string }> }
) {
  const url = new URL(req.url);
  // Accept key from ?api_key query (custom-GPT flow) or Authorization header.
  const qKey = url.searchParams.get("api_key");
  const auth = qKey ? await validateMcpKeyString(qKey.trim()) : await validateMcpKey(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { task_id } = await params;
  if (!task_id || typeof task_id !== "string") {
    return NextResponse.json({ error: "task_id required" }, { status: 400 });
  }

  // Optional long-poll. ?wait=1 (or wait=<seconds>) blocks server-side,
  // re-checking every ~2s, and returns the moment status becomes done/failed
  // — or after the hold, returning {status:"pending"} so the caller polls
  // again. Hold is clamped to <= 40s (must stay under ChatGPT's ~45s Action
  // timeout). No wait param = instant return (backward compatible).
  const waitRaw = url.searchParams.get("wait");
  let holdMs = 0;
  if (waitRaw && waitRaw !== "0" && waitRaw.toLowerCase() !== "false") {
    const n = Number(waitRaw);
    // "1"/"true" => 33s default. +~2s loop granularity +~1s final reads
    // keeps the whole call ~36s — comfortably under ChatGPT's ~45s timeout.
    const secs = Number.isFinite(n) && n > 1 ? n : 33;
    holdMs = Math.min(38, Math.max(1, secs)) * 1000;
  }

  const admin = createAdminClient();
  const origin = url.origin;
  const started = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data: row, error } = await admin
      .from("history")
      .select("id, user_id, status, output_url, cost, prompt, type, duration, error_message, metadata, created_at")
      .eq("id", task_id)
      .eq("user_id", auth.userId)
      .maybeSingle();

    if (error || !row) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const settled = row.status === "done" || row.status === "failed";
    const holdElapsed = Date.now() - started >= holdMs;

    if (settled || holdElapsed) {
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
          // Two links for the client:
          //   • output_url / stream_url — plays inline in a browser.
          //   • download_url — forces a SAVE (Content-Disposition: attachment),
          //     the only reliable way to download on iOS Safari.
          output_url: row.output_url,
          stream_url: row.output_url,
          download_url: `${origin}/api/mcp/download/${row.id}?t=${mcpDownloadToken(row.id)}`,
          cost: Number(row.cost ?? 0),
          balance,
          duration_sec: row.duration,
          model: meta.model ?? null,
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

      // Still pending after the hold window — caller should poll again.
      return NextResponse.json({
        ok: true,
        status: "pending",
        task_id: row.id,
        created_at: row.created_at,
        balance,
      });
    }

    // Pending and still within the hold window → wait ~2s and re-check.
    await sleep(2000);
  }
}
