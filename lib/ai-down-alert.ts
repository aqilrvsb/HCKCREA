import { createAdminClient } from "@/lib/supabase/admin";

// Motion / CLIPPER's AI editor (Claude Sonnet 5.5, model_motion: code28 first, DragonAPI as fallback) failed on every
// model it has — no GRSAI stand-in any more (lib/openrouter.ts NO_AUTO_FALLBACK), so the client's video stops with an
// error and its credit comes back. The admins get one WhatsApp about it (at most every 30 min), so an empty balance is
// topped up at once instead of being found days later.
const KEY = "ai_down_alert";
const EVERY_MS = 30 * 60_000;

export async function alertAiDown(where: string, error: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
    const v = typeof data?.value === "string" ? JSON.parse(data.value) : data?.value;
    if (Date.now() - (Date.parse(String(v?.at || "")) || 0) < EVERY_MS) return;
    const err = String(error || "").replace(/\s+/g, " ").slice(0, 300);
    await admin.from("app_settings").upsert({ key: KEY, value: { at: new Date().toISOString(), where, error: err }, category: "system",
      updated_at: new Date().toISOString() });
    const { notifyAdmins } = await import("@/lib/whatsapp");
    await notifyAdmins([
      "⚠️ *PeningLab: AI editor (Claude — code28 + DragonAPI) GAGAL*",
      "",
      `Di: ${where}`,
      `Ralat: ${err}`,
      "",
      "Video klien sedang GAGAL (kredit dipulangkan) — kedua-dua code28 dan DragonAPI tidak menjawab.",
      "Semak baki code28 (code28.ccwu.cc) dan DragonAPI (newapi.dragon3api.com), dan top up.",
    ].join("\n"));
  } catch (e: any) {
    console.error("alertAiDown failed:", e?.message || e);
  }
}

// A relay refused our key (balance out / key disabled) but the cascade carried on to the next provider, so videos
// still work — on the dearer one. One WhatsApp per provider at most every 3 h, so it gets topped up.
const PROVIDER_LABEL: Record<string, { name: string; site: string; fallback: string }> = {
  code28: { name: "code28", site: "code28.ccwu.cc", fallback: "DragonAPI (lebih mahal)" },
};
export async function alertProviderKeyRefused(provider: string, error: string): Promise<void> {
  const label = PROVIDER_LABEL[provider];
  if (!label) return;
  const key = `${provider}_alert_at`;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
    const v = typeof data?.value === "string" ? JSON.parse(data.value) : data?.value;
    if (Date.now() - (Date.parse(String(v?.at || "")) || 0) < 3 * 3600_000) return;
    const now = new Date().toISOString();
    const err = String(error || "").replace(/\(request id:[^)]*\)/i, "").replace(/\s+/g, " ").trim().slice(0, 200);
    await admin.from("app_settings").upsert({ key, value: { at: now, error: err }, category: "system", updated_at: now });
    const { notifyAdmins } = await import("@/lib/whatsapp");
    await notifyAdmins([
      `⚠️ *PeningLab — ${label.name} menolak permintaan*`,
      `Motion / CLIPPER masih berjalan, tetapi kini guna ${label.fallback}. Biasanya baki ${label.name} habis — sila topup di ${label.site}.`,
      `Ralat: ${err}`,
    ].join("\n"));
  } catch (e: any) {
    console.error("alertProviderKeyRefused failed:", e?.message || e);
  }
}
