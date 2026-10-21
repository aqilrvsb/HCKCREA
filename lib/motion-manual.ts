// Motion · Edit Video · "Saya nak pilih sendiri": the client's picks on top of AI Auto.
//
// The same AI brain as AI Auto plans the edit (FYP playbook, fresh ideas every video); every field the client set
// here is a rule it must follow, every field left unset ("✨ AI pilih") stays the AI's call — so a manual edit is
// never weaker than AI Auto, only more controlled. The options are what the HyperFrames renderer can actually draw
// (fonts, colour grades, caption looks, end cards). Client-safe: the form and the server both import this file.
import { isMotionStyle, type MotionStyleId } from "./motion-styles";

export const LOCK_FONTS = [
  { id: "montserrat", label: "Montserrat", css: "'Montserrat', sans-serif", weight: 900, upper: true },
  { id: "archivo", label: "Archivo", css: "'Archivo Black', sans-serif", weight: 400, upper: true },
  { id: "anton", label: "Anton", css: "'Anton', sans-serif", weight: 400, upper: true },
  { id: "bebas", label: "Bebas", css: "'Bebas Neue', sans-serif", weight: 400, upper: true },
  { id: "poppins", label: "Poppins", css: "'Poppins', sans-serif", weight: 900, upper: false },
  { id: "inter", label: "Inter", css: "'Inter', sans-serif", weight: 900, upper: false },
  // the style faces (motion-hf/fonts)
  { id: "playfair", label: "Serif", css: "'Playfair Display', serif", weight: 800, upper: false },
  { id: "mono", label: "Mono", css: "'JetBrains Mono', monospace", weight: 800, upper: true },
  { id: "marker", label: "Marker", css: "'Permanent Marker', cursive", weight: 400, upper: true },
  { id: "pixel", label: "Pixel", css: "'Press Start 2P', monospace", weight: 400, upper: true },
  { id: "comic", label: "Comic", css: "'Bangers', cursive", weight: 400, upper: true },
  { id: "rounded", label: "Rounded", css: "'Fredoka', sans-serif", weight: 700, upper: false },
] as const;
export type LockFont = (typeof LOCK_FONTS)[number]["id"];

/** Colour grade of the footage (look.ts GRADES) — `swatch` is only the chip's preview. */
export const LOCK_GRADES = [
  { id: "warm", label: "Hangat", swatch: "linear-gradient(135deg,#f6c27a,#d9734a)" },
  { id: "punchy", label: "Kontras", swatch: "linear-gradient(135deg,#ff3b5c,#1a1a1a)" },
  { id: "clean", label: "Cerah", swatch: "linear-gradient(135deg,#ffffff,#cfd8e3)" },
  { id: "cool", label: "Sejuk", swatch: "linear-gradient(135deg,#9fd3ff,#4a6fa5)" },
  { id: "matte", label: "Matte", swatch: "linear-gradient(135deg,#cbbfb0,#6f6a66)" },
  { id: "vivid", label: "Terang", swatch: "linear-gradient(135deg,#ffe600,#ff2fb3,#20d0ff)" },
] as const;
export type LockGrade = (typeof LOCK_GRADES)[number]["id"];

export const LOCK_END_CARDS = [
  { id: "pill", label: "Butang", desc: "Butang kuning besar ditekan" },
  { id: "badge", label: "Lencana", desc: "Bulatan beg + label" },
  { id: "banner", label: "Banner", desc: "Jalur senget penuh" },
  { id: "none", label: "Tiada", desc: "Anda sebut CTA sendiri" },
] as const;
export type LockEndCard = (typeof LOCK_END_CARDS)[number]["id"];

/** The renderer's caption looks (motion-hf captionsLooks.tsx) + TikTok's own white box. `p` = the chip preview. */
export const LOCK_CAPTION_LOOKS = [
  { id: "hormozi", label: "Hormozi", desc: "Huruf besar, kata kunci hijau", p: { font: "'Montserrat', sans-serif", w: 900, up: true, c: "#fff", hl: "#00F020", stroke: "#000" } },
  { id: "beast", label: "Beast", desc: "Kuning tebal, bercahaya", p: { font: "'Archivo Black', sans-serif", w: 400, up: true, c: "#FFF200", hl: "#3DFF6E", stroke: "#000" } },
  { id: "karaoke", label: "Karaoke", desc: "Perkataan menyala ikut suara", p: { font: "'Montserrat', sans-serif", w: 900, up: true, c: "#fff", hl: "#FFE600", stroke: "#000" } },
  { id: "popline", label: "Popline", desc: "Garis ungu bawah perkataan", p: { font: "'Montserrat', sans-serif", w: 900, up: true, c: "#fff", hl: "#fff", stroke: "#000", line: "#8B3DFF" } },
  { id: "deep", label: "Deep", desc: "Kotak putih, gaya podcast", p: { font: "'Inter', sans-serif", w: 800, up: false, c: "#111", hl: "#111", bg: "#fff" } },
  { id: "pill", label: "Pill", desc: "Kapsul putih lembut", p: { font: "'Poppins', sans-serif", w: 800, up: false, c: "#1a1a1a", hl: "#1a1a1a", bg: "#fff", round: true } },
  { id: "fill", label: "Fill", desc: "Warna isi ikut suara", p: { font: "'Montserrat', sans-serif", w: 900, up: true, c: "#fff", hl: "#60F0C0", stroke: "#000" } },
  { id: "pod", label: "Pod", desc: "1–2 perkataan sangat besar", p: { font: "'Anton', sans-serif", w: 400, up: true, c: "#fff", hl: "#FF40D8" } },
  { id: "sticker", label: "Sticker", desc: "Gaya sticker CapCut", p: { font: "'Archivo Black', sans-serif", w: 400, up: true, c: "#FFD93B", hl: "#FF5FA2", stroke: "#fff" } },
  { id: "sweep", label: "Sweep", desc: "Kotak merah gelongsor", p: { font: "'Montserrat', sans-serif", w: 800, up: true, c: "#fff", hl: "#fff", stroke: "#000", box: "#ff1745" } },
  { id: "neon", label: "Neon", desc: "Biru neon berkelip", p: { font: "'Anton', sans-serif", w: 400, up: true, c: "#fff", hl: "#10C0FF", glow: "#10C0FF" } },
  { id: "tiktok", label: "TikTok", desc: "Kotak putih asli TikTok", p: { font: "'Montserrat', sans-serif", w: 800, up: false, c: "#111", hl: "#111", bg: "#fff" } },
] as const;
export type LockCaptionLook = (typeof LOCK_CAPTION_LOOKS)[number]["id"];

