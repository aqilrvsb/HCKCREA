// Laju v2 "Pro" looks: hook style, caption treatment, typeface, colour grade,
// camera feel, B-roll transitions, section-break light effect, end card and
// progress bar. The AI director decides them per video (props.direction, see
// lib/motion-director.ts); whatever it leaves out comes from a seed that is
// stable for the video (all render chunks agree) and differs between videos —
// so a client's feed never reads as one template stamped over and over.
import { highlight } from '../../motion/src/lib';

export type HookStyle = 'slam' | 'rise' | 'blocks' | 'marker' | 'stack' | 'headline';
export type ActiveWord = 'pop' | 'color' | 'box' | 'underline';
export type Transition = 'whip' | 'zoom' | 'push' | 'flash' | 'glitch' | 'iris';
export type EndCardStyle = 'pill' | 'badge' | 'banner' | 'none';
export type ProgressStyle = 'bar' | 'thick' | 'dots' | 'none';
export type BreakFx = 'sweep' | 'leak' | 'burn';

export type Face = { family: string; weight: number; charW: number; upper: boolean; track: number };
export type Grade = 'warm' | 'punchy' | 'clean' | 'cool' | 'matte' | 'vivid';
export type CameraFeel = 'calm' | 'handheld' | 'energetic';
export type FontId = 'montserrat' | 'archivo' | 'anton' | 'bebas' | 'poppins' | 'inter';

/** What the director may set (all optional). */
export type Direction = {
  hook_style?: HookStyle; caption_fx?: ActiveWord; marker?: boolean; emoji?: 'above' | 'beside';
  font?: FontId; caption_font?: FontId; grade?: Grade; grain?: boolean; camera?: CameraFeel;
  transitions?: Transition[]; break_fx?: BreakFx; end_card?: EndCardStyle; progress?: ProgressStyle;
  second?: string;
  moves?: { at: string | number; move: 'crash' | 'punch' | 'whip' | 'shake' | 'bump' | 'lines' | 'tilt' | 'smash' | 'spotlight'; power?: number; text?: string }[];
  /** A huge word behind the speaker's head (needs the speaker cut-out). */
  behind?: { at: string | number; to?: string | number; text: string; tone?: string }[];
  /** News strips over the speaker (overrides/scenesMore.tsx NewsBanner). */
  banner?: { at: string | number; to?: string | number; tag?: string; text: string; ticker?: string }[];
  /** "light" = no flashes / confetti / break light, shakes only where the director put them (explainer restraint) */
  fx?: 'full' | 'light';
  /** "subtle" = explainer captions (small words building); "big" (default) = the TikTok captions */
  captions?: 'big' | 'subtle';
  /** a creator caption style for the big captions (overrides/captionsLooks.tsx) */
  caption_look?: string;
  /** Full-screen explainer scenes over the speaker (overrides/scenesPro.tsx). */
  scenes?: ({ kind: string; at: string | number; to?: string | number; bg?: string } & Record<string, unknown>)[];
  /** Big stacked words beside the speaker. */
  side?: { at: string | number; to?: string | number; align?: string; words: ({ at: string | number; text: string; tone?: string; size?: string })[] }[];
  /** HyperFrames registry blocks (overrides/blocks.ts): block id, moment, zone and the block's own fields. */
  graphics?: ({ block: string; at: string | number; to?: string | number; zone?: string } & Record<string, unknown>)[];
};

export type Look = {
  id: string;
  display: Face;
  caption: Face;
  hook: HookStyle;
  active: ActiveWord;
  marker: boolean; // keyword words get a marker-highlight sweep
  emojiAbove: boolean; // keyword emoji pops above the word (else beside it)
  grade: { filter: string; lift: string | null; vignette: number };
  grain: number;
  camera: { drift: number; push: number; jump: number; bump: number };
  transitions: Transition[]; // first = this video's main transition (most cutaways), then accents
  breakFx: BreakFx;
  endcard: EndCardStyle;
  progress: ProgressStyle;
  hi: string; // caption highlight colour
  second: string; // a second colour for hook blocks / badges
};

const FONT_IDS: FontId[] = ['montserrat', 'archivo', 'anton', 'bebas', 'poppins', 'inter'];
// charW = the face's average capital advance (em), measured from the font files on Malay caption text
// (Montserrat 900 0.688, Archivo Black 0.760, Anton 0.460, Poppins 900 0.686, Inter 900 0.665) plus a little
// air — too low an estimate lets a line overflow the frame (an Archivo hook ran edge to edge)
const FACES: Face[] = [
  { family: "'Montserrat', sans-serif", weight: 900, charW: 0.70, upper: true, track: -0.5 },
  { family: "'Archivo Black', sans-serif", weight: 400, charW: 0.77, upper: true, track: 0 },
  { family: "'Anton', sans-serif", weight: 400, charW: 0.47, upper: true, track: 0.5 },
  { family: "'Bebas Neue', sans-serif", weight: 400, charW: 0.42, upper: true, track: 1 },
  { family: "'Poppins', sans-serif", weight: 900, charW: 0.70, upper: true, track: -0.5 },
  { family: "'Inter', sans-serif", weight: 900, charW: 0.68, upper: true, track: -1 },
];

