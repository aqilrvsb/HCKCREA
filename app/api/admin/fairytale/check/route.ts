import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/admin/fairytale/check
// Admin-only diagnostic endpoint — verifies the Fairytale tab is fully wired.
// Reports whether each external dependency is reachable + correctly configured.
//
// Lets you debug env vars without re-deploying repeatedly. Open this URL in
// your browser while logged in as admin and you'll see exactly which piece
// is broken.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function adminGate() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) return null;
  return user;
}

export async function GET() {
  if (!(await adminGate())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const checks: Record<string, { ok: boolean; detail: string }> = {};

  // 1. MINIMAX_API_KEY env var present
  const minimaxKey = process.env.MINIMAX_API_KEY || "";
  checks.minimax_key = {
    ok: !!minimaxKey,
    detail: minimaxKey
      ? `Set (${minimaxKey.slice(0, 8)}...${minimaxKey.slice(-4)}, length ${minimaxKey.length})`
      : "MISSING — add to Vercel Environment Variables",
  };

  // 2. MODAL_FAIRYTALE_ENDPOINT env var present
  const modalEndpoint = process.env.MODAL_FAIRYTALE_ENDPOINT || "";
  checks.modal_endpoint = {
    ok: !!modalEndpoint && modalEndpoint.startsWith("https://"),
    detail: modalEndpoint
      ? modalEndpoint
      : "MISSING — add to Vercel Environment Variables (URL from `modal deploy modal_fairytale.py`)",
  };

  // 3. MiniMax API reachable + key valid (1-char test request)
  if (minimaxKey) {
    try {
      const r = await fetch("https://api.minimax.io/v1/t2a_v2", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${minimaxKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "speech-2.6-turbo",
          text: "ok",
          stream: false,
          language_boost: "Malay",
          output_format: "hex",
          voice_setting: { voice_id: "Malay_female_1_v1", speed: 1, vol: 1, pitch: 0 },
          audio_setting: { format: "mp3", sample_rate: 32000, channel: 1 },
        }),
      });
      const j = await r.json().catch(() => null);
      const code = j?.base_resp?.status_code ?? 0;
      checks.minimax_api = {
        ok: r.ok && code === 0,
        detail: r.ok && code === 0
          ? "Reachable + key valid"
          : `HTTP ${r.status} · status_code ${code} · ${j?.base_resp?.status_msg || "unknown"}`,
      };
    } catch (e: any) {
      checks.minimax_api = { ok: false, detail: `Network error: ${e?.message}` };
    }
  } else {
    checks.minimax_api = { ok: false, detail: "Skipped — no API key" };
  }

  // 4. Modal endpoint reachable (HEAD-style ping with empty payload)
  if (modalEndpoint) {
    try {
      const r = await fetch(modalEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // empty payload — Modal returns 4xx but proves it's alive
      });
      checks.modal_endpoint_reachable = {
        ok: r.status > 0 && r.status < 600,
        detail: `HTTP ${r.status} (any 2xx-5xx response means Modal is alive)`,
      };
    } catch (e: any) {
      checks.modal_endpoint_reachable = {
        ok: false,
        detail: `Network error: ${e?.message} — likely wrong URL or Modal app not deployed`,
      };
    }
  } else {
    checks.modal_endpoint_reachable = { ok: false, detail: "Skipped — no endpoint URL" };
  }

  // 5. Supabase Storage bucket "fairytale" exists
  try {
    const admin = createAdminClient();
    const { data: bucket, error } = await admin.storage.getBucket("fairytale");
    checks.storage_bucket = {
      ok: !!bucket && !error,
      detail: bucket
        ? `Found · public=${bucket.public} · size_limit=${bucket.file_size_limit ?? "unlimited"}`
        : `MISSING — create bucket "fairytale" in Supabase Storage (private, no policies needed)`,
    };
  } catch (e: any) {
    checks.storage_bucket = { ok: false, detail: `Lookup failed: ${e?.message}` };
  }

  // 6. history table accepts type='fairytale'
  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from("history")
      .select("id", { count: "exact", head: true })
      .eq("type", "fairytale");
    checks.history_type_accepted = {
      ok: !error,
      detail: error
        ? `Schema rejects type='fairytale' — ${error.message}`
        : `OK · ${count ?? 0} fairytale rows so far`,
    };
  } catch (e: any) {
    checks.history_type_accepted = { ok: false, detail: e?.message };
  }

  const allGood = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({
    ok: allGood,
    summary: allGood
      ? "✅ All systems go — Fairytale tab is ready to render."
      : "❌ One or more dependencies missing. See checks below.",
    checks,
    next_steps: allGood
      ? []
      : [
          checks.minimax_key.ok ? null : "Add MINIMAX_API_KEY to Vercel env vars",
          checks.modal_endpoint.ok ? null : "Run `modal deploy modal_fairytale.py` and paste URL into Vercel as MODAL_FAIRYTALE_ENDPOINT",
          checks.storage_bucket.ok ? null : "Create Supabase Storage bucket named 'fairytale' (private)",
          checks.history_type_accepted.ok ? null : "Check if history.type column has an enum constraint blocking 'fairytale'",
        ].filter(Boolean),
  });
}
