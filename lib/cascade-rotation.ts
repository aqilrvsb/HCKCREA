// Admin-configured slot rotation — main + fallback architecture.
//
// Each asset class has TWO independent slot lists:
//   <asset>_main_slots     — round-robin source, walks all on failure
//   <asset>_fallback_slots — tried in order after all mains fail
//
// Plus dynamic counts (admin can grow / shrink the lists):
//   <asset>_main_count, <asset>_fallback_count   (defaults 10 each)
//
// Walk order on each task:
//   1. Round-robin picks main start index S
//   2. Try main[S] → main[S+1] → ... wrap around all mains
//   3. If all mains fail → fallback[0] → fallback[1] → ... in order
//   4. "none" entries skipped (don't count)
//   5. All entries failed → row stays failed
//
// Round-robin counter is a Postgres app_settings row (atomic
// read-modify-write under typical load).

import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";

// Slot identifiers — each maps to a specific provider + key combination.
// p4 is image-only (Grsai). "none" = slot disabled (admin chose to skip
// it) — excluded from both round-robin rotation AND fallback walk.
export type SlotProvider =
  | "p1"
  | "p2-a" | "p2-b"
  | "p4"
  | "p5"
  | "p6-a" | "p6-b" | "p6-c" | "p6-d" | "p6-e" | "p6-f" | "p6-g" | "p6-h"
  | "none";

export const VIDEO_ALLOWED: SlotProvider[] = [
  "p1", "p2-a", "p2-b", "p5",
  "p6-a", "p6-b", "p6-c", "p6-d", "p6-e", "p6-f", "p6-g", "p6-h",
  "none",
];

export const IMAGE_ALLOWED: SlotProvider[] = [
  "p1", "p2-a", "p2-b", "p4", "p5",
  "p6-a", "p6-b", "p6-c", "p6-d", "p6-e", "p6-f", "p6-g", "p6-h",
  "none",
];

const DEFAULT_COUNT = 10;
const DEFAULT_VIDEO_MAIN: SlotProvider[] = ["p6-a", "p6-b", "p6-c", "p2-a", "p2-b", "none", "none", "none", "none", "none"];
const DEFAULT_VIDEO_FALLBACK: SlotProvider[] = ["p5", "p1", "none", "none", "none", "none", "none", "none", "none", "none"];
const DEFAULT_IMAGE_MAIN: SlotProvider[] = ["p4", "p5", "p6-a", "p2-a", "none", "none", "none", "none", "none", "none"];
const DEFAULT_IMAGE_FALLBACK: SlotProvider[] = ["p2-b", "p1", "none", "none", "none", "none", "none", "none", "none", "none"];

function sanitizeSlotList(
  raw: unknown,
  count: number,
  allowed: SlotProvider[],
  defaults: SlotProvider[]
): SlotProvider[] {
  const out: SlotProvider[] = [];
  const arr = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < count; i++) {
    const v = String(arr[i] || defaults[i] || "none").toLowerCase() as SlotProvider;
    out.push(allowed.includes(v) ? v : "none");
  }
  return out;
}

async function getSlotCount(key: string): Promise<number> {
  const s = await getSetting<{ count: number }>(key);
  const n = Number(s?.count);
  return Number.isFinite(n) && n >= 1 && n <= 50 ? Math.floor(n) : DEFAULT_COUNT;
}

export async function getVideoMainSlots(): Promise<SlotProvider[]> {
  const [count, raw] = await Promise.all([
    getSlotCount("video_main_count"),
    getSetting<{ slots: SlotProvider[] }>("video_main_slots"),
  ]);
  return sanitizeSlotList(raw?.slots, count, VIDEO_ALLOWED, DEFAULT_VIDEO_MAIN);
}

export async function getVideoFallbackSlots(): Promise<SlotProvider[]> {
  const [count, raw] = await Promise.all([
    getSlotCount("video_fallback_count"),
    getSetting<{ slots: SlotProvider[] }>("video_fallback_slots"),
  ]);
  return sanitizeSlotList(raw?.slots, count, VIDEO_ALLOWED, DEFAULT_VIDEO_FALLBACK);
}

export async function getImageMainSlots(): Promise<SlotProvider[]> {
  const [count, raw] = await Promise.all([
    getSlotCount("image_main_count"),
    getSetting<{ slots: SlotProvider[] }>("image_main_slots"),
  ]);
  return sanitizeSlotList(raw?.slots, count, IMAGE_ALLOWED, DEFAULT_IMAGE_MAIN);
}

