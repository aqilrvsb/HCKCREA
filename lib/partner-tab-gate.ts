// Server-side PARTNER tab enforcement. The client UI already hides tabs a
// partner didn't grant, but a technical user could still POST directly to a
// generate route. This gate closes that hole: it denies a generation whose tab
// the user's partner has hidden. Only PARTNER clients are gated — every other
// account is always allowed (their tabs aren't partner-controlled).

import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";
import { isPartnerGroup, partnerSettingsKey, type PartnerConfig } from "@/lib/partners";

/** Is `tabKey` allowed for this user? True for non-partner clients; for a
 *  partner's client, true only when the tab is in the partner's visible_tabs
 *  (or the partner set no restriction). */
export async function isTabAllowedForUser(userId: string, tabKey: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("settings").eq("id", userId).maybeSingle();
  const g = (data?.settings as any)?.managed_group as string | undefined;
  if (!isPartnerGroup(g)) return true; // not a partner's client → no gate
  const cfg = await getSetting<PartnerConfig>(partnerSettingsKey(g as string));
  const vt = cfg?.visible_tabs;
  if (!Array.isArray(vt) || vt.length === 0) return true; // partner set no restriction
  return vt.includes(tabKey);
}
