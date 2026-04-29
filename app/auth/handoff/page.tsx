"use client";

// Client-side hash handoff for Supabase magic-link auth.
//
// /api/admin/impersonate generates a magic link that Supabase redirects
// to with the session tokens in the URL HASH:
//
//   https://peninglab.com/auth/handoff#access_token=...&refresh_token=...
//
// Server components can't read the hash (it never reaches the server),
// so /dashboard alone wouldn't pick it up. This page does:
//
//   1. createBrowserClient (with default detectSessionInUrl: true) —
//      it auto-parses the hash on mount and writes session cookies.
//   2. Calls auth.getSession() to make sure the parse + cookie write
//      finished, OR falls back to manual setSession() with the
//      hash tokens if needed.
//   3. Wipes the hash from the URL bar (security — tokens shouldn't
//      sit in browser history).
//   4. Redirects to ?next=<path> (defaults to /dashboard).
//
// Used by both impersonation AND any future Supabase email-link flows
// (password reset, magic-link login, OAuth callback).

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AuthHandoff() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = params.get("next") || "/dashboard";

    (async () => {
      try {
        const sb = createClient();

        // Step 1: parse the hash. Supabase ssr client does this
        // automatically, but we wait one tick so the cookies land.
        await new Promise((r) => setTimeout(r, 50));

        let session = (await sb.auth.getSession()).data.session;

        // Step 2: fallback — if auto-detect didn't pick up the hash
        // (older browsers, hash already consumed, etc.), parse it
        // manually and call setSession.
        if (!session && typeof window !== "undefined" && window.location.hash) {
          const hash = window.location.hash.replace(/^#/, "");
          const hashParams = new URLSearchParams(hash);
          const access_token = hashParams.get("access_token");
          const refresh_token = hashParams.get("refresh_token");
          if (access_token && refresh_token) {
            const res = await sb.auth.setSession({ access_token, refresh_token });
            if (res.error) throw res.error;
            session = res.data.session;
          }
        }

        if (!session) {
          throw new Error("No session — magic link may have expired or been consumed");
        }

        // Step 3: clean the hash so tokens don't linger in history.
        if (typeof window !== "undefined" && window.location.hash) {
          window.history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search
          );
        }

        // Step 4: hard navigate so the server picks up the new cookies
        // on the next render. router.push() keeps the client cache and
        // the dashboard server component would see the OLD session.
        window.location.replace(next);
      } catch (e: any) {
        setError(e?.message || "Sign-in failed");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] p-6">
      <div className="text-center">
        {error ? (
          <>
            <div className="text-red-400 font-bold mb-2">Sign-in failed</div>
            <div className="text-sm text-[var(--color-text-muted)] mb-4">
              {error}
            </div>
            <a
              href="/login"
              className="inline-block px-5 py-2 rounded-lg bg-orange text-black font-bold text-sm"
            >
              Go to login
            </a>
          </>
        ) : (
          <>
            <div className="font-bold text-base mb-1">Signing you in…</div>
            <div className="text-xs text-[var(--color-text-muted)]">
              You will be redirected to your dashboard.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