export const LOCK_SCENES = [
  { id: "many", label: "Banyak", desc: "Gaya berita / explainer — skrin grafik penuh ~½ video" },
  { id: "some", label: "Sederhana", desc: "Beberapa skrin grafik, muka anda kerap nampak" },
  { id: "few", label: "Sikit", desc: "Muka anda hampir sepanjang video" },
] as const;
export type LockScenes = (typeof LOCK_SCENES)[number]["id"];

export const LOCK_MOODS = [
  { id: "upbeat", label: "Ceria" },
  { id: "chill", label: "Santai" },
  { id: "hype", label: "Hype" },
] as const;
export type LockMood = (typeof LOCK_MOODS)[number]["id"];

export const LOCK_CTAS = ["Tekan beg kuning", "Klik link di bio", "DM sekarang"] as const;

/** Signature moments the client can force on / off (unset = AI decides). */
export const LOCK_ELEMENTS = [
  { id: "behind", label: "Teks belakang kepala", desc: "Satu perkataan besar di belakang kepala anda" },
  { id: "spotlight", label: "Spotlight", desc: "Latar belakang malap & kabur, anda kekal terang" },
  { id: "smash", label: "Smash cut", desc: "Skrin hitam + satu perkataan besar, potong balik" },
  { id: "gif", label: "Sticker GIF", desc: "Sticker reaksi beranimasi (GIPHY)" },
  { id: "emoji", label: "Emoji animasi", desc: "Emoji bergerak pada perkataan penting" },
] as const;
export type LockElement = (typeof LOCK_ELEMENTS)[number]["id"];

export type MotionLocks = {
  /** one of the 40 styles of the style library (lib/vgc-styles.ts — its brief directs the edit) */
  styleId?: string;
  /** its name, set by the server from the library (shown on the History card) */
  styleName?: string;
  /** a sales angle (the preset chip's label + its brief) */
  angle?: { label: string; brief: string };
  /** the hook text, word for word */
  hook?: string;
  /** the CTA text, word for word */
  cta?: string;
  endCard?: LockEndCard;
  look?: MotionStyleId;
  font?: LockFont;
  grade?: LockGrade;
  captionLook?: LockCaptionLook;
  captionPos?: "low" | "mid";
  scenes?: LockScenes;
  fx?: "full" | "light";
  music?: boolean;
  mood?: LockMood;
  elements?: Partial<Record<LockElement, boolean>>;
};

const one = <T extends string>(v: unknown, list: readonly { id: T }[]): T | undefined =>
  typeof v === "string" && list.some((x) => x.id === v) ? (v as T) : undefined;
const txt = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "") || undefined;

/** The client's picks, whitelisted (unknown values are dropped = the AI decides). undefined = not a manual request. */
export function cleanLocks(raw: unknown): MotionLocks | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const ang = (r.angle ?? {}) as { label?: unknown; brief?: unknown };
  const els = (r.elements ?? {}) as Record<string, unknown>;
  const out: MotionLocks = {};
  if (typeof r.styleId === "string" && /^[a-z0-9-]{2,40}$/.test(r.styleId)) out.styleId = r.styleId;
  const label = txt(ang.label, 40);
  if (label) out.angle = { label, brief: txt(ang.brief, 600) ?? label };
  const hook = txt(r.hook, 40);
  if (hook) out.hook = hook;
  const cta = txt(r.cta, 30);
  if (cta) out.cta = cta;
  const end = one(r.endCard, LOCK_END_CARDS);
  if (end) out.endCard = end;
  if (isMotionStyle(r.look)) out.look = r.look;
  const font = one(r.font, LOCK_FONTS);
  if (font) out.font = font;
  const grade = one(r.grade, LOCK_GRADES);
  if (grade) out.grade = grade;
  const cap = one(r.captionLook, LOCK_CAPTION_LOOKS);
  if (cap) out.captionLook = cap;
  if (r.captionPos === "low" || r.captionPos === "mid") out.captionPos = r.captionPos;
  const scenes = one(r.scenes, LOCK_SCENES);
  if (scenes) out.scenes = scenes;
  if (r.fx === "full" || r.fx === "light") out.fx = r.fx;
  if (typeof r.music === "boolean") out.music = r.music;
  const mood = one(r.mood, LOCK_MOODS);
  if (mood) out.mood = mood;
  const el: Partial<Record<LockElement, boolean>> = {};
  for (const e of LOCK_ELEMENTS) if (typeof els[e.id] === "boolean") el[e.id] = els[e.id] as boolean;
  if (Object.keys(el).length) out.elements = el;
  return out;
}
