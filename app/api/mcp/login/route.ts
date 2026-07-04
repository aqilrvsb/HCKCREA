import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { canUseMcp } from "@/lib/plans";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// POST /api/mcp/login — email + password → verify → return that account's
// API key (for the custom-GPT per-client flow).
//
// Flow:
//   1. Verify email/password via Supabase GoTrue (signInWithPassword).
//   2. Gate: the account must be on an ACTIVE Pro/Premium plan.
//   3. Mint a fresh "Custom GPT" key for that user (revoking any prior
//      "Custom GPT" key so each client keeps exactly one active key).
//   4. Return the plaintext key + balance + plan.
//
// The GPT then passes `api_key` as a parameter to /api/mcp/gpt/generate-video
// and /api/mcp/gpt/status. Every generation bills the CLIENT'S own account.
//
// Security: password verification is delegated to GoTrue (which rate-limits
// sign-in attempts). Always send over HTTPS.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  if (!email || !password) {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !anon) {
    return NextResponse.json({ error: "Server auth not configured" }, { status: 500 });
  }

  // 1. Verify credentials via GoTrue.
  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signErr } = await sb.auth.signInWithPassword({ email, password });
  if (signErr || !signIn?.user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }
  const userId = signIn.user.id;

  // 2. Plan gate — Pro/Premium active only.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, plan_expires_at, credits")
    .eq("id", userId)
    .maybeSingle();
  const planKey = (profile?.plan as string) || "";
  const expiresAt = profile?.plan_expires_at as string | null;
  const planActive = !!expiresAt && new Date(expiresAt) > new Date();
  if (!planActive || !canUseMcp(planKey)) {
    return NextResponse.json(
      {
        error:
          "This account needs an active Pro or Premium plan to use the API. Upgrade at https://peninglab.com/dashboard/billing.",
      },
      { status: 403 }
    );
  }

  // 3. One "Custom GPT" key per user — revoke old ones, mint fresh.
  await admin
    .from("user_mcp_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("name", "Custom GPT")
    .is("revoked_at", null);

  let plaintext = "";
  let prefix = "";
  let hash = "";
  for (let i = 0; i < 3; i++) {
    plaintext = "pl_live_" + crypto.randomBytes(16).toString("hex");
    prefix = plaintext.substring(0, 12);
    const { data: exists } = await admin
      .from("user_mcp_keys")
      .select("id")
      .eq("prefix", prefix)
      .maybeSingle();
    if (!exists) {
      hash = await bcrypt.hash(plaintext, 10);
      break;
    }
  }
  if (!hash) {
    return NextResponse.json({ error: "Failed to mint a unique key — try again" }, { status: 500 });
  }

  const { error: insErr } = await admin
    .from("user_mcp_keys")
    .insert({ user_id: userId, name: "Custom GPT", hash, prefix });
  if (insErr) {
    return NextResponse.json({ error: "Failed to store key", detail: insErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    api_key: plaintext,
    email,
    balance: Number(profile?.credits ?? 0),
    plan: planKey,
  });
}
