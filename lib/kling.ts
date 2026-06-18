// Kling v3 motion-control (Livehost "Template Body") — isolated provider +
// cascade. Kling is Crun-only, so the cascade walks Crun API keys: a main key
// then fallback key(s). Admin-tunable via app_settings:
//   kling_main_key      { key }          — primary Crun key (default = p2_key)
//   kling_fallback_keys { keys }         — comma/newline list (default = p2_key_b)
//   kling_rate          { per_second }    — RM per second of output (default 0.10)
//   kling_default_mode  { mode }         — "std" | "pro" (default pro)
//
// Settlement reuses the shared settle path (lib/settle.ts), which resolves
// the kling slot's Crun key for status polls — so the callback + cron poller
// + client status poll all settle these rows idempotently.

import { p2CreateTask, p2GetStatus } from "@/lib/p2";
import { getP2Config, getSettings } from "@/lib/settings";

export const KLING_MODEL = "kling/v3-motion-control";

export type KlingSlot = { key: string; label: string };

// Per-SECOND rate (RM). Kling clips follow the reference-video length, so the
// caller multiplies this by the motion video's duration.
export async function getKlingRate(): Promise<number> {
  const s = await getSettings(["kling_rate"]);
  const r = parseFloat((s.kling_rate?.per_second as string) ?? (s.kling_rate?.rate as string) ?? "");
  return Number.isFinite(r) && r >= 0 ? r : 0.1;
}

export async function getKlingDefaultMode(): Promise<"std" | "pro"> {
  const s = await getSettings(["kling_default_mode"]);
  return (s.kling_default_mode?.mode as string) === "std" ? "std" : "pro";
}

// Ordered cascade slots: main key first, then fallback key(s). Falls back to
// the Crun A / B keys when the kling-specific settings are unset.
export async function getKlingSlots(): Promise<KlingSlot[]> {
  const cfg = await getP2Config();
  const s = await getSettings(["kling_main_key", "kling_fallback_keys"]);
  const mainKey = (s.kling_main_key?.key as string) || cfg.key;
  const fbRaw = (s.kling_fallback_keys?.keys as string) || "";
  const fb = fbRaw.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const fallback = fb.length ? fb : cfg.keyB ? [cfg.keyB] : [];

  const slots: KlingSlot[] = [];
  if (mainKey) slots.push({ key: mainKey, label: "kling-main" });
  fallback.forEach((k, i) => {
    if (k && k !== mainKey && !slots.some((sl) => sl.key === k)) {
      slots.push({ key: k, label: `kling-fb${i + 1}` });
    }
  });
  return slots;
}

export type KlingCreateResult = {
  ok: boolean;
  taskId?: string;
  keyUsed?: string;
  slot?: string;
  error?: string;
  tierLog: string[];
};

// Create with cascade: try each slot's Crun key until one accepts the task.
export async function klingCreateWithCascade(input: {
  userId: string;
  imageUrl: string;
  videoUrl: string;
  prompt?: string;
  mode?: "std" | "pro";
  characterOrientation?: "image" | "video";
  keepOriginalSound?: boolean;
}): Promise<KlingCreateResult> {
  const slots = await getKlingSlots();
  const tierLog: string[] = [];
  if (!slots.length) return { ok: false, error: "Kling not configured (no Crun key)", tierLog };

  for (const slot of slots) {
    try {
      const r = await p2CreateTask({
        model: KLING_MODEL,
        forceP2: true,
        apiKeyOverride: slot.key,
        userId: input.userId,
        imageUrls: [input.imageUrl],
        videoUrls: [input.videoUrl],
        prompt: input.prompt,
        extra: {
          character_orientation: input.characterOrientation === "image" ? "image" : "video",
          mode: input.mode === "std" ? "std" : "pro",
          keep_original_sound: input.keepOriginalSound !== false,
        },
      });
      tierLog.push(`${slot.label}: ${r.ok ? "ok" : r.error || "fail"}`);
      if (r.ok && r.task_id) {
        return { ok: true, taskId: r.task_id, keyUsed: slot.key, slot: slot.label, tierLog };
      }
    } catch (e: any) {
      tierLog.push(`${slot.label}: ${e?.message || "error"}`);
    }
  }
  return { ok: false, error: tierLog.join(" · ") || "All Kling slots failed", tierLog };
}

// Resolve the Crun key for a stored slot LABEL (we never store the raw key
// in history.metadata — it's RLS-readable by the client).
export async function getKlingKeyForSlot(label?: string): Promise<string | undefined> {
  const slots = await getKlingSlots();
  return slots.find((s) => s.label === label)?.key || slots[0]?.key;
}

// Poll a Kling task with the SAME Crun key that created it.
export async function klingGetStatus(taskId: string, keyUsed?: string) {
  return p2GetStatus(taskId, "p2", keyUsed || undefined);
}
