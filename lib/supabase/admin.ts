import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS. NEVER use this in client components or
// expose it through `'use client'` files. Only call from API routes / server
// actions / route handlers / cron / webhooks.
//
// Module-level singleton: the service-role client is stateless (no session,
// no autoRefresh) so re-using one instance across calls is safe and saves the
// constructor cost (~5-15ms) on every request.
let _admin: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  _admin = createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _admin;
}
