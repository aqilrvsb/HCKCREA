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
  | 'broll_full' | 'broll_pip' | 'fact' | 'zoom' | 'rehook' | 'scene' | 'hero';

type Layer = { lib: string[]; proc: string; vol: number; len?: number; delay?: number; gempakOnly?: boolean };

const RULES: Record<SfxEventName, Layer[]> = {
  hook: [
    { lib: ['impact_1', 'impact_2'], proc: 'thump', vol: 0.55 },
    { lib: ['bass_drop_1'], proc: 'thump', vol: 0.4, gempakOnly: true },
    { lib: ['glitch_1', 'glitch_2'], proc: 'swoosh', vol: 0.22, delay: 2, gempakOnly: true },
  ],
  headline: [{ lib: ['impact_2', 'impact_1'], proc: 'thump', vol: 0.42 }, { lib: ['swipe_1'], proc: 'swoosh', vol: 0.2, gempakOnly: true }],
  note: [{ lib: ['pop_1', 'pop_2'], proc: 'pop', vol: 0.36 }],
  tag: [{ lib: ['stamp_1'], proc: 'stamp', vol: 0.34 }],
  stamp: [{ lib: ['stamp_1'], proc: 'stamp', vol: 0.55 }, { lib: ['boom_1'], proc: 'thump', vol: 0.25, gempakOnly: true }],
  chip: [{ lib: ['pop_2', 'pop_4'], proc: 'pop', vol: 0.3 }, { lib: ['swipe_2'], proc: 'swoosh', vol: 0.14, gempakOnly: true }],
  tape: [{ lib: ['paper_1'], proc: 'paper', vol: 0.34 }],
  scribble: [{ lib: [], proc: 'marker', vol: 0.22, len: 40 }],
  price: [{ lib: ['cash_1'], proc: 'sparkle', vol: 0.5, len: 60 }, { lib: ['sparkle_1'], proc: 'sparkle', vol: 0.3, delay: 6 }],
  check: [{ lib: ['ding_1', 'tick_1'], proc: 'tick', vol: 0.34 }],
  emoji: [{ lib: ['pop_3', 'boing_1'], proc: 'pop', vol: 0.36 }],
  counter: [{ lib: ['coins_1'], proc: 'tick', vol: 0.34, len: 50 }],
  bigword: [{ lib: ['impact_1', 'impact_2'], proc: 'thump', vol: 0.55 }, { lib: ['whoosh_1', 'whoosh_2'], proc: 'whoosh', vol: 0.28, delay: -3 }],
  callout: [{ lib: ['pop_4', 'pop_1'], proc: 'pop', vol: 0.34 }],
  arrow: [{ lib: ['swipe_1', 'swipe_2'], proc: 'swoosh', vol: 0.3 }],
  stars: [{ lib: ['ding_2', 'ding_1'], proc: 'sparkle', vol: 0.34 }, { lib: ['sparkle_1'], proc: 'sparkle', vol: 0.24, delay: 8 }],
  cta: [{ lib: ['notify_1', 'ding_2'], proc: 'pop', vol: 0.45 }, { lib: ['coins_1'], proc: 'tick', vol: 0.25, delay: 8, gempakOnly: true }],
  broll_full: [{ lib: ['whoosh_1', 'whoosh_3'], proc: 'whoosh', vol: 0.36, delay: -4 }, { lib: ['shutter_1'], proc: 'tick', vol: 0.22, delay: 1, gempakOnly: true }],
  broll_pip: [{ lib: ['swipe_2', 'swipe_1'], proc: 'swoosh', vol: 0.32 }],
  fact: [{ lib: ['click_1', 'notify_1'], proc: 'pop', vol: 0.34 }],
  zoom: [{ lib: ['whoosh_2', 'swipe_1'], proc: 'swoosh', vol: 0.2, delay: -3 }],
  rehook: [{ lib: ['scratch_1'], proc: 'swoosh', vol: 0.4 }, { lib: ['riser_1'], proc: 'whoosh', vol: 0.18, delay: -20, gempakOnly: true }],
  scene: [{ lib: ['whoosh_3', 'whoosh_1', 'whoosh_2'], proc: 'whoosh', vol: 0.26, delay: -4 }],
  hero: [{ lib: ['swipe_2'], proc: 'swoosh', vol: 0.22 }],
};

const HAVE = new Set<string>((available as { names?: string[] }).names ?? []);

export type SfxEvent = { frame: number; src: string; vol: number; len: number };

/** SFX layers for one visual event at `frame`. `seed` picks a variant so
 *  repeated events don't sound identical. */
export const sfxFor = (event: SfxEventName, frame: number, style: Style = 'gempak', seed = 0): SfxEvent[] => {
  const out: SfxEvent[] = [];
  for (const [li, layer] of (RULES[event] ?? []).entries()) {
    if (layer.gempakOnly && style !== 'gempak') continue;
    const libs = layer.lib.filter((n) => HAVE.has(n));
    const pick = libs.length ? libs[(seed + li) % libs.length] : null;
    const src = pick ? staticFile(`sfx-lib/${pick}.mp3`) : staticFile(`sfx/${layer.proc}.wav`);
    const vol = Math.min(1, layer.vol * (style === 'gempak' ? 1.15 : 0.85));
    out.push({ frame: Math.max(0, frame + (layer.delay ?? 0)), src, vol, len: layer.len ?? 45 });
  }
  return out;
};
