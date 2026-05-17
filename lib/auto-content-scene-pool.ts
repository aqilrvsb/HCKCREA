// Auto Content scene-variant pool.
//
// The 24 UGC scene skills in lib/skills/ugc/scenes/ exist but Auto
// Content used to ignore them — every video defaulted to the same
// "person holds product at camera" template. This module:
//
//   1. Tags each scene with an attachment-type hint
//      (product | wearable | both) so we can filter the pool by what
//      the user uploaded.
//   2. Exposes pickScenes(count, prefer) that returns a randomly
//      sampled set of N distinct scenes, biased toward the requested
//      attachment type so a batch of clothes-uploads doesn't get a
//      mukbang scene.
//
// The classifier (PRODUCT vs WEARABLE per attachment) runs inside the
// master plan LLM call — no extra round-trip. This module just hands
// the model a pre-filtered scene catalog to choose from per video.

import type { Skill } from "@/lib/skills/types";
import { allSkills } from "@/lib/skills/registry";

export type AttachmentType = "product" | "wearable" | "both";

// Manual map per scene → which attachment types it suits. Derived
// from each skill's "Best for" hints — kept here (not on the skill
// itself) so we don't have to touch 24 skill files.
const SCENE_ATTACHMENT_MAP: Record<string, AttachmentType> = {
  // Pure PRODUCT scenes — consumables, holdable items, food/drink/skincare.
  "kitchen-sambal": "product",
  "gym-supplement": "product",
  "in-car-driving-cta": "product",
  "mukbang-food": "product",
  "office-vitamin": "product",
  "cafe-aspirational": "product",
  "stop-motion-clay": "product",
  "asmr-product": "product",
  "talking-product-3d": "product",
  "before-after-skin": "product",
  "hyper-motion-product": "product",
  "documentary-vox": "product",

  // Pure WEARABLE scenes — model wears / tries on the item.
  "virtual-try-on": "wearable",
  "grwm": "wearable",
  "mom-morning-routine": "wearable",

  // BOTH — work equally well for product or wearable.
  "confession-storytime": "both",
  "beach-sunset": "both",
  "foodie-reaction": "both",
  "vintage-vhs-unbox": "both",
  "unboxing": "both",
  "pov-date-night": "both",
  "street-vox-pop": "both",
  "comment-response": "both",
  "tutorial-how-to": "both",
};

export type ScenePoolItem = {
  id: string;
  title: string;
  body: string;
  attachmentType: AttachmentType;
};

function loadAllUgcScenes(): ScenePoolItem[] {
  return allSkills
    .filter((s: Skill) => s.kind === "scene" && s.tab === "ugc")
    .map((s: Skill) => ({
      id: s.id,
      title: s.title,
      body: s.body,
      attachmentType: SCENE_ATTACHMENT_MAP[s.id] || "both",
    }));
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Pick `count` distinct scenes biased toward `prefer`. If prefer is
// "both" or unknown, returns a balanced mix. If prefer is "product"
// or "wearable", weights ~70% to matching scenes + 30% "both" so the
// batch still has visual variety but stays on-topic.
//
// If count > available pool size, returns the whole pool shuffled.
export function pickScenes(
  count: number,
  prefer: AttachmentType = "both"
): ScenePoolItem[] {
  const all = loadAllUgcScenes();
  if (count <= 0) return [];

  const matching = all.filter((s) => s.attachmentType === prefer);
  const neutral = all.filter((s) => s.attachmentType === "both");
  const others = all.filter(
    (s) => s.attachmentType !== prefer && s.attachmentType !== "both"
  );

  let pool: ScenePoolItem[];
  if (prefer === "both") {
    pool = shuffle(all);
  } else {
    // 70% matching + neutral, 30% drawn from other (so wearable batch
    // still has the occasional product scene if user mixes uploads)
    pool = [...shuffle(matching), ...shuffle(neutral), ...shuffle(others)];
  }

  // De-dupe by id and slice to requested count
  const seen = new Set<string>();
  const out: ScenePoolItem[] = [];
  for (const s of pool) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
    if (out.length >= count) break;
  }
  return out;
}

// Compact one-line summary of a scene for the master-plan prompt.
// Used in the catalog block — the FULL body is injected per video
// when assigned, the summary is for the LLM to pick from.
export function sceneSummary(s: ScenePoolItem): string {
  // First non-empty line of body that isn't a heading is usually
  // "Best for:" — pull that as the hook.
  const firstUseful = s.body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("**Best for:**") || l.startsWith("Best for:")) ||
    s.body.split("\n").map((l) => l.trim()).find((l) => l.length > 10) ||
    "";
  return `${s.id} [${s.attachmentType}] — ${s.title}. ${firstUseful}`;
}
