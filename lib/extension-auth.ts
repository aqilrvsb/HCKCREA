import { createClient as createSbClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Auth resolver for the Chrome extension. Three modes, tried in order:
//
//   1. `x-pl-email` header (email-only lookup — matches creative-hack-auto)
//      The extension caches the user's email after one-time entry on the
//      side panel and ships it on every API call. Server uses the admin
//      client (service role, RLS bypass) to look up the user by email.
//      No password, no token.
//
//   2. `Authorization: Bearer <Supabase access_token>` (token-based)
//      Available for clients that prefer Supabase password grant. Kept
//      so the extension can be upgraded to token auth later without
//      rewriting the server side.
//
//   3. Supabase session cookies (browser tab already logged into
//      peninglab.com — useful for hitting endpoints from devtools).
//
// Returns null if nothing yields a valid user. Callers respond 401.

export async function authExtensionUser(req: Request): Promise<{
  id: string;
  email: string | null;
} | null> {
  // Mode 1 — email lookup (the mode the rebranded extension uses).
  const emailHeader = (req.headers.get("x-pl-email") || "").trim().toLowerCase();
  if (emailHeader && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailHeader)) {
    const admin = createAdminClient();
    // Look up the auth user by email. We use the admin client's
    // listUsers + filter rather than profiles because email is the
    // canonical identity in auth.users; profiles.id matches it but
    // doesn't carry email directly.
    const { data, error } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (!error && data?.users) {
      const u = data.users.find(
        (x: any) => (x.email || "").toLowerCase() === emailHeader
      );
      if (u) {
        return { id: u.id, email: u.email || emailHeader };
      }
    }
  }

  // Mode 2 — Bearer token.
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const sb = createSbClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { data, error } = await sb.auth.getUser(token);
      if (!error && data?.user) {
        return { id: data.user.id, email: data.user.email || null };
      }
    }
  }

  // Mode 3 — cookie session (logged-in browser tab).
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (user) return { id: user.id, email: user.email || null };

  return null;
}
