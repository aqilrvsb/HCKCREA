// ToAPIs (p10) credit watch — every video runs on ToAPIs since 2026-11-20, so an
// empty ToAPIs account means every client video fails. Two alerts, both to the
// admin WhatsApp group via notifyAdmins():
//
//   1. Low balance (early warning) — the toapis-balance cron reads the real
//      account balance from ToAPIs' public API and alerts when it is under
//      app_settings.toapis_low_balance_usd (default $5). Needs a ToAPIs *System
//      Access Token* (Account settings → System Access Token) saved in
//      app_settings.toapis_system_token — the sk- video key can't read the
//      account balance. Repeats at most every 6 h while still low; resets once
//      the balance is topped back above the line.
//   2. Out of credit (no token needed) — p10CreateVideo calls
//      alertToapisOutOfCredit() when ToAPIs rejects a submit for missing quota.
//      At most one alert per hour.
//
// Alert state lives in app_settings.toapis_balance_alert_state and is read
// straight from the DB (not the 60 s settings cache) so two instances don't
// both send the same alert.

import { getSetting } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAdmins } from "@/lib/whatsapp";

const BALANCE_URL = "https://api.toapis.com/api/v1/account/balance";
const STATE_KEY = "toapis_balance_alert_state";
const LOW_REPEAT_MS = 6 * 3600_000;
const OUT_REPEAT_MS = 3600_000;
const DEFAULT_THRESHOLD_USD = 5;

type AlertState = {
  low_alert_at?: string | null;
  out_alert_at?: string | null;
  last_remaining_usd?: number | null;
  checked_at?: string | null;
};

export type ToapisBalance =
  | { ok: true; remainingUsd: number; remainingCredits: number; usedUsd: number; creditsPerUsd: number }
  | { ok: false; error: string; notConfigured?: boolean };

async function readState(): Promise<AlertState> {
  const admin = createAdminClient();
  const { data } = await admin.from("app_settings").select("value").eq("key", STATE_KEY).maybeSingle();
  return ((data?.value as AlertState) || {}) as AlertState;
}

async function writeState(s: AlertState): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("app_settings")
    .upsert({ key: STATE_KEY, value: s, category: "general" }, { onConflict: "key" });
}

export async function getToapisThresholdUsd(): Promise<number> {
  const v = await getSetting<any>("toapis_low_balance_usd");
  const n = Number(v?.usd ?? v?.value ?? v);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD_USD;
}

/** Real ToAPIs account balance (needs the System Access Token). */
export async function getToapisAccountBalance(): Promise<ToapisBalance> {
  const v = await getSetting<any>("toapis_system_token");
  const token = String((typeof v === "string" ? v : v?.token) || "").trim();
  if (!token) return { ok: false, error: "toapis_system_token not set", notConfigured: true };
  try {
    const res = await fetch(BALANCE_URL, {
      headers: { Authorization: `Bearer ${token}`, "X-Locale": "en" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const j: any = await res.json().catch(() => null);
    if (!res.ok || j?.code !== 0 || !j?.data) {
      return { ok: false, error: `ToAPIs balance HTTP ${res.status} code ${j?.code ?? "?"}: ${String(j?.message || "").slice(0, 160)}` };
    }
    const d = j.data;
    return {
      ok: true,
      remainingUsd: Number(d.remaining_usd),
      remainingCredits: Number(d.remaining_credits),
      usedUsd: Number(d.used_usd),
      creditsPerUsd: Number(d.credits_per_usd),
    };
  } catch (e: any) {
    return { ok: false, error: `ToAPIs balance fetch failed: ${e?.message || e}` };
  }
}

/** Cron entry: read balance, WhatsApp admins when it is under the threshold. */
export async function checkToapisBalanceAndAlert(): Promise<Record<string, unknown>> {
  const [bal, threshold] = await Promise.all([getToapisAccountBalance(), getToapisThresholdUsd()]);
  if (!bal.ok) return { ok: false, error: bal.error, notConfigured: !!bal.notConfigured };

  const state = await readState();
  const now = Date.now();
  let alerted = false;

  if (bal.remainingUsd < threshold) {
    const last = state.low_alert_at ? Date.parse(state.low_alert_at) : 0;
    if (!last || now - last >= LOW_REPEAT_MS) {
      const sent = await notifyAdmins(
        [
          "⚠️ *PeningLab — Kredit ToAPIs rendah*",
          "",
          `Baki   : $${bal.remainingUsd.toFixed(2)} (${Math.round(bal.remainingCredits)} credits)`,
          `Paras  : bawah $${threshold.toFixed(2)}`,
          "",
          "Semua video (StoryBoard, Dialog UGC, Original Video, Editor, MCP) guna ToAPIs.",
          "Bila baki habis, video client akan GAGAL. Sila top up sekarang:",
          "https://toapis.com/dashboard",
        ].join("\n")
      ).catch(() => 0);
      alerted = sent > 0;
      if (alerted) state.low_alert_at = new Date(now).toISOString();
    }
  } else {
    // Topped up above the line → re-arm both alerts.
    state.low_alert_at = null;
    state.out_alert_at = null;
  }

  state.last_remaining_usd = bal.remainingUsd;
  state.checked_at = new Date(now).toISOString();
  await writeState(state);

  return { ok: true, remainingUsd: bal.remainingUsd, remainingCredits: bal.remainingCredits, thresholdUsd: threshold, alerted };
}

/** ToAPIs said "no quota" on a submit — alert immediately (max once an hour). */
export function isToapisOutOfCredit(err: string): boolean {
  return /insufficient|quota|not enough|\bbalance\b|余额|额度|\b402\b/i.test(err || "");
}

export async function alertToapisOutOfCredit(err: string): Promise<void> {
  try {
    const state = await readState();
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
    if (sent > 0) await writeState({ ...state, out_alert_at: new Date().toISOString() });
  } catch (e: any) {
    console.warn("[toapis-balance] out-of-credit alert failed:", e?.message);
  }
}
