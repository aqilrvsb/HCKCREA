import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateSettingsCache } from "@/lib/settings";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// POST /api/admin/mcp-key — generate (or regenerate) the MCP API key.
// Returns the plaintext key ONCE. Subsequent reads only return the
// prefix + metadata (the bcrypt hash is never decryptable).
//
// Auth: must be an admin user (profiles.is_admin = true).
//
// Body: {} — no input required. Always generates a fresh key.

export async function POST() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!me?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Generate fresh key: 32 random hex chars + pl_live_ prefix.
  const random = crypto.randomBytes(16).toString("hex"); // 32 chars
  const plaintext = `pl_live_${random}`;
  const prefix = plaintext.substring(0, 12); // "pl_live_abcd"
  const hash = await bcrypt.hash(plaintext, 10);

  await admin
    .from("app_settings")
    .upsert(
      {
        key: "mcp_api_key",
        value: {
          hash,
          prefix,
          created_at: new Date().toISOString(),
          last_used_at: null,
          owner_user_id: user.id,
        },
        description: "MCP API key (single shared key, hashed)",
        category: "internal",
      },
      { onConflict: "key" }
    );

  invalidateSettingsCache(["mcp_api_key"]);

  return NextResponse.json({
    ok: true,
    key: plaintext, // shown ONCE; admin must copy it now
    prefix,
    created_at: new Date().toISOString(),
  });
}

// GET /api/admin/mcp-key — read the current key's metadata (NOT the
// plaintext). Returns null if no key configured yet.
export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!me?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: row } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "mcp_api_key")
    .maybeSingle();
  const v = (row?.value as any) || null;

  return NextResponse.json({
    ok: true,
    configured: !!v?.hash,
    prefix: v?.prefix ?? null,
    created_at: v?.created_at ?? null,
    last_used_at: v?.last_used_at ?? null,
  });
}
