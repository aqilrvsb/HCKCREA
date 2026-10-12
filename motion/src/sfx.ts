// Sound design rules: every visual event → one or more SFX layers.
// Library files live in public/sfx-lib (CC0, see LICENSES.md); names that are
// missing from the bundle fall back to the procedural set in public/sfx
// (scripts/sfx.mjs), so a render never references a file that isn't there.
import { staticFile } from 'remotion';
import available from './sfx-available.json';
import type { Style } from './types';

export type SfxEventName =
  | 'hook' | 'headline' | 'note' | 'tag' | 'stamp' | 'chip' | 'tape' | 'scribble' | 'price' | 'check'
  | 'emoji' | 'counter' | 'bigword' | 'callout' | 'arrow' | 'stars' | 'cta'
  | 'broll_full' | 'broll_pip' | 'fact' | 'zoom' | 'rehook' | 'scene' | 'hero'
  | 'circle' | 'underline' | 'point' | 'gif' | 'confetti' | 'cut';

type Layer = { lib: string[]; proc: string; vol: number; len?: number; delay?: number; gempakOnly?: boolean };

// Variants rotate by seed so repeated events don't sound identical. rsfx_* =
// CC0 sounds from @remotion/sfx (fetched into the library at build time).
const RULES: Record<SfxEventName, Layer[]> = {
  hook: [
    { lib: ['impact_1', 'impact_2'], proc: 'thump', vol: 0.55 },
    { lib: ['bass_drop_1'], proc: 'thump', vol: 0.4, gempakOnly: true },
    { lib: ['glitch_1', 'glitch_2', 'glitch_3', 'glitch_4'], proc: 'swoosh', vol: 0.22, delay: 2, gempakOnly: true },
  ],
  headline: [{ lib: ['impact_2', 'impact_1', 'thud_1'], proc: 'thump', vol: 0.42 }, { lib: ['swipe_1', 'rsfx_whip'], proc: 'swoosh', vol: 0.2, gempakOnly: true }],
  note: [{ lib: ['pop_1', 'pop_2', 'pop_5', 'slide_1'], proc: 'pop', vol: 0.36 }],
  tag: [{ lib: ['stamp_1', 'thud_2'], proc: 'stamp', vol: 0.34 }],
  stamp: [{ lib: ['stamp_1'], proc: 'stamp', vol: 0.55 }, { lib: ['boom_1'], proc: 'thump', vol: 0.25, gempakOnly: true }],
  chip: [{ lib: ['pop_2', 'pop_4', 'pop_6', 'rsfx_click'], proc: 'pop', vol: 0.3 }, { lib: ['swipe_2', 'slide_2'], proc: 'swoosh', vol: 0.14, gempakOnly: true }],
  tape: [{ lib: ['paper_1', 'rsfx_page_turn'], proc: 'paper', vol: 0.34 }],
  scribble: [{ lib: ['underline_3', 'circle_3'], proc: 'marker', vol: 0.24, len: 40 }],
  price: [
    { lib: ['cash_1', 'cash_2', 'cash_3'], proc: 'sparkle', vol: 0.5, len: 60 },
    { lib: ['sparkle_1', 'twinkle_2'], proc: 'sparkle', vol: 0.3, delay: 6 },
  ],
  check: [{ lib: ['ding_1', 'tick_1', 'ding_3', 'ding_4'], proc: 'tick', vol: 0.34 }],
  emoji: [{ lib: ['pop_3', 'boing_1', 'boing_2', 'boing_3'], proc: 'pop', vol: 0.36 }],
  counter: [{ lib: ['coins_1'], proc: 'tick', vol: 0.34, len: 50 }],
  bigword: [{ lib: ['impact_1', 'impact_2'], proc: 'thump', vol: 0.55 }, { lib: ['whoosh_1', 'whoosh_2', 'whoosh_4', 'rsfx_whoosh'], proc: 'whoosh', vol: 0.28, delay: -3 }],
  callout: [{ lib: ['pop_4', 'pop_1', 'pop_5'], proc: 'pop', vol: 0.34 }],
  arrow: [{ lib: ['swipe_1', 'swipe_2', 'rsfx_whip'], proc: 'swoosh', vol: 0.3 }],
  stars: [{ lib: ['ding_2', 'ding_1', 'ding_3'], proc: 'sparkle', vol: 0.34 }, { lib: ['sparkle_1', 'twinkle_1', 'twinkle_3'], proc: 'sparkle', vol: 0.24, delay: 8 }],
  cta: [{ lib: ['notify_1', 'ding_2', 'notify_2'], proc: 'pop', vol: 0.45 }, { lib: ['coins_1', 'twinkle_2'], proc: 'tick', vol: 0.25, delay: 8, gempakOnly: true }],
  broll_full: [
    { lib: ['whoosh_1', 'whoosh_3', 'whoosh_5', 'rsfx_whoosh'], proc: 'whoosh', vol: 0.36, delay: -4 },
    { lib: ['shutter_1', 'camera_1', 'camera_2', 'rsfx_shutter'], proc: 'tick', vol: 0.22, delay: 1, gempakOnly: true },
  ],
  broll_pip: [{ lib: ['swipe_2', 'swipe_1', 'slide_1', 'slide_2'], proc: 'swoosh', vol: 0.32 }],
  fact: [{ lib: ['click_1', 'notify_1', 'notify_3'], proc: 'pop', vol: 0.34 }],
  zoom: [{ lib: ['whoosh_2', 'swipe_1', 'transition_1'], proc: 'swoosh', vol: 0.2, delay: -3 }],
  rehook: [{ lib: ['scratch_1', 'scratch_2', 'scratch_3'], proc: 'swoosh', vol: 0.4 }, { lib: ['riser_1', 'riser_2'], proc: 'whoosh', vol: 0.18, delay: -20, gempakOnly: true }],
  scene: [{ lib: ['whoosh_3', 'whoosh_1', 'whoosh_2', 'transition_2'], proc: 'whoosh', vol: 0.26, delay: -4 }],
  hero: [{ lib: ['swipe_2', 'slide_1'], proc: 'swoosh', vol: 0.22 }],
  circle: [{ lib: ['circle_1', 'circle_2', 'circle_3'], proc: 'marker', vol: 0.34, delay: 2 }],
  underline: [{ lib: ['underline_1', 'underline_2', 'underline_3'], proc: 'marker', vol: 0.32, delay: 3 }],
  point: [{ lib: ['point_1', 'point_2', 'point_3'], proc: 'pop', vol: 0.34 }],
  gif: [{ lib: ['pop_5', 'pop_6', 'boing_3'], proc: 'pop', vol: 0.32 }],
  confetti: [{ lib: ['confetti_1', 'confetti_2', 'confetti_3'], proc: 'sparkle', vol: 0.42, len: 50 }, { lib: ['twinkle_1', 'twinkle_3'], proc: 'sparkle', vol: 0.22, delay: 6, gempakOnly: true }],
  // jump-cut punch: a barely-there swish so the camera change feels intentional
  cut: [{ lib: ['transition_1', 'transition_2', 'transition_3'], proc: 'swoosh', vol: 0.12, delay: -2, gempakOnly: true }],
};

