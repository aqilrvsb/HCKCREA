import { createClient as createSbClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Bearer-token aware auth for the Chrome extension. The extension can't
// reliably forward peninglab.com session cookies (Chrome restricts
// third-party cookie sharing for extensions), so it logs into Supabase
// directly with the anon key, gets an access_token, and sends that as
// `Authorization: Bearer <token>` on every API call.
//
// This helper resolves the user from EITHER:
//   1. Authorization: Bearer <access_token> header (extension flow)
//   2. Standard Supabase session cookies (logged-in dashboard tab)
//
// Returns null if neither yields a valid user. Callers respond 401.

export async function authExtensionUser(req: Request): Promise<{
  id: string;
  email: string | null;
} | null> {
  // Try Bearer first — extension always sends this.
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      // Use a dedicated client just to validate the token. We don't need
      // the cookie store for this — the access_token IS the credential.
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

  // Fall back to cookie session (works when called from a browser tab
  // already logged into peninglab.com — useful for testing endpoints
  // directly without the extension).
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (user) return { id: user.id, email: user.email || null };

  return null;
}
