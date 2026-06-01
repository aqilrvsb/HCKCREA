// MCP API key validation. Single shared key stored as bcrypt hash in
// app_settings.mcp_api_key.{hash, prefix, created_at, last_used_at,
// owner_user_id}. The owner_user_id is the admin who generated the key
// — all MCP-triggered rows bill to this account.
//
// Auth header: Authorization: Bearer <plaintext-key>
// Plaintext keys are prefixed "pl_live_" + 32 hex chars.

import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";
import bcrypt from "bcryptjs";

type McpKeySetting = {
  hash: string;
  prefix: string; // first 12 chars of the key for display ("pl_live_abcd")
  created_at: string;
  last_used_at: string | null;
  owner_user_id: string;
};

export type McpAuthResult =
  | { ok: true; userId: string; keyPrefix: string }
  | { ok: false; error: string; status: number };

// Parse Bearer header → plaintext key
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

  const cfg = await getSetting<McpKeySetting>("mcp_api_key");
  if (!cfg?.hash || !cfg?.owner_user_id) {
    return { ok: false, error: "MCP not configured — admin must generate a key first", status: 503 };
  }

  const matches = await bcrypt.compare(key, cfg.hash);
  if (!matches) {
    return { ok: false, error: "Invalid API key", status: 401 };
  }

  // Best-effort update of last_used_at — don't block on it.
  // Re-fetch the current row to avoid spreading a stale cached value
  // back over a freshly rotated key.
  void (async () => {
    try {
      const admin = createAdminClient();
      const { data: row } = await admin
        .from("app_settings")
        .select("value")
        .eq("key", "mcp_api_key")
        .single();
      if (!row?.value) return;
      await admin
        .from("app_settings")
        .update({
          value: { ...row.value, last_used_at: new Date().toISOString() },
        })
        .eq("key", "mcp_api_key");
    } catch {}
  })();

  return { ok: true, userId: cfg.owner_user_id, keyPrefix: cfg.prefix };
}

// Returns a stable audit tag for metadata.mcp_caller_id by prefixing
// the public key prefix with "mcp_". The prefix is non-secret (it's
// shown in the admin UI) — using it as the caller id gives audit
// visibility without leaking the full key.
export function mcpCallerId(keyPrefix: string): string {
  return `mcp_${keyPrefix}`;
}
