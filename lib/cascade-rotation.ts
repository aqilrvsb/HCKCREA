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

// Atomic round-robin counter via Postgres sequence. Returns the 0-indexed
// slot to START at for this task. Subsequent fallback slots are computed
// by walking forward cyclically.
//
// On any DB error we fall back to 0 — every task tries slot 1 first,
// which degrades to the pre-rotation behavior. Better than throwing.
export async function nextStartSlot(asset: "video" | "image"): Promise<number> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("next_cascade_slot", {
      asset_name: asset,
    });
    if (error || typeof data !== "number") {
      console.warn(
        `[cascade-rotation] nextval failed for ${asset}: ${error?.message || "no data"}`
      );
      return 0;
    }
    // Postgres sequences start at 1. Convert to 0-indexed slot via mod.
    return ((data - 1) % 3 + 3) % 3;
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
