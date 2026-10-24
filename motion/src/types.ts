// Props contract between lib/motion.ts (Next), modal_motion.py (job) and the
// Remotion compositions. The LLM never writes pixel positions: it picks an
// element type, a zone and a cue; the renderer owns layout so a spec can't
// overlap or run off-screen without visual QA.

export type Word = { w: string; t: number; e?: number };

export type Zone = 'top' | 'middle' | 'bottom';

/** gempak = dense, shake/flash/particles, louder SFX · clean = calmer. */
export type Style = 'gempak' | 'clean';

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
  | 'emoji' // one big bouncing (animated) emoji
  | 'counter' // number that counts up (text) with a label (sub)
  | 'bigword' // huge kinetic 1–2 words punched in the middle
  | 'callout' // speech bubble
  | 'arrow' // hand-drawn arrow drawing on, with a label (text)
  | 'stars' // 5-star rating row; text = label (only real numbers)
  | 'cta' // "Tekan beg kuning" pill with a bouncing arrow
  | 'fact' // web fact card: text + sub = "Sumber: domain" (built from EditProps.facts)
  | 'circle' // word circled with a hand-drawn marker loop
  | 'underline' // bold word with a double scribbled underline
  | 'point' // bouncing pointing-hand emoji (sub = which hand) + label
  | 'gif' // animated GIF / sticker (src = local URL)
  | 'confetti'; // full-frame confetti rain (no slot)

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
  /** gif: local URL of the downloaded animation. */
  src?: string;
};

/** Keyword colouring for captions (word index into `words`). */
export type KeyColor = 'benefit' | 'price' | 'pain' | 'brand' | 'accent';
export type CaptionKey = { i: number; color: KeyColor; emoji?: string };

/** tiktok = TikTok's own white rounded text box (rounded-text-box). */
export type CaptionStyle = 'pop' | 'karaoke' | 'box' | 'tiktok';

/** Map of emoji character → local Lottie JSON URL (Google Noto animated). */
export type LottieMap = Record<string, string>;

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
  style?: Style;
  lottie?: LottieMap;
  /** Custom style (no video): the style's own look — surface / ink, faces, texture */
  theme?: AdTheme;
};
export type AdTheme = {
  name: string; bg: string; ink: string; light: boolean;
  display: string; displayWeight: number; caption: string; captionWeight: number;
  texture: 'none' | 'paper' | 'film' | 'crt' | 'halftone' | 'grid' | 'glow';
};

// ── Edit Video ────────────────────────────────────────────────────────────────
export type Zoom = { at: string | number; to?: string | number; scale?: number };

/** Face box sample, normalised 0..1 of the frame, at time t (s). */
export type Face = { t: number; x: number; y: number; w: number; h: number };

export type BRoll = {
  at: string | number;
  to?: string | number;
  /** Local URL of the prepared image (≤1080 wide) — the poster frame for a video clip. */
  src: string;
  /** Local URL of a short stock video clip (muted), when this cutaway moves. */
  video?: string;
  /** Local URL of the blurred 1080x1920 fill (fullscreen layout). */
  blur?: string;
  layout: 'full' | 'pip';
  /** Optional small label on the card (≤ 4 words). */
  label?: string;
  /** Pinned (an ingredient the speaker names): headlines move and scenes give way for it — never dropped. */
  must?: boolean;
};

export type FactCard = { at: string | number; to?: string | number; text: string; source: string; icon?: string };

/** "Check Guideline TikTok": one printed line to cover with tape. Keyframes
 *  are [t (s), cx, cy, w, h (px of the 1080x1920 frame), angle (deg)];
 *  `pre`/`post` hold the tape a little before the first / after the last. */
export type TapeTrack = { k: [number, number, number, number, number, number][]; pre?: number; post?: number };

export type EditProps = {
  fps: number;
  durationInFrames: number;
  /** Normalised 1080x1920 30fps H.264 of the client's video (jump-cut if enabled). */
  video: string;
  /** Absolute seconds (after jump cuts). */
  words: Word[];
  captions: { on: boolean; style: CaptionStyle; pos: 'low' | 'mid'; maxWords: number };
  accent: string;
  overlays: Item[];
  zooms: Zoom[];
  hook?: { text: string; sub?: string; to?: string | number };
  sfx: boolean;
  music?: string;
  musicVolume?: number;
  style?: Style;
  faces?: Face[];
  broll?: BRoll[];
  facts?: FactCard[];
  keywords?: CaptionKey[];
  rehook?: { at: string | number; text: string };
  cta?: { at: string | number; text: string; sub?: string };
  lottie?: LottieMap;
  /** Thin progress bar at the top (gempak default). */
  progress?: boolean;
  /** TikTok guard: tracked tape over risky printed text in the video. */
  tapes?: TapeTrack[];
  /** TikTok guard: indices into `words` that were muted — captions show tape. */
  censor?: number[];
  /** Jump-cut points (s) — the frame alternates a punch-in on each cut so jumps read as camera changes. */
  cuts?: number[];
  /** Final-QA tape patches in SCREEN space (found by OCR on the rendered video). */
  patchTapes?: TapeTrack[];
  /** AI Auto: the hook-opener sound the director chose (index into sfx.ts HOOKS). */
  hookSfx?: number;
};