// The hook opener: one of 30 recipes per video (by the video's seed), so every
// video doesn't open on the same electric glitch. Each one lands a punch
// (impact / thud / boom / stamp / bass drop) within 0–6 frames — in time with
// the hook text's visual hit — optionally led in by a whoosh, swipe, scratch,
// glitch, camera flash, transition or ping. No comedy / cash sounds here.
const H = (lib: string, proc: string, vol: number, extra: Partial<Layer> = {}): Layer => ({ lib: [lib], proc, vol, ...extra });
const HOOKS: Layer[][] = [
  [H('impact_1', 'thump', 0.55), H('bass_drop_1', 'thump', 0.4, { gempakOnly: true }), H('glitch_1', 'swoosh', 0.22, { delay: 2, gempakOnly: true })],
  [H('impact_2', 'thump', 0.55), H('glitch_2', 'swoosh', 0.22, { delay: 2, gempakOnly: true })],
  [H('glitch_4', 'swoosh', 0.26), H('thud_1', 'thump', 0.5, { delay: 3 })],
  [H('glitch_3', 'swoosh', 0.26), H('boom_1', 'thump', 0.45, { delay: 3 })],
  [H('whoosh_1', 'whoosh', 0.32), H('impact_1', 'thump', 0.52, { delay: 4 })],
  [H('whoosh_2', 'whoosh', 0.32), H('impact_2', 'thump', 0.52, { delay: 4 })],
  [H('whoosh_3', 'whoosh', 0.32), H('boom_1', 'thump', 0.45, { delay: 4 })],
  [H('whoosh_4', 'whoosh', 0.32), H('thud_2', 'thump', 0.5, { delay: 4 })],
  [H('whoosh_5', 'whoosh', 0.32), H('bass_drop_1', 'thump', 0.45, { delay: 4 })],
  [H('rsfx_whoosh', 'whoosh', 0.32), H('impact_1', 'thump', 0.52, { delay: 4 })],
  [H('rsfx_whip', 'swoosh', 0.3), H('stamp_1', 'stamp', 0.52, { delay: 3 })],
  [H('swipe_1', 'swoosh', 0.3), H('impact_2', 'thump', 0.52, { delay: 3 })],
  [H('swipe_2', 'swoosh', 0.3), H('thud_1', 'thump', 0.5, { delay: 3 })],
  [H('scratch_1', 'swoosh', 0.4), H('impact_1', 'thump', 0.5, { delay: 4 })],
  [H('scratch_2', 'swoosh', 0.4), H('boom_1', 'thump', 0.45, { delay: 4 })],
  [H('scratch_3', 'swoosh', 0.4), H('thud_2', 'thump', 0.5, { delay: 4 })],
  [H('boom_1', 'thump', 0.5), H('sparkle_1', 'sparkle', 0.22, { delay: 6, gempakOnly: true })],
  [H('boom_1', 'thump', 0.5), H('bass_drop_1', 'thump', 0.35, { gempakOnly: true })],
  [H('stamp_1', 'stamp', 0.55), H('boom_1', 'thump', 0.3, { delay: 1, gempakOnly: true })],
  [H('shutter_1', 'tick', 0.36), H('impact_2', 'thump', 0.52, { delay: 3 })],
  [H('camera_1', 'tick', 0.36), H('whoosh_2', 'whoosh', 0.24, { delay: 2 }), H('impact_1', 'thump', 0.45, { delay: 5, gempakOnly: true })],
  [H('rsfx_shutter', 'tick', 0.36), H('thud_1', 'thump', 0.5, { delay: 3 })],
  [H('transition_1', 'swoosh', 0.3), H('impact_1', 'thump', 0.52, { delay: 4 })],
  [H('transition_2', 'swoosh', 0.3), H('boom_1', 'thump', 0.45, { delay: 4 })],
  [H('transition_3', 'swoosh', 0.3), H('stamp_1', 'stamp', 0.5, { delay: 4 })],
  [H('notify_1', 'pop', 0.4), H('impact_1', 'thump', 0.48, { delay: 3 })],
  [H('notify_3', 'pop', 0.4), H('boom_1', 'thump', 0.42, { delay: 3 })],
  [H('impact_1', 'thump', 0.52), H('impact_2', 'thump', 0.42, { delay: 6 })],
  [H('thud_1', 'thump', 0.52), H('whoosh_4', 'whoosh', 0.24, { delay: 2 }), H('glitch_1', 'swoosh', 0.2, { delay: 4, gempakOnly: true })],
  [H('bass_drop_1', 'thump', 0.5), H('scratch_2', 'swoosh', 0.3, { delay: 3 })],
];

