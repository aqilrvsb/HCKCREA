import { createAdminClient } from "@/lib/supabase/admin";

// Motion / CLIPPER's AI editor (Claude on DragonAPI, model_motion) failed on every model it has — no GRSAI stand-in
// any more (lib/openrouter.ts NO_AUTO_FALLBACK), so the client's video stops with an error and its credit comes back.
// The admins get one WhatsApp about it (at most every 30 min), so an empty DragonAPI balance is topped up at once
// instead of being found days later.
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
      "⚠️ *PeningLab: AI editor (Claude / DragonAPI) GAGAL*",
      "",
      `Di: ${where}`,
      `Ralat: ${err}`,
      "",
      "Video klien sedang GAGAL (kredit dipulangkan) — tiada fallback GRSAI.",
      "Semak baki DragonAPI (newapi.dragon3api.com) dan top up.",
    ].join("\n"));
  } catch (e: any) {
    console.error("alertAiDown failed:", e?.message || e);
  }
}
