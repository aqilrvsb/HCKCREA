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
  if (!key.startsWith("pl_live_") || key.length < 20) {
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