/** A stable number from a video's own content — identical in every render
 *  chunk of that video, different from one video to the next. */
export const seedFrom = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const AVAILABLE = available as { names?: string[]; files?: Record<string, string> };
const HAVE = new Set<string>(AVAILABLE.names ?? []);
const FILE = (name: string) => AVAILABLE.files?.[name] ?? `${name}.mp3`;

export type SfxEvent = { frame: number; src: string; vol: number; len: number };

/** SFX layers for one visual event at `frame`. `seed` picks a variant so
 *  repeated events don't sound identical (pass the video's seed + the event's
 *  index, so the pattern also changes from video to video); for the hook it
 *  picks one of the opener recipes. */
export const sfxFor = (event: SfxEventName, frame: number, style: Style = 'gempak', seed = 0): SfxEvent[] => {
  const out: SfxEvent[] = [];
  const rules = event === 'hook' ? HOOKS[seed % HOOKS.length] : RULES[event] ?? [];
  for (const [li, layer] of rules.entries()) {
    if (layer.gempakOnly && style !== 'gempak') continue;
    const libs = layer.lib.filter((n) => HAVE.has(n));
    const pick = libs.length ? libs[(seed + li) % libs.length] : null;
    const src = pick ? staticFile(`sfx-lib/${FILE(pick)}`) : staticFile(`sfx/${layer.proc}.wav`);
    const vol = Math.min(1, layer.vol * (style === 'gempak' ? 1.15 : 0.85));
    out.push({ frame: Math.max(0, frame + (layer.delay ?? 0)), src, vol, len: layer.len ?? 45 });
  }
  return out;
};
