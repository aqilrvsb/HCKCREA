// Props contract between lib/motion.ts (Next), modal_motion.py (job) and the
// Remotion compositions. The LLM never writes pixel positions: it picks an
// element type, a zone and a cue; the renderer owns layout so a spec can't
// overlap or run off-screen without visual QA.

export type Word = { w: string; t: number; e?: number };

export type Zone = 'top' | 'middle' | 'bottom';

export type ItemType =
  | 'headline' // big slab of text on a colour block
  | 'note' // sticky note (optional strike-through sub + check/cross mark)
  | 'tag' // small rotated ribbon label
  | 'stamp' // bordered rubber-stamp word
  | 'chip' // white pill with a dot
  | 'tape' // paper tape strip with marker text
  | 'scribble' // hand-written marker text, typed on
  | 'price' // big price with optional struck-out old price (sub)
  | 'check' // checklist row with a drawn tick
  | 'emoji' // one big bouncing emoji
  | 'counter'; // number that counts up (text) with a label (sub)

export type Tone = 'yellow' | 'white' | 'red' | 'green' | 'accent' | 'dark';

export type Item = {
  t: ItemType;
  text?: string;
  sub?: string;
  /** Cue — Buat Iklan: "l3", "l3@harga", "l3@harga#2", "l3$", "+0.3" offsets, or seconds.
   *  Edit Video: "w12", "w12$" (word end), "w12+0.2", or seconds. */
  at: string | number;
  to?: string | number;
  zone?: Zone;
  tone?: Tone;
  mark?: 'check' | 'cross';
};

// ── Buat Iklan ────────────────────────────────────────────────────────────────
export type Act = 'hook' | 'pain' | 'reveal' | 'benefit' | 'proof' | 'price' | 'cta' | 'end';

export type AdLine = {
  id: string;
  act: Act;
  text: string;
  audioStart: number;
  audioDur: number;
  sceneStart: number;
  sceneEnd: number;
  /** t = seconds from the line's audioStart. */
  words: Word[];
};

export type Bg = 'mat' | 'paper' | 'dark' | 'accent' | 'blur';

export type Hero = { kind: 'product' | 'presenter' | 'none'; image?: number; side?: 'L' | 'C' | 'R' };

export type AdScene = { id: string; from: string | number; bg?: Bg; hero?: Hero; items: Item[]; endcard?: boolean };

export type ImageAsset = {
  url: string;
  /** Background-removed PNG with white sticker outline + baked shadow. */
  cutout?: string;
  /** Pre-blurred, darkened full-frame version for the "blur" background. */
  blur?: string;
};

export type Brand = {
  name: string;
  tagline?: string;
  price?: string;
  oldPrice?: string;
  cta?: string;
  handle?: string;
  accent: string;
};

export type AdProps = {
  fps: number;
  durationInFrames: number;
  lines: AdLine[];
  scenes: AdScene[];
  images: ImageAsset[];
  brand: Brand;
  /** Final VO + music mix. */
  audio?: string;
  captions: boolean;
  captionStyle?: CaptionStyle;
  sfx: boolean;
};

// ── Edit Video ────────────────────────────────────────────────────────────────
export type CaptionStyle = 'pop' | 'karaoke' | 'box';

export type Zoom = { at: string | number; to?: string | number; scale?: number };

export type EditProps = {
  fps: number;
  durationInFrames: number;
  /** Normalised 1080x1920 30fps H.264 of the client's video. */
  video: string;
  /** Absolute seconds. */
  words: Word[];
  captions: { on: boolean; style: CaptionStyle; pos: 'low' | 'mid'; maxWords: number };
  accent: string;
  overlays: Item[];
  zooms: Zoom[];
  hook?: { text: string; sub?: string; to?: string | number };
  sfx: boolean;
  music?: string;
  musicVolume?: number;
};
