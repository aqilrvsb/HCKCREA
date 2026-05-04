import { NextResponse } from "next/server";
import { getStorytellingPricing, getStorytellingVoiceSpeed } from "@/lib/settings";

// GET /api/fairytale/pricing — returns the current admin-set rates so
// the Storytelling wizard can display an estimated total cost before
// the user clicks Generate. Also returns the admin-tuned narration
// playback speed so the live preview + Modal merge use the same value.
// Public (no auth) since neither rates nor speed are secret.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [pricing, voiceSpeed] = await Promise.all([
    getStorytellingPricing(),
    getStorytellingVoiceSpeed(),
  ]);
  return NextResponse.json({ ok: true, ...pricing, voice_speed: voiceSpeed });
}
