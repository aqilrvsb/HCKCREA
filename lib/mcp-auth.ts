// MCP API key validation. Per-user keys stored in public.user_mcp_keys.
// Each user can mint multiple keys via /settings/mcp.
//
// Auth header: Authorization: Bearer <plaintext-key>
// Plaintext keys are prefixed "pl_live_" + 32 hex chars.
//
// Lookup flow:
//   1. Parse Bearer header.
//   2. Slice first 12 chars as the prefix.
//   3. SELECT row WHERE prefix = ? AND revoked_at IS NULL.
//   4. bcrypt.compare(plaintext, row.hash).
//   5. Best-effort update last_used_at on the matched row.
//
// All MCP-triggered generations bill to row.user_id — every key is
// scoped to whichever account minted it.

import { createAdminClient } from "@/lib/supabase/admin";
import { canUseMcp } from "@/lib/plans";
import bcrypt from "bcryptjs";

export type McpAuthResult =
  | { ok: true; userId: string; keyPrefix: string; keyId: string }
  | { ok: false; error: string; status: number };

function parseBearer(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/);
  return m ? m[1].trim() : null;
}

export async function validateMcpKey(req: Request): Promise<McpAuthResult> {
  const key = parseBearer(req);
  if (!key) {
    return { ok: false, error: "Missing Authorization: Bearer header", status: 401 };
  }
  return validateMcpKeyString(key);
}

// Same validation but from a raw key string — used when the key arrives in
// the request BODY / QUERY instead of the Authorization header (the custom-
// GPT flow: /api/mcp/login returns a key the model then passes as a param
// to generate/status, since GPT Actions can't set a dynamic Bearer header).
export async function validateMcpKeyString(key: string): Promise<McpAuthResult> {
  if (!key || !key.startsWith("pl_live_") || key.length < 20) {
    return { ok: false, error: "Invalid key format", status: 401 };
  }

  const prefix = key.substring(0, 12);

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("user_mcp_keys")
    .select("id, user_id, hash, prefix")
    .eq("prefix", prefix)
    .is("revoked_at", null)
    .maybeSingle();

  if (!row) {
    return { ok: false, error: "Invalid API key", status: 401 };
  }

  const matches = await bcrypt.compare(key, row.hash);
  if (!matches) {
    return { ok: false, error: "Invalid API key", status: 401 };
  }

  // Plan gate — MCP API access is bundled with Pro + Premium tiers
  // (see MCP_TIERS in lib/plans.ts). The key itself is valid but the
  // owner's account must be on an eligible plan AND that plan must be
  // active. Free / Starter / Standard / expired plans get a 403 with
  // an upgrade hint so the AI agent surfaces a clear path forward.
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, plan_expires_at")
    .eq("id", row.user_id)
    .maybeSingle();
  const planKey = (profile?.plan as string) || "";
  const expiresAt = profile?.plan_expires_at as string | null;
  const planActive = !!expiresAt && new Date(expiresAt) > new Date();
  if (!planActive || !canUseMcp(planKey)) {
    return {
      ok: false,
      error:
        "MCP API is available on Pro and Premium plans only. Upgrade at https://peninglab.com/dashboard/billing to enable.",
      status: 403,
    };
  }

  // Best-effort last_used_at update — don't block on it.
  void (async () => {
    try {
      await admin
        .from("user_mcp_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", row.id);
    } catch {}
  })();

  return { ok: true, userId: row.user_id, keyPrefix: row.prefix, keyId: row.id };
}

// Returns a stable audit tag for metadata.mcp_caller_id by prefixing
// the public key prefix with "mcp_". The prefix is non-secret (shown
// in the user's MCP settings page) — using it as the caller id gives
// audit visibility without leaking the full key.
export function mcpCallerId(keyPrefix: string): string {
  return `mcp_${keyPrefix}`;
}