export async function getImageFallbackSlots(): Promise<SlotProvider[]> {
  const [count, raw] = await Promise.all([
    getSlotCount("image_fallback_count"),
    getSetting<{ slots: SlotProvider[] }>("image_fallback_slots"),
  ]);
  return sanitizeSlotList(raw?.slots, count, IMAGE_ALLOWED, DEFAULT_IMAGE_FALLBACK);
}

// Atomic round-robin counter for either MAIN or FALLBACK slot list.
// Two separate counters per asset so main/fallback rotation are
// independent. Skips "none" entries — counter only advances across
// enabled slots so distribution stays even regardless of how many
// are disabled.
async function nextRoundRobinIndex(
  asset: "video" | "image",
  kind: "main" | "fallback",
  slots: SlotProvider[]
): Promise<number> {
  const validIdxs = slots
    .map((s, i) => (s === "none" ? -1 : i))
    .filter((i) => i >= 0);
  if (validIdxs.length === 0) return 0;

  const admin = createAdminClient();
  const counterKey =
    kind === "main"
      ? (asset === "video" ? "video_rotation_counter" : "image_rotation_counter")
      : (asset === "video" ? "video_fallback_counter" : "image_fallback_counter");
  let counter = 0;

  try {
    const { data: row } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", counterKey)
      .maybeSingle();
    const currentCount = Number((row?.value as any)?.count) || 0;
    const newCount = currentCount + 1;
    await admin
      .from("app_settings")
      .upsert(
        {
          key: counterKey,
          value: { count: newCount },
          description: `Round-robin counter for ${asset} ${kind} slots.`,
          category: "internal",
        },
        { onConflict: "key" }
      );
    counter = newCount - 1;
  } catch (e: any) {
    console.warn(`[cascade-rotation] nextRoundRobinIndex(${kind}) exception: ${e?.message}`);
    return validIdxs[0];
  }

  return validIdxs[counter % validIdxs.length];
}

export async function nextMainStartIndex(
  asset: "video" | "image",
  mainSlots: SlotProvider[]
): Promise<number> {
  return nextRoundRobinIndex(asset, "main", mainSlots);
}

export async function nextFallbackStartIndex(
  asset: "video" | "image",
  fallbackSlots: SlotProvider[]
): Promise<number> {
  return nextRoundRobinIndex(asset, "fallback", fallbackSlots);
}

// Build the full walk order for a task:
//   1. Mains starting at startIdx, wrapping cyclically through ALL mains
//   2. Then fallbacks in order 0..M-1
//   3. "none" entries skipped throughout
//
// No retry-on-start tail — with up to 20 entries the user gets plenty
// of attempts already.
export function walkOrder(
  mainSlots: SlotProvider[],
  fallbackSlots: SlotProvider[],
  startIdx: number
): SlotProvider[] {
  const walk: SlotProvider[] = [];
  const N = mainSlots.length;
  const start = N > 0 ? ((startIdx % N) + N) % N : 0;
  for (let i = 0; i < N; i++) {
    const slot = mainSlots[(start + i) % N];
    if (slot !== "none") walk.push(slot);
  }
  for (const slot of fallbackSlots) {
    if (slot !== "none") walk.push(slot);
  }
  return walk;
}

// Map a slot back to the "real" provider id stamped on history.metadata.provider
// so settle.ts knows which client to poll with. p2-a and p2-b both poll
// via p2GetStatus (same endpoint, just different API keys at submit time).
// "none" should never reach here (filtered earlier) but fall back to p2
// just in case.
export function slotToProvider(slot: SlotProvider): "p1" | "p2" | "p4" | "p5" | "p6" {
  if (slot === "p2-a" || slot === "p2-b") return "p2";
  if (slot.startsWith("p6-")) return "p6";
  if (slot === "none") return "p2";
  return slot as "p1" | "p4" | "p5";
}

// ─────────────────────────────────────────────────────────────────
// Legacy wrappers — old callers (3-slot CascadeSlots tuple) keep
// working by collapsing the new main+fallback lists into a 3-tuple
// for type compatibility. video-cascade.ts + image-cascade.ts use
// the new helpers directly so these are admin-UI-only shims.
// ─────────────────────────────────────────────────────────────────
export type CascadeSlots = [SlotProvider, SlotProvider, SlotProvider];
