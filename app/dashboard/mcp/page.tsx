import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import McpKeysCard from "./mcp-keys-card";

// /dashboard/mcp — per-user MCP API key management.
// Logged-in users can mint multiple keys, name them, see when each
// was last used, and revoke individually. Every key bills the user's
// own credit balance (not admin's) — see lib/mcp-auth.ts.

export const dynamic = "force-dynamic";

export default async function McpSettingsPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen bg-[var(--color-bg)] py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <a href="/dashboard" className="text-sm text-[var(--color-text-muted)] hover:underline">
            ← Back to dashboard
          </a>
        </div>
        <h1 className="font-display font-bold text-3xl mb-2">MCP API Keys</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mb-8 max-w-2xl">
          Mint API keys for the <code>@aqilaz/mcp</code> npm package so AI agents
          (Claude Desktop, Cursor, Claude Code, etc.) can generate images and
          videos on peninglab.com on your behalf. Each key bills <strong>your</strong>{" "}
          credit balance. Generate a separate key per project so you can revoke
          one without affecting the others.
        </p>
        <McpKeysCard email={user.email || ""} />
      </div>
    </div>
  );
}
