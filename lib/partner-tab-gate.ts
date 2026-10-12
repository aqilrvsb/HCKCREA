// Server-side PER-CLIENT tab enforcement. The client UI hides tabs the client
// wasn't granted, but a technical user could still POST directly to a generate
// route. This gate closes that hole: it denies a generation whose tab the
// client is not allowed. The allow-list lives on the client's own profile
// (profiles.settings.visible_tabs), set by their partner/reseller in Manage
// Users. Any user with no visible_tabs (the vast majority) is unrestricted.

import { createAdminClient } from "@/lib/supabase/admin";

/** Is `tabKey` allowed for this user? True when the user has no per-client
 *  visible_tabs restriction; otherwise true only when tabKey is in that list. */
export async function isTabAllowedForUser(userId: string, tabKey: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("settings").eq("id", userId).maybeSingle();
  const vt = (data?.settings as any)?.visible_tabs;
  if (!Array.isArray(vt) || vt.length === 0) return true; // no restriction
  return vt.includes(tabKey);
}

// A mode inside an allowed tab can be switched off per client too —
// profiles.settings.hidden_modes, e.g. ["motion-ad"] hides Motion's "Buat
// Iklan" (Edit Video stays). Absent / empty = nothing hidden.
export async function hiddenModesForUser(userId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("settings").eq("id", userId).maybeSingle();
  const hm = (data?.settings as any)?.hidden_modes;
  return Array.isArray(hm) ? hm.map((x: unknown) => String(x)) : [];
}
