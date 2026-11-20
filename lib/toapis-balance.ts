// ToAPIs (p10) out-of-credit alert — every video runs on ToAPIs since
// 2026-11-20, so an empty ToAPIs account means every client video fails.
//
// p10CreateVideo calls alertToapisOutOfCredit() when ToAPIs rejects a submit
// because the balance is not enough → WhatsApp to the admin group via
// notifyAdmins(). At most one alert per hour so a burst of rejected videos
// doesn't spam. No polling, no extra token — owner's choice (2026-11-20).
//
// Last-alert time lives in app_settings.toapis_balance_alert_state and is read
// straight from the DB (not the 60 s settings cache) so two instances don't
// both send the same alert.

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAdmins } from "@/lib/whatsapp";

const STATE_KEY = "toapis_balance_alert_state";
const OUT_REPEAT_MS = 3600_000;

/** True when a ToAPIs error means "not enough credit/quota". */
export function isToapisOutOfCredit(err: string): boolean {
  return /insufficient|quota|not enough|\bbalance\b|余额|额度|\b402\b/i.test(err || "");
}

export async function alertToapisOutOfCredit(err: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("app_settings").select("value").eq("key", STATE_KEY).maybeSingle();
    const state = ((data?.value as any) || {}) as { out_alert_at?: string | null };
    const last = state.out_alert_at ? Date.parse(state.out_alert_at) : 0;
    if (last && Date.now() - last < OUT_REPEAT_MS) return;

    const sent = await notifyAdmins(
      [
        "🚨 *PeningLab — Kredit ToAPIs HABIS*",
        "",
        "ToAPIs tolak video sebab baki tak cukup. Video client sedang GAGAL sekarang.",
        `Error: ${String(err).slice(0, 180)}`,
        "",
        "Top up segera: https://toapis.com/dashboard",
      ].join("\n")
    ).catch(() => 0);

    if (sent > 0) {
      await admin
        .from("app_settings")
        .upsert(
          { key: STATE_KEY, value: { ...state, out_alert_at: new Date().toISOString() }, category: "general" },
          { onConflict: "key" }
        );
    }
  } catch (e: any) {
    console.warn("[toapis-balance] out-of-credit alert failed:", e?.message);
  }
}
