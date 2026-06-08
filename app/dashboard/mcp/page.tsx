import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canUseMcp } from "@/lib/plans";
import McpKeysCard from "./mcp-keys-card";

// /dashboard/mcp — per-user MCP API key management.
// Logged-in users on Pro/Premium plans can mint multiple keys, name
// them, see when each was last used, and revoke individually. Every
// key bills the user's own credit balance (not admin's) — see
// lib/mcp-auth.ts.
//
// Starter / Standard / free / expired users see an upgrade prompt
// instead of the keys UI. The same gate is enforced server-side in
// lib/mcp-auth.ts so even if someone bookmarks an old key URL, the
// API rejects with 403.

export const dynamic = "force-dynamic";

export default async function McpSettingsPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  // Plan gate — read the user's current plan + expiry to decide whether
  // to render the keys UI or an upgrade pitch.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, plan_expires_at")
    .eq("id", user.id)
    .maybeSingle();
  const plan = (profile?.plan as string) || "";
  const expiresAt = profile?.plan_expires_at as string | null;
  const planActive = !!expiresAt && new Date(expiresAt) > new Date();
  const allowed = planActive && canUseMcp(plan);

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
          Mint API keys for the <code>peninglab-mcp</code> npm package so AI agents
          (Claude Desktop, Cursor, Claude Code, etc.) can generate images and
          videos on peninglab.com on your behalf. Each key bills <strong>your</strong>{" "}
          credit balance. Generate a separate key per project so you can revoke
          one without affecting the others.
        </p>

        {allowed ? (
          <McpKeysCard email={user.email || ""} />
        ) : (
          <div
            className="card p-8 border-2"
            style={{
              background: "rgba(250, 204, 21, 0.05)",
              borderColor: "rgba(250, 204, 21, 0.35)",
            }}
          >
            <div className="text-center mb-6">
              <div
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-widest mb-4"
                style={{
                  background: "linear-gradient(90deg, #facc15 0%, #eab308 100%)",
                  color: "#000",
                }}
              >
                Pro / Premium only
              </div>
              <h2 className="font-display font-extrabold text-2xl mb-3">
                Upgrade untuk akses MCP API
              </h2>
              <p className="text-sm text-[var(--color-text-secondary)] max-w-md mx-auto">
                MCP API termasuk dalam plan <strong>Pro (RM 120)</strong> dan{" "}
                <strong>Premium (RM 200)</strong> sahaja. Subscribe untuk mint
                API keys + integrate dengan Claude Desktop / Cursor / agen AI
                lain.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 mb-6">
              <div
                className="p-4 rounded-xl"
                style={{
                  background: "var(--color-bg-elev)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <div className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-text-muted)] mb-1">
                  Pro
                </div>
                <div className="font-display font-extrabold text-2xl">RM 120</div>
                <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  /30 hari + RM 50 credits
                </div>
              </div>
              <div
                className="p-4 rounded-xl"
                style={{
                  background: "var(--color-bg-elev)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <div className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-text-muted)] mb-1">
                  Premium
                </div>
                <div className="font-display font-extrabold text-2xl">RM 200</div>
                <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  /30 hari + RM 100 credits
                </div>
              </div>
            </div>

            <Link
              href="/dashboard"
              className="w-full inline-flex items-center justify-center py-3 rounded-xl text-sm font-extrabold"
              style={{
                background: "linear-gradient(90deg, #facc15 0%, #eab308 100%)",
                color: "#000",
              }}
            >
              Pergi ke Billing → Upgrade
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
