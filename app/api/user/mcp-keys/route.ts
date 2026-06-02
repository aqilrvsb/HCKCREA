import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// GET /api/user/mcp-keys — list the logged-in user's MCP API keys.
// Returns metadata only (prefix, name, dates) — never the plaintext or
// the bcrypt hash. Revoked keys are excluded.
//
// POST /api/user/mcp-keys — generate a new key for the logged-in user.
// Returns the plaintext ONCE. Subsequent reads only return metadata.

export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: keys } = await admin
    .from("user_mcp_keys")
    .select("id, name, prefix, created_at, last_used_at")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  return NextResponse.json({ ok: true, keys: keys || [] });
}

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rawName = typeof body?.name === "string" ? body.name.trim() : "";
  const name = rawName.substring(0, 80) || "Untitled key";

  // Generate fresh key: 32 random hex chars + pl_live_ prefix.
  // Retry once if the 4-hex prefix collides (extremely rare).
  const admin = createAdminClient();
  let plaintext = "";
  let prefix = "";
  let hash = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const random = crypto.randomBytes(16).toString("hex");
    plaintext = `pl_live_${random}`;
    prefix = plaintext.substring(0, 12);

    const { data: existing } = await admin
      .from("user_mcp_keys")
      .select("id")
      .eq("prefix", prefix)
      .maybeSingle();
    if (!existing) {
      hash = await bcrypt.hash(plaintext, 10);
      break;
    }
  }
  if (!hash) {
    return NextResponse.json({ error: "Failed to mint a unique key — try again" }, { status: 500 });
  }

  const { data: row, error: insErr } = await admin
    .from("user_mcp_keys")
    .insert({
      user_id: user.id,
      name,
      hash,
      prefix,
    })
    .select("id, name, prefix, created_at")
    .single();

  if (insErr || !row) {
    return NextResponse.json({ error: "DB insert failed", detail: insErr?.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    key: plaintext, // shown ONCE
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    created_at: row.created_at,
  });
}
