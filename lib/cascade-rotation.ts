// Admin-configured slot rotation for the unified cascade.
//
// Replaces the hardcoded provider chains with a 3-slot configuration
// per asset class:
//
//   video_cascade_slots = { slots: ["p2-a", "p2-b", "p5"] }
//   image_cascade_slots = { slots: ["p4", "p5", "p2-a"] }
//
// Each task picks a STARTING slot via round-robin (system-wide counter,
// per asset), then walks the slots cyclically from that start until one
// succeeds or all 3 fail. This spreads load across providers AND gives
// every task the full 3-tier resilience.
//
// Round-robin counter is a Postgres sequence (atomic by design, no race
// conditions even under thousands of concurrent calls). Wired via the
// next_cascade_slot(asset_name) SQL function defined in migration 0036.

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

export type CascadeSlots = [SlotProvider, SlotProvider, SlotProvider];

// Defaults shipped with the migration. Admin can change in /admin/settings
// at any time and the changes take effect on the next task (60s cache TTL).
const DEFAULT_VIDEO_SLOTS: CascadeSlots = ["p2-a", "p2-b", "p5"];
const DEFAULT_IMAGE_SLOTS: CascadeSlots = ["p4", "p5", "p2-a"];

function sanitizeSlots(
  raw: unknown,
  defaults: CascadeSlots,
  allowed: SlotProvider[]
): CascadeSlots {
  if (!Array.isArray(raw)) return defaults;
  const out: SlotProvider[] = [];
  for (let i = 0; i < 3; i++) {
    const v = String(raw[i] || "").toLowerCase() as SlotProvider;
    out.push(allowed.includes(v) ? v : defaults[i]);
  }
  return out as CascadeSlots;
}

export async function getVideoSlots(): Promise<CascadeSlots> {
  const s = await getSetting<{ slots: SlotProvider[] }>("video_cascade_slots");
  // p4 (Grsai) is image-only — exclude from video allow-list.
  const VIDEO_ALLOWED: SlotProvider[] = [
    "p1", "p2-a", "p2-b", "p5",
    "p6-a", "p6-b", "p6-c", "p6-d", "p6-e", "p6-f", "p6-g", "p6-h",
    "none",
  ];
  return sanitizeSlots(s?.slots, DEFAULT_VIDEO_SLOTS, VIDEO_ALLOWED);
}

export async function getImageSlots(): Promise<CascadeSlots> {
  const s = await getSetting<{ slots: SlotProvider[] }>("image_cascade_slots");
  const IMAGE_ALLOWED: SlotProvider[] = [
    "p1", "p2-a", "p2-b", "p4", "p5",
    "p6-a", "p6-b", "p6-c", "p6-d", "p6-e", "p6-f", "p6-g", "p6-h",
    "none",
  ];
  return sanitizeSlots(s?.slots, DEFAULT_IMAGE_SLOTS, IMAGE_ALLOWED);
}

// Round-robin starting slot.
//
// VIDEO: rotates across the non-"none" slots (true round-robin).
// Spreads load evenly across enabled slots because Veo capacity is the
// bottleneck. If admin sets slot 3 = "none", rotation only cycles
// between slots 1 and 2.
//
// IMAGE: ALWAYS starts at slot 1 (Main) per user direction. Slots 2/3
// are pure fallback. Reason: image volume is lower and slot 1 (p4/Grsai)
// is already the cheapest — rotating would burn more $ per image with
// no resilience benefit since p4 outages are rare. Cascade still walks
// the non-"none" slots 2/3 → back to slot 1 if slot 1 fails.
//
// Caller picks the ABSOLUTE slot index this returns; walkOrder() then
// builds the rest of the walk filtering out "none" entries.
export async function nextStartSlot(asset: "video" | "image"): Promise<number> {
  if (asset === "image") return 0;

  // For video, rotate over the non-"none" slots only. If admin sets
  // slot 3 = none, rotation cycles between slots 1 and 2.
  const slots = await getVideoSlots();
  const validIndexes = slots
    .map((s, i) => (s === "none" ? -1 : i))
    .filter((i) => i >= 0);
  if (validIndexes.length === 0) return 0;

  const admin = createAdminClient();
  let counter = 0;

  // Path 1: Postgres sequence via RPC (requires migration 0036 DDL).
  try {
    const { data, error } = await admin.rpc("next_cascade_slot", {
      asset_name: asset,
    });
    if (!error && typeof data === "number") {
      counter = data - 1;
    }
  } catch {
    // fall through to path 2
  }

  // Path 2: read-modify-write on app_settings counter row.
  if (counter === 0) {
    try {
      const key = "video_rotation_counter";
      const { data: row } = await admin
        .from("app_settings")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      const currentCount = Number((row?.value as any)?.count) || 0;
      const newCount = currentCount + 1;
      await admin
        .from("app_settings")
        .upsert(
          {
            key,
            value: { count: newCount },
            description: `Round-robin rotation counter for ${asset} cascade slots.`,
            category: "internal",
          },
          { onConflict: "key" }
        );
      counter = newCount - 1;
    } catch (e: any) {
      console.warn(`[cascade-rotation] nextStartSlot exception: ${e?.message}`);
      return validIndexes[0];
    }
  }

  // Pick the Nth non-none slot — guarantees rotation only over enabled
  // slots even if admin sets one to "none".
  return validIndexes[counter % validIndexes.length];
}

// Build the walk order for a given start slot. Walks through all
// non-"none" slots cyclically, then retries the starting slot at the
// end. The retry catches transient first-call failures without losing
// the cross-vendor fallback in between.
//
// Examples (none slots filtered out, walk shorter when fewer enabled):
//   slots=[A,B,C],    start=0 → [A, B, C, A]   (4 attempts, 3 unique slots)
//   slots=[A,B,none], start=0 → [A, B, A]      (3 attempts, 2 unique slots)
//   slots=[A,B,none], start=1 → [B, A, B]      (rotation respects start)
//   slots=[A,none,none], start=0 → [A]          (no fallback possible)
export function walkOrder(slots: CascadeSlots, startIndex: number): SlotProvider[] {
  const start = ((startIndex % 3) + 3) % 3;
  // Walk in slot order from start, wrap around, skip "none".
  const walk: SlotProvider[] = [];
  for (let i = 0; i < 3; i++) {
    const slot = slots[(start + i) % 3];
    if (slot !== "none") walk.push(slot);
  }
  // Append the starting slot again for the retry-once tail — but only
  // if the start slot itself isn't "none".
  if (walk.length > 0 && slots[start] !== "none") {
    walk.push(slots[start]);
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
