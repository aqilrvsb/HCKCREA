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
// p4 is image-only (Grsai). Admin UI should hide p4 from video slot
// dropdowns to prevent runtime "p4 not supported for video" errors.
export type SlotProvider = "p1" | "p2-a" | "p2-b" | "p4" | "p5";

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
  return sanitizeSlots(s?.slots, DEFAULT_VIDEO_SLOTS, ["p1", "p2-a", "p2-b", "p5"]);
}

export async function getImageSlots(): Promise<CascadeSlots> {
  const s = await getSetting<{ slots: SlotProvider[] }>("image_cascade_slots");
  return sanitizeSlots(s?.slots, DEFAULT_IMAGE_SLOTS, ["p1", "p2-a", "p2-b", "p4", "p5"]);
}

// Round-robin starting slot.
//
// VIDEO: rotates across the 3 slots (true round-robin). Spreads load
// evenly across p2-A / p2-B / p5 because Veo capacity is the bottleneck.
//
// IMAGE: ALWAYS starts at slot 1 (Main) per user direction. Slots 2/3
// are pure fallback. Reason: image volume is lower and the slot 1 pick
// (p4/Grsai) is already the cheapest — rotating across p5/p2 would
// burn more $ per image with no resilience benefit since p4 outages
// are rare. Cascade still walks 2 → 3 → back to 1 if slot 1 fails.
export async function nextStartSlot(asset: "video" | "image"): Promise<number> {
  if (asset === "image") return 0;

  const admin = createAdminClient();

  // Path 1: Postgres sequence via RPC (requires migration 0036 DDL).
  try {
    const { data, error } = await admin.rpc("next_cascade_slot", {
      asset_name: asset,
    });
    if (!error && typeof data === "number") {
      return ((data - 1) % 3 + 3) % 3;
    }
  } catch {
    // fall through to path 2
  }

  // Path 2: read-modify-write on app_settings counter row. Idempotent
  // and forward-compatible with path 1 — if admin runs the migration
  // DDL later, path 1 takes over automatically.
  try {
    const key = asset === "video" ? "video_rotation_counter" : "image_rotation_counter";
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
    return (newCount - 1) % 3;
  } catch (e: any) {
    console.warn(`[cascade-rotation] nextStartSlot exception: ${e?.message}`);
    return 0;
  }
}

// Build the walk order for a given start slot. Walks through all 3
// slots AND retries the starting slot at the end (4 attempts total).
// The double-shot on the starting slot catches transient first-call
// failures (rate-limit blip, single dropped packet) without losing the
// cross-vendor fallback in between.
//   slots=[A,B,C], start=0 → [A, B, C, A]
//   slots=[A,B,C], start=1 → [B, C, A, B]
//   slots=[A,B,C], start=2 → [C, A, B, C]
export function walkOrder(slots: CascadeSlots, startIndex: number): SlotProvider[] {
  const start = ((startIndex % 3) + 3) % 3;
  return [
    slots[start],
    slots[(start + 1) % 3],
    slots[(start + 2) % 3],
    slots[start],
  ];
}

// Map a slot back to the "real" provider id stamped on history.metadata.provider
// so settle.ts knows which client to poll with. p2-a and p2-b both poll
// via p2GetStatus (same endpoint, just different API keys at submit time).
export function slotToProvider(slot: SlotProvider): "p1" | "p2" | "p4" | "p5" {
  if (slot === "p2-a" || slot === "p2-b") return "p2";
  return slot as "p1" | "p4" | "p5";
}