const GRADE_IDS: Grade[] = ['warm', 'punchy', 'clean', 'cool', 'matte', 'vivid'];
const GRADES = [
  { filter: 'contrast(1.07) saturate(1.16) brightness(1.03) sepia(0.06)', lift: null, vignette: 0.38 }, // warm pop
  { filter: 'contrast(1.13) saturate(1.24) brightness(1.01)', lift: null, vignette: 0.42 }, // punchy
  { filter: 'contrast(1.04) saturate(1.08) brightness(1.05)', lift: null, vignette: 0.22 }, // clean bright
  { filter: 'contrast(1.06) saturate(1.1) brightness(1.03) hue-rotate(-4deg)', lift: null, vignette: 0.32 }, // cool
  { filter: 'contrast(0.95) saturate(1.06) brightness(1.06)', lift: 'rgba(48,36,70,0.07)', vignette: 0.26 }, // soft matte
  { filter: 'contrast(1.09) saturate(1.3) brightness(1.02)', lift: null, vignette: 0.36 }, // vivid
];

const SECOND = ['#111111', '#ffffff', '#FF3D7F', '#2EC4FF', '#7CFF6B', '#FFB020'];

// mulberry32 — the same stream on every render chunk
const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const CAMERAS: Record<CameraFeel, Look['camera']> = {
  calm: { drift: 0.6, push: 0.03, jump: 1.07, bump: 0.03 },
  handheld: { drift: 1.15, push: 0.045, jump: 1.12, bump: 0.04 },
  energetic: { drift: 1.0, push: 0.055, jump: 1.15, bump: 0.05 },
};

/** Seed mixer: neighbouring seeds give unrelated streams. */
const mix = (n: number) => {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

/** The look for a video: the director's choices, the rest from the seed. */
export function lookFor(seed: number, accent: string, style: 'gempak' | 'clean', d: Direction | null | undefined, hookWords: number): Look {
  const look = pickLook(seed, accent, style);
  if (d) {
    const fi = (id?: FontId) => (id && FONT_IDS.includes(id) ? FACES[FONT_IDS.indexOf(id)] : null);
    look.display = fi(d.font) ?? look.display;
    look.caption = fi(d.caption_font) ?? look.caption;
    if (d.hook_style) look.hook = d.hook_style;
    if (d.caption_fx) look.active = d.caption_fx;
    if (typeof d.marker === 'boolean') look.marker = d.marker;
    if (d.emoji) look.emojiAbove = d.emoji === 'above';
    if (d.grade && GRADE_IDS.includes(d.grade)) look.grade = GRADES[GRADE_IDS.indexOf(d.grade)];
    if (typeof d.grain === 'boolean') look.grain = d.grain ? 0.06 : 0;
    if (d.camera && CAMERAS[d.camera]) look.camera = CAMERAS[d.camera];
    if (d.transitions?.length) look.transitions = d.transitions.slice(0, 16);
    if (d.break_fx) look.breakFx = d.break_fx;
    if (d.end_card) look.endcard = d.end_card;
    if (d.progress) look.progress = d.progress;
    if (d.second && /^#[0-9a-f]{6}$/i.test(d.second) && d.second.toLowerCase() !== look.hi.toLowerCase()) look.second = d.second;
  }
  // one word per line only reads for a short hook
  if (look.hook === 'stack' && hookWords > 4) look.hook = 'slam';
  return look;
}

export function pickLook(seed: number, accent: string, style: 'gempak' | 'clean'): Look {
  const r = rng(mix(seed));
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length];
  const gempak = style === 'gempak';
  const display = pick(FACES);
  // captions stay on the wider faces (condensed ones get a bigger size, see captionsPro)
  const caption = r() < 0.7 ? pick([FACES[0], FACES[1], FACES[4], FACES[5]]) : pick(FACES);
  const hook = pick(['slam', 'rise', 'blocks', 'marker', 'stack', 'headline'] as const);
  const active = pick(['pop', 'color', 'box', 'underline'] as const);
  const all: Transition[] = gempak ? ['whip', 'zoom', 'flash', 'glitch', 'push', 'iris'] : ['push', 'zoom', 'iris', 'whip', 'flash', 'glitch'];
  const main = all[Math.floor(r() * (gempak ? 4 : 3))];
  const rest = all.filter((t) => t !== main);
  const a1 = rest[Math.floor(r() * rest.length)];
  const a2 = rest.filter((t) => t !== a1)[Math.floor(r() * (rest.length - 1))];
  const grade = pick(GRADES);
  const cam = gempak ? CAMERAS[pick(['handheld', 'energetic', 'handheld'] as const)] : CAMERAS[pick(['calm', 'handheld'] as const)];
  const hi = highlight(accent);
  let second = pick(SECOND);
  if (second.toLowerCase() === hi.toLowerCase()) second = '#ffffff';
  const look: Look = {
    id: '',
    display, caption, hook, active,
    marker: r() < 0.55,
    emojiAbove: r() < 0.6,
    grade, grain: r() < 0.5 ? 0.05 + r() * 0.03 : 0,
    camera: cam,
    // the main transition takes two of every three cutaways
    transitions: [main, main, a1, main, main, a2],
    breakFx: pick(['sweep', 'leak', 'burn'] as const),
    endcard: pick(['pill', 'badge', 'banner'] as const),
    progress: gempak ? pick(['bar', 'thick', 'dots', 'bar'] as const) : pick(['bar', 'dots', 'none'] as const),
    hi, second,
  };
  look.id = [look.hook, look.active, FACES.indexOf(display), FACES.indexOf(caption), GRADES.indexOf(grade), main, look.breakFx, look.endcard, look.progress].join('-');
  return look;
}
