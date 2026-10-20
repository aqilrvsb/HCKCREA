// Motion "Custom Style" — the VGC Prompt Vault (Coach Am) generated directly:
// the filled vault prompt + the client's material go to modal_vgc.py, where
// Claude Code (Claude Sonnet via DragonAPI) builds and renders the video, as
// the vault's students do by hand in Claude Code.
//
// One History card = one VGC project: its Modal workspace + Claude Code
// session carry every step of a flow (Idea Clarity / Reference), so step 2
// continues step 1's conversation. A step either renders a preview (Fast
// Track, "Bina V1", "Improve V2", "Bina Preview") or answers in text.

import { getSetting } from "@/lib/settings";

export type VgcPricing = { video: number; text: number };
/** Defaults until admin sets app_settings.vgc_pricing = { video, text } (RM per run). */
const DEFAULT_PRICING: VgcPricing = { video: 5, text: 1 };

export async function vgcPricing(): Promise<VgcPricing> {
  const p = await getSetting<Partial<VgcPricing>>("vgc_pricing").catch(() => null);
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return { video: num(p?.video, DEFAULT_PRICING.video), text: num(p?.text, DEFAULT_PRICING.text) };
}

/** Does this vault step build + render a preview (vs answer in text)? */
export function vgcStepRendersVideo(stepId: string, title: string): boolean {
  return stepId === "fast-track" || /\b(bina\s*(v1|preview)|improve\s*v2|fast\s*track)\b/i.test(title);
}

/** Flow of a vault step id: Fast Track, Idea Clarity ("guided") or Reference → DNA. */
export function vgcFlow(stepId: string): "fast" | "guided" | "reference" | null {
  if (stepId === "fast-track") return "fast";
  if (/^step-\d$/.test(stepId)) return "guided";
  if (/^reference-\d$/.test(stepId)) return "reference";
  return null;
}

export type VgcStep = {
  id: string;
  title: string;
  video: boolean;
  url?: string | null;
  poster?: string | null;
  summary?: string;
  needs_input?: boolean;
  at?: string;
  sec?: number | null;
  charged?: number;
};

export type VgcMeta = {
  flow: "fast" | "guided" | "reference";
  session_id?: string | null;
  current?: { id: string; title: string; video: boolean; prompt: string };
  steps: VgcStep[];
  spent: number;
  /** AI voice-over for the running step: the voice + the run's token for /api/vgc/tts */
  tts?: { voice: string; token: string; calls: number } | null;
};
