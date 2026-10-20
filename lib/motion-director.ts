// Motion v2 "director" for Edit Video — turns a client's transcript into a
// full edit plan, then grounds it in the real world:
//   1. LLM director (model_motion cascade) → hook, overlays, zooms, keyword
//      captions, re-hook, CTA, B-roll moments (search queries), fact moments.
//   2. Serper/Google image search per B-roll moment + one vision call that
//      picks the best-matching image per moment (cascade: vision → first hit).
//   3. Serper/Google web search per fact moment + one LLM call that writes
//      ≤12-word fact cards strictly from the snippets (source domain shown,
//      no medical / price / efficacy claims, null when unsupported).
//   4. qaPatch(): vision review of rendered stills → small JSON patch.
// With the seller's own product photos (optional upload) every product shot
// comes from them — never another brand's box; generic shots stay on Google
// and must show no packaging / brand at all.
// Every step is fail-soft: a failure drops that enrichment, never the job.

import { currentDeadline, orChat, orChatVision } from "@/lib/openrouter";
import {
  brandImagePool, dropExcluded, excludeOperators, findBrandSites, getSitePrefs, searchImages, searchWeb, type ImageHit, type WebHit,
} from "@/lib/motion-search";
import { searchClips, searchStickers } from "@/lib/motion-media";
import { MOTION_EDIT_PRESETS, MOTION_MY_TIKTOK_GUIDE } from "@/lib/motion-prompts";
import { MOTION_STYLES, motionStyle, type MotionEnergy, type MotionStyleId } from "@/lib/motion-styles";
import { HOOK_SOUNDS } from "@/lib/motion-hook-sounds";
import { extractJson, cleanItemPublic, type EditInput, type MotionItem } from "@/lib/motion";
import { GUARD_RULES, guardCensorWords, guardFixSlots, guardHits, guardStripQuery } from "@/lib/motion-guard";

type Cue = string | number;
export type DirectorWord = { i: number; w: string; t: number; e?: number };

export type BRollPlan = {
  at: Cue; to?: Cue; layout: "full" | "pip"; label?: string; query: string; candidates: string[];
  /** video = stock clip (candidates are MP4 links); photo otherwise. */
  kind?: "photo" | "video";
};
export type FactPlan = { at: Cue; to?: Cue; text: string; source: string };
export type EditPlanV2 = {
  /** Product / brand name (finds the brand's own website for B-roll). */
  brand?: string;
  hook: { text: string; sub?: string } | null;
  accent: string;
  mood: "chill" | "upbeat" | "hype";
  captions: { on: boolean; style: "pop" | "karaoke" | "box" | "tiktok"; pos: "low" | "mid"; maxWords: number };
  overlays: MotionItem[];
  zooms: { at: Cue; to?: Cue; scale?: number }[];
  broll: BRollPlan[];
  facts: FactPlan[];
  keywords: { i: number; color: "benefit" | "price" | "pain" | "brand" | "accent"; emoji?: string }[];
  rehook?: { at: Cue; text: string };
  cta?: { at: Cue; text: string; sub?: string };
  /** TikTok guard: word indices the rules always mute (Modal adds the LLM's). */
  censor?: number[];
  guard?: { fixed: number; dropped: number };
  // ── AI Auto only: what the director chose for this video ──
  /** The selling angle it went for (≤6 words). */
  angle?: string;
  /** The look it picked, and its render energy. */
  look?: MotionStyleId;
  energy?: MotionEnergy;
  /** Music bed or not (mood above). */
  music?: boolean;
  /** Hook-opener sound: index into HOOK_SOUNDS / the Remotion HOOKS recipes. */
  hookSound?: number;
  /** "<provider>/<model>" of the cascade slot that wrote this plan. */
  director?: string;
  /** HyperFrames (Laju v2 Pro) craft choices: hook / caption / font / grade / camera / transitions / end card /
   *  signature camera moves — see PRO_DIRECTION and motion-hf/overrides/look.ts. */
  direction?: ProDirection;
};

export type ProDirection = {
  hook_style?: string; font?: string; caption_font?: string; caption_fx?: string; marker?: boolean; emoji?: "above" | "beside";
  grade?: string; grain?: boolean; camera?: string; transitions?: string[]; break_fx?: string; end_card?: string; progress?: string;
  second?: string; moves?: { at: Cue; move: string; power?: number }[];
};

// ── AI Auto ──────────────────────────────────────────────────────────────────
// The client picks nothing: the director reads the video and decides the
// angle, look, colour, captions, hook sound and music itself. Left to choose
// from every option it lands on the same "best fit" each time (same video →
// same look, same sound), so the CODE draws a random shortlist per call —
// 2 of the 10 looks, 4 of 31 angles, 5 of 50 hook sounds, 2 of 4 caption
// styles, 3 of 25 hook formulas, 1 of 24 accent colours + 1 of 40 creative
// sparks — and the AI picks the best of those for this footage. Every
// generation differs; every pick fits. (Pure text pools: growing them costs
// nothing per video — the prompt only ever carries the shortlist.)

// Selling angles: the 16 prompt chips (lib/motion-prompts) + these, AI Auto only.
const EXTRA_ANGLES: { label: string; desc: string }[] = [
  { label: "Masalah → penyelesaian", desc: "open on the viewer's pain, then the product as the fix the speaker shows." },
  { label: "Kesilapan biasa", desc: "the mistake most people make, and the right way the speaker does it." },
  { label: "Rahsia / tip orang tak tahu", desc: "frame the key detail as an insider tip few people know." },
  { label: "Storytime pengalaman", desc: "tell it as the speaker's own story with a turn in the middle." },
  { label: "Mitos vs fakta", desc: "bust one belief with what the speaker actually says or shows." },
  { label: "Cara lama vs cara baru", desc: "contrast the old hassle with the easier way in the video." },
  { label: "Rutin harian", desc: "fit the product into a simple daily routine the speaker describes." },
  { label: "Life hack", desc: "present the use as a smart shortcut that saves time or effort." },
  { label: "3 sebab wajib cuba", desc: "count the spoken benefits on screen as clear numbered reasons." },
  { label: "Untuk siapa produk ni", desc: "call out exactly who this is for, from what the speaker says." },
  { label: "First impression", desc: "the speaker's first reaction and honest early verdict." },
  { label: "Q&A pantas", desc: "turn the talk into quick questions and straight answers." },
  { label: "Idea hadiah", desc: "position it as a thoughtful gift — only if the speaker's context allows." },
  { label: "Satisfying detail", desc: "linger on the most satisfying visual / sound moment of using it." },
  { label: "Cabaran penonton", desc: "challenge the viewer to try, guess or compare along with the video." },
];

const HOOK_FORMULAS = [
  "problem → fix (name the pain, promise the fix)", "a question that hits the viewer's pain", "a bold verdict / hot take",
  "\"Jangan … sebelum tengok ni\" warning", "a result or before→after tease (only what is shown or said)",
  "a number list (\"3 sebab…\", \"2 cara…\")", "a secret / thing nobody tells you", "POV — the viewer in the situation",
  "a price or promo shock (only a spoken price / promo)", "first try / first impression reaction", "myth vs fact",
  "a challenge to the viewer (\"Cuba teka…\")",
  "call out one exact person (\"Yang selalu …, tengok ni\")", "a mistake confession (\"Saya silap selama ni…\")",
  "a curiosity gap (\"Ramai tak tahu …\")", "a relatable complaint (\"Penat dah …\")", "a story opener (\"Semalam saya …\")",
  "the direct benefit in 3–4 words", "a contradiction (\"Kecil tapi …\")", "a speed promise (\"Dalam 10 saat …\")",
  "an instruction (\"Tengok cara saya …\")", "comparison (\"Biasa vs …\")", "spoken social proof (\"Dah ramai …\" — only if said)",
  "an unexpected first word that makes people look twice", "a 'stop' pattern interrupt (\"STOP — sebelum beli …\")",
];
const CAPTION_CHOICES = ["pop", "karaoke", "box", "tiktok"] as const;
// Eye-catching accent colours — one is suggested per generation so the same
// look doesn't always come out in the same colour.
const ACCENTS = [
  "electric yellow #FFE600", "hot pink #FF2E88", "electric blue #2F7BFF", "lime #A3FF12", "tangerine #FF7A00",
  "violet #8B5CF6", "teal #14B8A6", "cherry red #F43F5E", "mint #34D399", "coral #FF6B6B", "gold #F5B800", "cyan #22D3EE",
  "royal purple #7C3AED", "neon green #39FF14", "sky blue #38BDF8", "peach #FFB38A", "magenta #E11D74", "sunset orange #FB923C",
  "emerald #10B981", "lavender #C4B5FD", "crimson #DC2626", "aqua #2DD4BF", "lemon #FDE047", "rose gold #E8A39C",
];

const SPARKS = [
  "myth vs fact", "POV — the viewer is the one with the problem", "a question the viewer can't scroll past",
  "price shock (only with a price that is spoken)", "3 reasons, counted on screen", "the mistake everyone makes",
  "secret / hidden detail reveal", "before → after contrast (only what is actually shown or said)", "reply-to-a-comment energy",
  "news-flash urgency", "day-in-the-life montage feel", "honest verdict stamp", "plot twist in the middle",
  "checklist race", "ingredient / feature spotlight", "challenge the viewer", "storytime with a cliffhanger re-hook",
  "hot take opener", "quiz — guess before the answer", "first-impression reaction",
  "split feel — problem on one side, fix on the other (tags left / right)", "countdown energy toward the payoff",
  "spotlight the one number that matters", "talk-show banter in the callouts", "director's commentary asides",
  "game-show reveal of the key benefit", "detective investigation of the problem", "breaking-news ticker vibe",
  "diary / journal entry tone", "teacher whiteboard explanation (circles, underlines, arrows)", "street-interview vibe",
  "unboxing suspense", "speed-run tutorial", "ranking / tier-list framing", "chat-bubble style callouts",
  "recipe-card steps", "sports-commentary energy", "close-up on the label or key detail", "mini-documentary tone",
  "expectation vs reality (honest, only what is shown)",
];

const shuffle = <T,>(a: readonly T[]): T[] => {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const firstSentence = (s: string) => (s.split(/(?<=[.!?:])\s/)[0] || s).slice(0, 150);

/** The AUTO section of the director prompt — a fresh random shortlist every call. */
function autoBrief(): string {
  const looks = shuffle(MOTION_STYLES).slice(0, 2).map((l) =>
    `- ${l.id} (${l.label}: ${l.desc}) — ${l.edit} Palette: ${l.palette}. Max gap ${l.maxGap} s. Music mood: ${l.mood}.`).join("\n");
  const anglePool = [
    ...MOTION_EDIT_PRESETS.map((a) => ({ label: a.label.replace(/^\P{L}+/u, ""), desc: firstSentence(a.prompt) })),
    ...EXTRA_ANGLES,
  ];
  const angles = shuffle(anglePool).slice(0, 4).map((a) => `- ${a.label}: ${a.desc}`).join("\n");
  const sounds = shuffle(HOOK_SOUNDS.map((s, i) => `${i} = ${s}`)).slice(0, 5).join("\n");
  const formulas = shuffle(HOOK_FORMULAS).slice(0, 3).map((f) => `- ${f}`).join("\n");
  const caps = shuffle(CAPTION_CHOICES).slice(0, 2).map((c) => `"${c}"`).join(" or ");
  const spark = SPARKS[Math.floor(Math.random() * SPARKS.length)];
  const colour = ACCENTS[Math.floor(Math.random() * ACCENTS.length)];
  return `AI AUTO — YOU ARE THE CREATIVE DIRECTOR AND THE EDITOR. The client chose nothing: read the WHOLE transcript first, understand the product, the speaker's energy and what actually happens in the video, then decide EVERYTHING yourself. Goal: stop the scroll, keep people watching to the end, push the beg kuning — and beat what a skilled human TikTok editor would make of this footage, so it has its best shot at the For You Page.
Decide, in this order:
This generation's options were drawn at random — choose ONLY from them, the best fit for this footage (another generation of the same video gets different options on purpose):
1. "angle": ONE of the 4 ANGLES below — frame this footage through it honestly (a tutorial video can still be told as a POV, a soft-sell story, a myth-buster…); name it in ≤6 words.
2. "look": the id of ONE of the 2 LOOKS below. Follow its pace rules.
   "accent": this generation's colour is ${colour} — use it (or a close shade) unless it truly clashes with the chosen look; then take the nearest colour from the look's palette.
3. "captions": {"style": ${caps}, "pos": "low" | "mid"} — "mid" only when hands / the product fill the bottom of the frame (ignored when the client switched captions off).
4. "hook": write it with ONE of the HOOK FORMULAS below, from what is really said.
5. "hook_sound": the index of ONE of the 5 HOOK SOUNDS below, the one whose feel matches your hook (it plays as the hook text lands).
6. "music": true when a music bed lifts it (selling energy, montage feel, light talk with breathing gaps); false when the voice must carry it alone (emotional story, dense fast talk, ASMR, a detailed tutorial). "mood" sets its feel.
7. Then the edit itself — stickers, B-roll, zooms, keywords, re-hook, CTA — built around the angle and the look.
FYP PLAYBOOK (TikTok Shop Academy 2026 + TikTok Creative Center):
- Hook: land the video's strongest promise by 2.5 s — hook text, the spoken line and the visual say the same thing, tied to the product; hook sound + a zoom or text pop make something move in the first second. Build the hook from what is said: problem → fix, before / after, a price or promo shock (show a spoken price within 3 s), a pain-point question, first try / unboxing.
- Payoff early: show the benefit or result within 10–15 s — never save the product for the end; name / point at the product by ~3 s.
- Rhythm: fast hook, steadier middle, fast peak, quick ending. Change something on screen at the chosen look's pace; zoom at sentence turns and key words, the biggest zoom on the main claim or the price.
- Re-hook (videos > 30 s) at 40–50 % with an open loop ("tapi yang paling best…", a twist, a counter).
- Readability: every sticker enters on its spoken word and leaves before the next idea; on screen ≥ (its words ÷ 3 + 0.5) s, headlines and prices ≥ 2 s; ≤ 2 overlays at once; never over the face or the product.
- B-roll: 1.5–2.5 s each on the noun or claim being spoken, never two back to back, the speaker on screen most of the time (cutaways ≤ 40 % of the runtime).
- Trust sells in Malaysia: give real proof the speaker mentions (counter for "dah guna X", a verdict stamp, a check list) — never invented.
- CTA in the last 3–5 s, text + arrow down to the beg kuning; real urgency only. If the hook is about price / promo, a soft early "beg kuning" chip is fine.
- Music off when the product makes its own satisfying sound, for a heartfelt testimonial or very dense fast talk.
- TikTok Shop now pushes down near-identical videos — this one must not look like a template.
THINK IT UP FRESH: treat this video as a brand-new creative brief — no default template, no safe go-to look, no stock hook line. Find the idea that is special about THIS footage and build the whole edit around it. Creative spark for this edit: "${spark}" — use it for one signature move only if it fits the content honestly; ignore it if it doesn't.

LOOKS — pick one of these 2 (id — feel — pace rules — palette — max gap — music mood):
${looks}

ANGLES — pick one of these 4:
${angles}

HOOK FORMULAS — pick one:
${formulas}

HOOK SOUNDS — pick one (index = sound — suits):
${sounds}`;
}

// ── PRO direction (Laju v2 on HyperFrames) ───────────────────────────────────
// The render engine offers the craft; the director decides how THIS video uses
// it. Each option is described by its feel, never assigned to a content type
// as a rule — the model weighs footage, speaker, product and angle itself.
const PRO_SETS = {
  hook_style: ["slam", "rise", "blocks", "marker", "stack"],
  font: ["montserrat", "archivo", "anton", "bebas", "poppins", "inter"],
  caption_fx: ["pop", "color", "box", "underline"],
  grade: ["warm", "punchy", "clean", "cool", "matte", "vivid"],
  camera: ["calm", "handheld", "energetic"],
  transition: ["whip", "zoom", "push", "flash", "glitch", "iris"],
  break_fx: ["sweep", "leak", "burn"],
  end_card: ["pill", "badge", "banner"],
  progress: ["bar", "thick", "dots", "none"],
  move: ["crash", "punch", "whip", "shake", "bump"],
} as const;

const PRO_FEEL: Record<string, Record<string, string>> = {
  hook_style: {
    slam: "each word slams in with a blur — punchy", rise: "words rise blur-to-sharp — smooth", blocks: "each line on a colour block — bold, editorial",
    marker: "the line lands, a highlighter sweeps the key word and an underline draws — explainer", stack: "one big word per line — poster feel (hook ≤ 4 words)",
  },
  font: { montserrat: "round, friendly, heavy", archivo: "wide and heavy", anton: "condensed, tall, loud", bebas: "condensed caps, clean and tall", poppins: "geometric, friendly", inter: "clean, modern" },
  caption_fx: { pop: "the spoken word scales up", color: "it turns the accent colour", box: "an accent box behind it", underline: "an accent bar under it" },
  grade: { warm: "warm, golden skin", punchy: "high contrast, saturated", clean: "bright and neutral", cool: "slightly cool, crisp", matte: "soft, lifted blacks, gentle", vivid: "very saturated, poppy" },
  camera: { calm: "steady, slow breathing push", handheld: "natural handheld float", energetic: "livelier float, bigger punches" },
  transition: { whip: "fast whip with motion blur", zoom: "zoom-through", push: "clean push", flash: "flash cut", glitch: "RGB-split glitch", iris: "iris / circle reveal" },
  break_fx: { sweep: "warm light band", leak: "soft light leak", burn: "film burn from an edge" },
  end_card: { pill: "big pressing button", badge: "round bag badge + label", banner: "diagonal banner" },
  progress: { bar: "thin top bar", thick: "rounded glowing bar", dots: "segmented dots", none: "no bar" },
};
const shortlist = (key: string, n: number) => shuffle(Object.keys(PRO_FEEL[key])).slice(0, n).map((k) => `"${k}" (${PRO_FEEL[key][k]})`).join(" | ");

export const PRO_DIRECTION = (recent: string[]) => `PRO FINISH — you are also the MASTER DIRECTING EDITOR of this video's finish. The render engine (HyperFrames) gives you the craft below; nothing is preset. Decide the treatment that serves THIS footage, speaker, product and angle — the way a top human TikTok editor would — and return it in "direction". This generation's options were drawn at random (another generation of the same video gets different ones on purpose): choose the best of them for this footage.
"direction": {
  "hook_style": ${shortlist("hook_style", 3)},
  "font": face of the hook and end card — ${shortlist("font", 3)},
  "caption_font": face of the captions — ${shortlist("font", 3)},
  "caption_fx": ${shortlist("caption_fx", 2)},
  "marker": true | false (coloured keywords get a highlighter sweep), "emoji": "above" | "beside" (where a keyword's emoji pops),
  "grade": colour grade of the footage — ${shortlist("grade", 3)},
  "grain": true | false (fine film grain for texture),
  "camera": virtual camera feel on the speaker — ${shortlist("camera", 2)},
  "transitions": one per B-roll cutaway, in order, from — ${shortlist("transition", 4)},
  "break_fx": light at section breaks — ${shortlist("break_fx", 2)},
  "end_card": ${shortlist("end_card", 2)},
  "progress": ${shortlist("progress", 2)},
  "second": "#RRGGBB" (a second colour that pairs with the accent),
  "moves": [{"at": CUE, "move": "crash" | "punch" | "whip" | "shake" | "bump", "power"?: 0.6–1.4}] — signature camera moves on the words that earn them (e.g. a crash zoom on the reveal, a punch-in on the price, a whip at a topic turn, a shake on a shock line); a few per video, at least 2 s apart, none in the last 3 s.
}
Craft notes (judgement, not rules): one main transition usually carries most cutaways with one or two accents; full-screen hits (shake, flash, crash) land hardest when rare; captions and stickers must stay readable over the grade; every choice must suit the product, the speaker's energy and the angle.
VARIETY — TikTok pushes down near-identical videos. ${recent.length ? `This client's recent edits used: ${recent.join(" | ")}. Give this one a clearly different combination (at least a different hook style, font, grade and end card).` : "Give this edit a combination of its own."}`;

function cleanDirection(d: any, nWords: number, duration: number): ProDirection | undefined {
  if (!d || typeof d !== "object") return undefined;
  const pick = (v: unknown, set: readonly string[]) => (typeof v === "string" && set.includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : undefined);
  const out: ProDirection = {
    hook_style: pick(d.hook_style, PRO_SETS.hook_style),
    font: pick(d.font, PRO_SETS.font),
    caption_font: pick(d.caption_font, PRO_SETS.font),
    caption_fx: pick(d.caption_fx, PRO_SETS.caption_fx),
    ...(typeof d.marker === "boolean" ? { marker: d.marker } : {}),
    ...(d.emoji === "above" || d.emoji === "beside" ? { emoji: d.emoji } : {}),
    grade: pick(d.grade, PRO_SETS.grade),
    ...(typeof d.grain === "boolean" ? { grain: d.grain } : {}),
    camera: pick(d.camera, PRO_SETS.camera),
    transitions: Array.isArray(d.transitions) ? d.transitions.map((t: unknown) => pick(t, PRO_SETS.transition)).filter(Boolean).slice(0, 16) as string[] : undefined,
    break_fx: pick(d.break_fx, PRO_SETS.break_fx),
    end_card: pick(d.end_card, PRO_SETS.end_card),
    progress: pick(d.progress, PRO_SETS.progress),
    ...(typeof d.second === "string" && /^#[0-9a-f]{6}$/i.test(d.second) ? { second: d.second } : {}),
    moves: Array.isArray(d.moves) ? d.moves.map((m: any) => {
      const at = cueIn(m?.at, nWords, duration);
      const move = pick(m?.move, PRO_SETS.move);
      if (at === undefined || !move) return null;
      const power = Number(m?.power);
      return { at, move, ...(Number.isFinite(power) ? { power: Math.min(1.4, Math.max(0.6, power)) } : {}) };
    }).filter(Boolean).slice(0, 10) as ProDirection["moves"] : undefined,
  };
  for (const k of Object.keys(out) as (keyof ProDirection)[]) if (out[k] === undefined || (Array.isArray(out[k]) && !(out[k] as unknown[]).length)) delete out[k];
  return Object.keys(out).length ? out : undefined;
}

/** One line per earlier edit (for the VARIETY note). */
export const directionSummary = (d: ProDirection | undefined | null): string | null =>
  d ? [d.hook_style, d.font, d.grade, d.end_card, d.caption_fx, d.camera].filter(Boolean).join("/") || null : null;

const HEX = /^#[0-9a-f]{6}$/i;
const EDIT_CUE = /^w\d{1,4}(?:\$)?(?:[+-]\d{0,2}(?:\.\d+)?)?$/i;
const KEY_COLORS = new Set(["benefit", "price", "pain", "brand", "accent"]);
const MOODS = new Set(["chill", "upbeat", "hype"]);
const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
// Google Noto emoji that have an animated (Lottie) version — the director
// should prefer these so stickers and caption emoji move.
const ANIMATED_EMOJI = "🔥 😱 🤯 😍 🥰 😂 🤣 😭 😋 🤩 😎 🤔 👀 👍 👏 🙏 💪 🎉 💯 ✅ ❤️ ✨ ⭐ 🚀 ⚡ 💥 🥳 🎁 ⏰ 🛒 😮 🤑 👇 👉 💡";

/** `auto` = the AI Auto brief (autoBrief()); without it the client's chosen style rules. */
export const DIRECTOR_SYSTEM = (style: MotionStyleId, guard = false, auto?: string) => {
  const look = motionStyle(style);
  const maxGap = auto ? "the chosen look's max gap" : `${look.maxGap} s`;
  return `You are PeningLab's TikTok video DIRECTOR. A Malaysian seller/creator uploaded their own talking video. You get its timed transcript and plan a professional short-form edit on top of it: hook, word-synced motion graphics, web B-roll cutaways, fact cards, punch-in zooms, keyword-coloured captions, a re-hook and the beg-kuning CTA. Captions are rendered automatically — you only choose which words get a colour/emoji.

${MOTION_MY_TIKTOK_GUIDE}

${auto ?? `STYLE = ${look.label.toUpperCase()} — ${look.edit}
Colour palette for this style: ${look.palette} — choose "accent" from it. Music "mood": usually "${look.mood}".`}

Return ONLY one JSON object:
{${auto ? `
  "angle": string (≤6 words), "look": one of the 2 LOOK ids, "hook_sound": one of the 5 HOOK SOUND indices, "music": true | false,
  "captions": {"style": one of the offered caption styles, "pos": "low" | "mid"},` : ""}
  "brand": string | null (the product / brand name as spoken or given, e.g. "Gluvera" — used to find the product's own website photos),
  "hook": {"text": string (≤5 words), "sub"?: string (≤5 words)} | null,
  "accent": "#RRGGBB",
  "mood": "chill" | "upbeat" | "hype",
  "overlays": [ITEM],
  "zooms": [{"at": CUE, "to": CUE, "scale": 1.08–1.25}],
  "broll": [{"at": CUE, "to": CUE, "layout": "full" | "pip", "kind": "photo" | "video", "query": string, "label"?: string (≤4 words)}],
  "facts": [{"at": CUE, "to": CUE, "query": string, "topic": string}],
  "keywords": [{"i": word index, "color": "benefit" | "price" | "pain" | "brand", "emoji"?: one emoji}],
  "rehook"?: {"at": CUE, "text": string (≤4 words)},
  "cta"?: {"at": CUE, "text": string (≤4 words, e.g. "Tekan beg kuning"), "sub"?: string (≤5 words)}
}
ITEM = {"t": TYPE, "text": string, "sub"?: string, "at": CUE, "to"?: CUE, "zone": "top" | "middle" | "bottom", "tone"?: "yellow"|"white"|"red"|"green"|"accent"|"dark", "mark"?: "check"|"cross"}
TYPE (on-screen text is SHORT, never a transcript):
  headline ≤4 words (top) · tag ≤3 words · stamp 1–2 words · chip ≤4 words (bottom) · tape ≤4 words (top) · scribble ≤6 words
  note ≤6 words (sub = struck-through word, mark check/cross) · check ≤4 words (bottom; mark "cross" for the old way)
  price = a price SPOKEN in the video (sub = old price if spoken) · counter = a number SPOKEN (sub = label)
  emoji = ONE emoji (prefer these animated ones: ${ANIMATED_EMOJI})
  bigword = the 1–2 strongest words, huge, ~1 s (zone middle) · callout = speech bubble ≤6 words (a reaction / aside)
  arrow = hand-drawn arrow pointing down at the speaker/product + ≤3-word label · stars = rating row, ONLY if a rating/review count is spoken (text = e.g. "4.9 · 2k terjual")
  circle = 1–3 words circled with a red marker loop — the key number / benefit ("8–12 JAM", "JIMAT") · underline = 1–3 words with a scribbled double underline (emphasis)
  point = bouncing pointing hand + ≤3-word label ("Tengok sini", "Ni dia") — sub = "👇" or "👉" · confetti = full-screen confetti (no text) for a real celebration moment: price reveal, free gift, the final CTA — max 2
  gif = animated reaction sticker — text = an ENGLISH search phrase ("mind blown", "thumbs up", "money rain", "shocked face"), sub = ONE fallback emoji; max 2, only on emotional beats
CUE: "w12" = when transcript word #12 starts, "w12$" = when it ends, "w12+0.3" offsets; plain seconds also OK.

RULES
- Hook covers 0–2.5 s: the video's promise in ≤5 punchy words. null if the video is under 5 s.
- Every overlay sits on the word it illustrates. Max 2 overlays on screen at once. Zones: top = headline/tag/tape/callout/arrow/fact area; bottom = chips/checks/cta (just above captions); middle = bigword/emoji/stamp/price only, briefly (don't cover the face for long).
- B-ROLL: pick moments where the speaker names something visual — the product, an ingredient, a place, a body part, an object, a brand, a problem. "query" = what to search on Google Images (English or Malay, specific). For shots of the product itself (box, packshot, the item in use) START the query with the brand name (e.g. "Gluvera patch box") — those come from the brand's own website first; for generic shots (a body part, an object, a place) leave the brand out. 1 B-roll every 6–10 s, each 1.5–3 s; "full" for the product / big reveals, "pip" (card over the upper half) otherwise. Never during the first 1.5 s or the CTA. "kind": "photo" for the product itself (its own website photos), "video" for a moving stock clip of a generic action or scene (someone sticking a patch on an arm, drinking water, walking, cooking) — the query for a video is plain English ("woman applying patch on arm"), never a brand.
- Mix the tools — a pro edit uses variety: circle / underline the key words, a point toward the product or the beg kuning, 0–2 gif reactions, 0–2 confetti, not the same sticker type twice in a row. The STYLE line wins over these defaults (a style that says "no emoji" / "no confetti" means none).
- SPREAD the edit over the WHOLE runtime: the middle and the last third get as many overlays as the opening — never more than ${maxGap} without a new overlay or B-roll (zooms alone don't count). Viewers drop off in the middle; that's where a callout, circle, check or re-hook keeps them.
- FACTS: 0–2 per video, only for checkable, non-medical background facts the speaker mentions (what an ingredient is, how something works in general, a brand/origin fact). "query" = a Google search that would confirm it. NEVER health/medical/cure/efficacy, price or "best/No.1" claims.
- KEYWORDS: 1 per caption page at most; colour product/brand names (brand), benefits (benefit), prices/numbers (price), problems (pain); add an emoji on ≤ 1 in 3.
- RE-HOOK: one, around 40–60 % of the runtime, only if the video is > 25 s ("Tapi tunggu…", "Ni paling penting…").
- CTA: only if the video sells something; place it on the last sentence (final 3–5 s). Use "Tekan beg kuning" unless the speaker says another CTA.
- Never invent prices, ratings, sales numbers, stock levels, claims or facts — no angle, look or spark changes that. Follow the CLIENT PROMPT (it overrides style choices, never the honesty rules).${guard ? `

${GUARD_RULES}
Risky spoken words are muted and taped in the captions automatically — never quote them on screen, never colour them as keywords, and steer the hook / stickers / re-hook to safe angles (how to use, convenience, routine, personal experience, price, beg kuning).` : ""}`;
};

export async function directEdit(opts: {
  words: DirectorWord[];
  duration: number;
  input: EditInput;
  hasFace?: boolean;
  /** Rendered on HyperFrames: the director also decides the PRO finish ("direction"). */
  pro?: boolean;
  /** The client's recent PRO finishes (directionSummary), so this one differs. */
  recent?: string[];
}): Promise<EditPlanV2> {
  const { words, duration, input } = opts;
  const pro = !!opts.pro;
  const auto = !!input.auto;
  const brief = auto ? autoBrief() : undefined;
  // The seller's own product photos (uploaded with the video): product shots
  // come ONLY from them; generic shots still come from Google (brand-free).
  const uploads = (input.productImages ?? []).filter((u) => /^https:\/\//.test(u)).slice(0, 5);
  const style = motionStyle(input.style).id;
  // AI Auto: the plan is checked against the look the director chose itself
  const lookOf = (raw: { look?: unknown } | null | undefined): MotionStyleId => (auto ? motionStyle(raw?.look).id : style);
  const transcript = words.slice(0, 1400).map((w) => `${w.i}@${w.t.toFixed(2)} ${w.w}`).join("\n");
  const userPrompt =
    `VIDEO: ${duration.toFixed(1)} s, ${words.length} words, language ${input.language}. Face on screen: ${opts.hasFace === false ? "no" : "yes"}.\n` +
    (input.product ? `PRODUCT / CONTEXT: ${clean(input.product, 300)}\n` : "") +
    (uploads.length
      ? `SELLER'S PRODUCT PHOTOS: ${uploads.length} uploaded. Product shots (the box, packshot, the item itself or in use) come ONLY from these — plan at most ${uploads.length} such B-roll moment${uploads.length === 1 ? "" : "s"}, their queries starting with the brand name. Generic shots (a body part, an action, a place, an object) come from a Google search — never name a brand in those queries.\n`
      : "") +
    (input.instructions ? `CLIENT PROMPT (follow it): ${clean(input.instructions, 900)}\n` : "") +
    (input.accent ? `PREFERRED ACCENT: ${input.accent}\n` : "") +
    (input.broll === false ? "B-ROLL: disabled — return \"broll\": [].\n" : "") +
    (input.facts === false ? "FACTS: disabled — return \"facts\": [].\n" : "") +
    `\nTRANSCRIPT (index@seconds word):\n${transcript || "(no speech detected)"}\n\nDirect the edit now. JSON only.`;

  // Inside the plan route's withDeadline(): the director may use the budget
  // minus ENRICH_RESERVE, so guard / B-roll / facts always get their turn.
  const end = currentDeadline();
  let raw: any = null;
  let lastErr = "";
  let director = ""; // "<provider>/<model>" that wrote the plan
  for (let attempt = 0; attempt < 2 && !raw; attempt++) {
    const r = await orChat({
      modelKey: "model_motion",
      systemPrompt: DIRECTOR_SYSTEM(style, !!input.guard, brief) + (pro ? `\n\n${PRO_DIRECTION(opts.recent ?? [])}\nInclude "direction" in the JSON object.` : ""),
      userPrompt: attempt === 0 ? userPrompt : `${userPrompt}\n\nYour previous answer was not valid JSON (${lastErr}). Return ONLY the JSON object.`,
      temperature: auto ? 0.9 : 0.7, // AI Auto: fresher ideas from video to video
      maxTokens: pro ? 8000 : 7000,
      // GRSAI latency swings (same prompt: 25 s on a flash model, 72 … 200 s on
      // the GPT ones). No answer in 40 s → the next model races alongside; the
      // first USABLE plan wins (a truncated / non-JSON answer keeps the race
      // going), and nothing runs past the plan's deadline.
      timeoutMs: 150_000,
      hedgeAfterMs: 40_000,
      validate: (c) => {
        try { const j = extractJson(c); validateDirectorPlan(j, words.length, duration, input, lookOf(j), auto); return true; } catch { return false; }
      },
      ...(end ? { deadline: end - ENRICH_RESERVE } : {}),
      stream: true,
    });
    if (!r.ok || !r.content) { lastErr = r.error || "empty"; continue; }
    try { raw = extractJson(r.content); director = `${r.provider ?? "?"}/${r.model ?? "?"}`; } catch (e: any) { lastErr = e?.message || "invalid"; }
  }
  if (!raw) throw new Error(`Director failed: ${lastErr}`);

  const plan = validateDirectorPlan(raw, words.length, duration, input, lookOf(raw), auto);
  if (pro) {
    const direction = cleanDirection(raw?.direction, words.length, duration);
    if (direction) plan.direction = direction;
  }
  const guard = !!input.guard;
  if (guard) await guardEditPlan(plan, words, input).catch(() => undefined);

  // Ground it: images + facts in parallel (each fail-soft).
  const factMoments = rawFacts(raw, words.length, duration)
    .map((f) => (guard ? { ...f, query: guardStripQuery(f.query) } : f))
    .filter((f) => !guard || (f.query.length >= 3 && guardHits(f.topic).length === 0));
  const [broll, facts] = await Promise.all([
    input.broll === false ? Promise.resolve([] as BRollPlan[]) : byDeadline(enrichBroll(plan.broll, guard, plan.brand, input.product, uploads), [] as BRollPlan[]),
    input.facts === false ? Promise.resolve([] as FactPlan[]) : byDeadline(writeFacts(factMoments, words), [] as FactPlan[]),
    byDeadline(resolveStickers(plan.overlays, guard), undefined),
  ]);
  // A B-roll card label that repeats a sticker ("Cara guna" twice) is dropped.
  const said = new Set(plan.overlays.map((o) => String(o.text || "").toLowerCase().replace(/[^a-z0-9]/g, "")).filter(Boolean));
  const dedupedBroll = broll.map((b) => (b.label && said.has(b.label.toLowerCase().replace(/[^a-z0-9]/g, "")) ? { ...b, label: undefined } : b));
  return { ...plan, director, broll: dedupedBroll, facts: guard ? facts.filter((f) => guardHits(f.text).length === 0) : facts };
}

/** Time kept for guard + B-roll + facts after the director answers. */
const ENRICH_RESERVE = 90_000;

/** A fail-soft enrichment step, given up (→ fallback) when the plan deadline arrives. */
function byDeadline<T>(p: Promise<T>, fallback: T): Promise<T> {
  const safe = p.catch(() => fallback);
  const end = currentDeadline();
  if (!end) return safe;
  return Promise.race([safe, new Promise<T>((res) => setTimeout(() => res(fallback), Math.max(0, end - Date.now() - 2000)))]);
}

// ── animated stickers ────────────────────────────────────────────────────────
// gif items carry an English search phrase; the sticker search (admin opt-in)
// gives the animation. No source → the job shows the item's fallback emoji.
async function resolveStickers(overlays: MotionItem[], guard: boolean): Promise<void> {
  const gifs = overlays.filter((o) => o.t === "gif");
  await Promise.all(gifs.map(async (o, k) => {
    const q = guard ? guardStripQuery(o.text || "") : String(o.text || "");
    if (q.length < 2) return;
    const hits = await searchStickers(q).catch(() => []);
    if (hits.length) o.src = hits[k % Math.min(3, hits.length)].url;
  }));
}

// ── TikTok guard on the director's own copy ──────────────────────────────────
// The director already got GUARD_RULES; this is the safety net: every string
// it wrote that still hits a rule is rewritten (one LLM call) or dropped,
// B-roll searches lose their medical words, and the rule-muted words never
// get a keyword colour.
async function guardEditPlan(plan: EditPlanV2, words: DirectorWord[], input: EditInput): Promise<void> {
  const slots: { text: string; set: (v: string | null) => void }[] = [];
  const hook = plan.hook;
  if (hook) {
    slots.push({ text: hook.text, set: (v) => { if (v) hook.text = v; else plan.hook = null; } });
    if (hook.sub) slots.push({ text: hook.sub, set: (v) => { hook.sub = v ?? undefined; } });
  }
  for (const it of plan.overlays) {
    if (it.text) slots.push({ text: it.text, set: (v) => { it.text = v ?? ""; } });
    if (it.sub) slots.push({ text: it.sub, set: (v) => { it.sub = v ?? undefined; } });
  }
  const rehook = plan.rehook;
  if (rehook) slots.push({ text: rehook.text, set: (v) => { if (v) rehook.text = v; else delete plan.rehook; } });
  const cta = plan.cta;
  if (cta) {
    slots.push({ text: cta.text, set: (v) => { cta.text = v ?? "Tekan beg kuning"; } });
    if (cta.sub) slots.push({ text: cta.sub, set: (v) => { cta.sub = v ?? undefined; } });
  }
  for (const b of plan.broll) if (b.label) slots.push({ text: b.label, set: (v) => { b.label = v ?? undefined; } });
  const fixed = await guardFixSlots(slots, input.product);

  const before = plan.overlays.length;
  plan.overlays = plan.overlays.filter((it) => it.t === "emoji" || (!!it.text && guardHits(it.text).length === 0));
  plan.broll = plan.broll
    .map((b) => ({ ...b, query: guardStripQuery(b.query) }))
    .filter((b) => b.query.length >= 3);
  plan.censor = guardCensorWords(words);
  const muted = new Set(plan.censor);
  plan.keywords = plan.keywords.filter((k) => !muted.has(k.i));
  plan.guard = { fixed, dropped: before - plan.overlays.length };
}

// ── validation ────────────────────────────────────────────────────────────────
function cueIn(c: unknown, nWords: number, duration: number): Cue | undefined {
  if (typeof c === "number" && Number.isFinite(c)) return c >= 0 && c < duration - 0.3 ? Math.round(c * 100) / 100 : undefined;
  if (typeof c !== "string") return undefined;
  const s = c.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) { const n = parseFloat(s); return n < duration - 0.3 ? n : undefined; }
  if (!EDIT_CUE.test(s)) return undefined;
  const m = /^w(\d+)/.exec(s);
  return m && Number(m[1]) < nWords ? s : undefined;
}

/** filter() predicate keeping at most `caps[type]` items of each capped type. */
const capPerType = (caps: Record<string, number>) => {
  const seen: Record<string, number> = {};
  return (it: MotionItem) => {
    if (!(it.t in caps)) return true;
    seen[it.t] = (seen[it.t] ?? 0) + 1;
    return seen[it.t] <= caps[it.t];
  };
};

const CAPTION_STYLES = new Set(["pop", "karaoke", "box", "tiktok"]);

export function validateDirectorPlan(raw: any, nWords: number, duration: number, input: EditInput, style: MotionStyleId, auto = false): EditPlanV2 & { broll: BRollPlan[] } {
  const look = motionStyle(style);
  // AI Auto: captions, music and the hook sound are the director's call too
  const capStyle = auto && CAPTION_STYLES.has(raw?.captions?.style) ? raw.captions.style as EditPlanV2["captions"]["style"] : input.captionStyle;
  const capPos = auto ? (raw?.captions?.pos === "mid" ? "mid" : "low") : input.captionPos;
  const hs = Number(raw?.hook_sound);
  const autoPicks: Partial<EditPlanV2> = auto ? {
    angle: clean(raw?.angle, 60) || undefined,
    look: look.id,
    energy: look.energy,
    music: typeof raw?.music === "boolean" ? raw.music : look.energy === "gempak",
    hookSound: Number.isInteger(hs) && hs >= 0 && hs < HOOK_SOUNDS.length ? hs : Math.floor(Math.random() * HOOK_SOUNDS.length),
  } : {};
  const maxOverlays = Math.max(3, Math.ceil(duration / look.overlayEvery));
  const overlays = (Array.isArray(raw?.overlays) ? raw.overlays : [])
    .map((it: any) => cleanItemPublic(it, EDIT_CUE))
    .filter((it: MotionItem | null): it is MotionItem => !!it && cueIn(it.at, nWords, duration) !== undefined)
    .map((it: MotionItem) => (it.to !== undefined && cueIn(it.to, nWords, duration) === undefined ? { ...it, to: undefined } : it))
    .filter(capPerType({ gif: 2, confetti: 2 }))
    .slice(0, maxOverlays);
  const zooms = (Array.isArray(raw?.zooms) ? raw.zooms : [])
    .map((z: any) => {
      const at = cueIn(z?.at, nWords, duration);
      if (at === undefined) return null;
      const to = cueIn(z?.to, nWords, duration);
      return { at, ...(to !== undefined ? { to } : {}), scale: Math.min(1.25, Math.max(1.05, Number(z?.scale) || 1.14)) };
    })
    .filter(Boolean)
    .slice(0, Math.max(2, Math.ceil(duration / look.zoomEvery))) as EditPlanV2["zooms"];
  const broll: BRollPlan[] = (Array.isArray(raw?.broll) ? raw.broll : [])
    .map((b: any) => {
      const at = cueIn(b?.at, nWords, duration);
      const query = clean(b?.query, 100);
      if (at === undefined || !query) return null;
      const to = cueIn(b?.to, nWords, duration);
      return { at, ...(to !== undefined ? { to } : {}), layout: b?.layout === "full" ? "full" : "pip", label: clean(b?.label, 30) || undefined, query, candidates: [],
        kind: b?.kind === "video" ? "video" : "photo" };
    })
    .filter(Boolean)
    .slice(0, Math.max(1, Math.ceil(duration / 5))) as BRollPlan[];
  const keywords = (Array.isArray(raw?.keywords) ? raw.keywords : [])
    .map((k: any) => {
      const i = Number(k?.i);
      if (!Number.isInteger(i) || i < 0 || i >= nWords || !KEY_COLORS.has(k?.color)) return null;
      const emoji = typeof k?.emoji === "string" ? Array.from(k.emoji.trim()).slice(0, 2).join("") : "";
      return { i, color: k.color, ...(emoji && /\p{Extended_Pictographic}/u.test(emoji) ? { emoji } : {}) };
    })
    .filter(Boolean)
    .slice(0, 80) as EditPlanV2["keywords"];
  const hookText = clean(raw?.hook?.text, 40);
  const accent = HEX.test(input.accent || "") ? input.accent! : HEX.test(raw?.accent) ? raw.accent : "#FFD93B";
  const rehookAt = cueIn(raw?.rehook?.at, nWords, duration);
  const ctaAt = cueIn(raw?.cta?.at, nWords, duration);
  const brand = clean(raw?.brand, 40) || clean(String(input.product || "").split(/[,(|\-–]/)[0], 40);
  return {
    ...(brand ? { brand } : {}),
    hook: hookText && duration >= 5 ? { text: hookText, ...(raw?.hook?.sub ? { sub: clean(raw.hook.sub, 40) } : {}) } : null,
    accent,
    mood: MOODS.has(raw?.mood) ? raw.mood : look.mood,
    captions: { on: input.captions, style: capStyle, pos: capPos, maxWords: capStyle === "karaoke" ? 4 : 3 },
    ...autoPicks,
    overlays,
    zooms,
    broll,
    facts: [],
    keywords,
    ...(rehookAt !== undefined && clean(raw?.rehook?.text, 30) && duration > 20 ? { rehook: { at: rehookAt, text: clean(raw.rehook.text, 30) } } : {}),
    ...(ctaAt !== undefined && clean(raw?.cta?.text, 30) ? { cta: { at: ctaAt, text: clean(raw.cta.text, 30), ...(raw?.cta?.sub ? { sub: clean(raw.cta.sub, 34) } : {}) } } : {}),
  };
}

function rawFacts(raw: any, nWords: number, duration: number) {
  return (Array.isArray(raw?.facts) ? raw.facts : [])
    .map((f: any) => {
      const at = cueIn(f?.at, nWords, duration);
      const query = clean(f?.query, 120);
      if (at === undefined || !query) return null;
      const to = cueIn(f?.to, nWords, duration);
      return { at, ...(to !== undefined ? { to } : {}), query, topic: clean(f?.topic, 80) };
    })
    .filter(Boolean)
    .slice(0, 3) as { at: Cue; to?: Cue; query: string; topic: string }[];
}

// ── B-roll: seller photos + Google Images + vision pick ──────────────────────
// Product shots (the moment's query names the brand):
//   • the seller uploaded product photos → ONLY those (each photo leads one
//     moment; vision -1 → that moment has no B-roll) — never another brand's box
//   • no uploads → the brand's own sales websites first (Google web + image
//     search that skip marketplaces / social sites), then general Google Images
// Generic shots (a body part, an action, a place) → stock clips / general
// Google Images, and vision only accepts an image with NO product packaging,
// label or brand on it — that's where competitors' boxes used to slip in.
async function enrichBroll(moments: BRollPlan[], guard = false, brand?: string, product?: string, uploads: string[] = []): Promise<BRollPlan[]> {
  if (!moments.length) return [];
  const prefs = await getSitePrefs();
  // Finding the sales site uses the full product name (medical words included —
  // it's only a lookup; whatever is printed on its photos gets taped later).
  const productName = String(product || "").split(",")[0];
  const brandName = String(brand || productName).trim();
  const token = brandName.toLowerCase().split(/\s+/)[0]?.replace(/[^a-z0-9]/g, "") || "";
  const isProduct = (m: BRollPlan) => !!token && m.query.toLowerCase().replace(/[^a-z0-9 ]/g, "").includes(token);
  const own: ImageHit[] = uploads.map((url, k) => ({ url, title: `seller product photo ${k + 1}` }));
  const sites = !own.length && prefs.brandFirst && token.length >= 3 && moments.some(isProduct)
    ? await findBrandSites(brandName, prefs, productName).catch(() => [] as string[])
    : [];
  const noSites = excludeOperators(prefs.exclude);
  const usable = (hits: ImageHit[] | undefined) => dropExcluded((hits ?? []).filter(goodImage), prefs.exclude);
  const pool = own.length ? own
    : sites.length ? usable(await brandImagePool(sites, brandName, productName, prefs.exclude).catch(() => [])) : [];

  // Product shots draw from the pool — the photos best matching the moment's
  // words first, each moment getting different ones; brand-site shots are
  // topped up by a general search when the pool runs short.
  const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
  const used = new Map<string, number>();
  const fromPool = moments.map((m) => {
    if (!isProduct(m) || !pool.length) return [] as ImageHit[];
    if (own.length) {
      const ranked = rankImages(own, m.query, used);
      for (const h of ranked.slice(0, 3)) used.set(h.url, (used.get(h.url) ?? 0) + 1);
      return ranked;
    }
    const q = words(m.query);
    const ranked = [...pool].sort((a, b) => {
      const sa = [...words(`${a.title ?? ""} ${a.url}`)].filter((w) => q.has(w)).length - (used.get(a.url) ?? 0) * 3;
      const sb = [...words(`${b.title ?? ""} ${b.url}`)].filter((w) => q.has(w)).length - (used.get(b.url) ?? 0) * 3;
      return sb - sa;
    }).slice(0, 4);
    for (const h of ranked) used.set(h.url, (used.get(h.url) ?? 0) + 1);
    return ranked;
  });
  const results = await Promise.all(moments.map(async (m, k) => {
    const productShot = isProduct(m);
    // The seller's own photos: those only — no search for a product shot.
    if (productShot && own.length) return { kind: "photo" as const, hits: fromPool[k], source: "own" as const };
    // Moving cutaway: stock clips (vision sees their thumbnails); none → photos.
    if (m.kind === "video") {
      const clips = await searchClips(m.query).catch(() => []);
      if (clips.length) {
        return { kind: "video" as const, hits: clips.map((c) => ({ url: c.url, thumb: c.thumb, width: c.width, height: c.height, title: m.query })), source: "stock" as const };
      }
    }
    let hits = fromPool[k];
    if (hits.length < 3) {
      const more = usable((await searchImages(`${m.query} ${noSites}`, { num: 10 }).catch(() => null))?.hits);
      const seen = new Set(hits.map((h) => h.url));
      hits = [...hits, ...more.filter((h) => !seen.has(h.url))];
    }
    return { kind: "photo" as const, hits, source: productShot ? ("brand" as const) : ("generic" as const) };
  }));
  const withHits = moments
    .map((m, k) => ({ m: { ...m, kind: results[k].kind }, hits: results[k].hits, source: results[k].source }))
    .filter((x) => x.hits.length > 0);
  if (!withHits.length) return [];

  // Vision picks the best of the first 3 per moment — batches of ≤ 8 moments
  // (24 images) per call, all batches in parallel.
  const batches: (typeof withHits)[] = [];
  for (let i = 0; i < withHits.length; i += 8) batches.push(withHits.slice(i, i + 8));
  const picked = await Promise.all(batches.map((b) => visionPick(b, guard, brandName || undefined).catch(() => null)));
  const picks: (number | undefined)[] = batches.flatMap((b, i) => b.map((_, k) => picked[i]?.[k]));
  const shown = new Set<string>();
  return withHits
    .map(({ m, hits, source }, k) => {
      const choice = picks?.[k];
      if (choice === -1) return null; // vision said none match
      let order = typeof choice === "number" && choice >= 0 && choice < hits.length ? [hits[choice], ...hits.filter((_, j) => j !== choice)] : hits;
      if (source === "own") {
        // the seller's few photos: each one leads one moment at most — no repeats
        order = order.filter((h) => !shown.has(h.url));
        if (!order.length) return null;
        shown.add(order[0].url);
      }
      return { ...m, candidates: order.slice(0, 5).map((h) => h.url) };
    })
    .filter(Boolean) as BRollPlan[];
}

/** Photos best matching a B-roll query (title / file-name words), least-used first. */
function rankImages(pool: ImageHit[], query: string, used: Map<string, number>, n = 5): ImageHit[] {
  const set = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
  const q = set(query);
  const score = (h: ImageHit) => [...set(`${h.title ?? ""} ${h.url}`)].filter((w) => q.has(w)).length - (used.get(h.url) ?? 0) * 2;
  return pool.map((h, i) => ({ h, s: score(h), i })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, n).map((x) => x.h);
}

function goodImage(h: ImageHit): boolean {
  if (!/^https:\/\//i.test(h.url)) return false;
  if (/\.(svg|gif)(\?|$)/i.test(h.url)) return false;
  if (h.width && h.height && Math.min(h.width, h.height) < 400) return false;
  if (/(lookaside\.fbsbx|lookaside\.instagram|instagram\.f|cdninstagram|tiktokcdn|x\.com\/|twimg)/i.test(h.url)) return false; // usually blocked / expiring
  return true;
}

const SOURCE_NOTE: Record<string, string> = {
  own: " [the seller's own product photos — pick the one that best fits]",
  generic: " [GENERIC SHOT — only an image with NO product packaging, box, label, logo or brand name on it; -1 if every option shows one]",
};

async function visionPick(items: { m: BRollPlan; hits: ImageHit[]; source?: string }[], guard = false, brand?: string): Promise<number[] | null> {
  const images: string[] = [];
  const lines: string[] = [];
  items.forEach(({ m, hits, source }, k) => {
    const opts = hits.slice(0, 3);
    lines.push(`Moment ${k} — query "${m.query}"${m.label ? ` (label "${m.label}")` : ""}${SOURCE_NOTE[source ?? ""] ?? ""}: images ${opts.map((_, j) => `#${images.length + j}`).join(", ")}`);
    for (const h of opts) images.push(h.thumb || h.url);
  });
  if (images.length > 24) return null;
  const r = await orChatVision({
    modelKey: "model_motion",
    systemPrompt: "You pick B-roll images for a TikTok edit. For each moment choose the image that best and most literally matches the query (real product/object, clean, no big watermark, not a meme, not text-heavy, safe for ads)." +
      ` The video sells ${brand ? `"${brand}"` : "the seller's own product"}: never pick an image showing ANOTHER brand's name, logo, packaging or ad copy (a competitor's product shot) — generic unbranded shots of a body part, object or scene are fine; answer -1 when every option is another brand's ad.` +
      (guard ? " TIKTOK GUIDELINE MODE (TikTok Shop Malaysia 2026): never pick an image showing doctors / white coats / stethoscopes, hospitals, syringes or injections, glucometers, blood, wounds or graphic skin close-ups, pills, before/after bodies or skin, or a poster full of health claims / disease names — prefer clean product or lifestyle shots; answer -1 when every option is like that." : "") +
      " Answer ONLY JSON: {\"picks\":[n0,n1,...]} where n is the 0-based position WITHIN that moment's own images (0..2), or -1 if none fits.",
    textPrompt: lines.join("\n") + "\nImages are attached in order #0, #1, …",
    images,
    temperature: 0.2,
    maxTokens: 400,
    timeoutMs: 60_000,
    hedgeAfterMs: 25_000,
    stream: true,
  });
  if (!r.ok || !r.content) return null;
  const j = extractJson(r.content);
  return Array.isArray(j?.picks) ? j.picks.map((x: any) => (Number.isInteger(x) ? x : 0)) : null;
}

// ── fact cards: Google web search + strict summariser ────────────────────────
async function writeFacts(moments: { at: Cue; to?: Cue; query: string; topic: string }[], words: DirectorWord[]): Promise<FactPlan[]> {
  if (!moments.length) return [];
  const noSites = excludeOperators((await getSitePrefs()).exclude);
  const res = await Promise.all(moments.map((m) => searchWeb(`${m.query} ${noSites}`, { num: 5 }).catch(() => null)));
  const blocks = moments.map((m, k) => {
    const hits: WebHit[] = res[k]?.hits ?? [];
    return `FACT ${k} — topic "${m.topic || m.query}"\n` + hits.slice(0, 5).map((h, j) => `  [${j}] (${h.domain}) ${h.title}: ${h.snippet}`).join("\n");
  });
  if (!res.some((r) => (r?.hits?.length ?? 0) > 0)) return [];
  const r = await orChat({
    modelKey: "model_motion",
    systemPrompt: "You write on-screen fact cards for a Malaysian TikTok video. Use ONLY the numbered search snippets given — never outside knowledge. For each FACT return {\"text\": Malay, ≤12 words, a neutral checkable fact, \"src\": snippet number} or null when the snippets don't clearly support a useful fact. NEVER write health/medical/cure/treatment/efficacy claims, prices, rankings or superlatives — return null instead. Answer ONLY JSON: {\"facts\":[...]} in the same order.",
    userPrompt: blocks.join("\n\n"),
    temperature: 0.2,
    maxTokens: 900,
    timeoutMs: 60_000,
    hedgeAfterMs: 25_000,
    stream: true,
  });
  if (!r.ok || !r.content) return [];
  const j = extractJson(r.content);
  const out: FactPlan[] = [];
  (Array.isArray(j?.facts) ? j.facts : []).forEach((f: any, k: number) => {
    const m = moments[k];
    const hits = res[k]?.hits ?? [];
    const src = hits[Number(f?.src)] ?? hits[0];
    const text = clean(f?.text, 90);
    if (!m || !f || !text || !src) return;
    if (/(ubat|rawat|sembuh|penyakit|diabetes|kencing manis|kanser|cure|treat|heal|disease|klinikal|terbukti)/i.test(text)) return;
    out.push({ at: m.at, ...(m.to !== undefined ? { to: m.to } : {}), text, source: src.domain });
  });
  void words;
  return out;
}

// ── visual QA ─────────────────────────────────────────────────────────────────
export type QaPatch = { drop_overlays: number[]; move: { idx: number; zone: "top" | "middle" | "bottom" }[]; drop_broll: number[]; pip_broll: number[]; notes?: string };

export async function qaPatch(opts: {
  stills: { frame: number; t: number; active: string[]; image: string }[];
  overlays: { idx: number; t?: string; text?: string; zone?: string }[];
  broll: { idx: number; layout?: string }[];
}): Promise<QaPatch | null> {
  const stills = opts.stills.slice(0, 6);
  if (!stills.length) return null;
  const desc = stills.map((s, k) => `Still ${k} @${s.t.toFixed(1)}s — active: ${s.active.join(" | ") || "none"}`).join("\n");
  const r = await orChatVision({
    modelKey: "model_motion",
    systemPrompt: "You are the QA editor of an automated TikTok edit (9:16). Look at the stills and find REAL problems only: an overlay covering the speaker's eyes/mouth for long, overlays overlapping each other or the captions, text cut off at the frame edge, unreadable text, a B-roll image that is wrong/irrelevant/watermarked/low-quality, a full-screen B-roll hiding an important moment. Fix with the smallest change. Answer ONLY JSON: {\"drop_overlays\":[idx], \"move\":[{\"idx\":n,\"zone\":\"top|middle|bottom\"}], \"drop_broll\":[idx], \"pip_broll\":[idx], \"notes\":\"≤20 words\"}. Use the overlay/broll idx numbers from the lists. Empty arrays when it looks good.",
    textPrompt: `${desc}\n\nOVERLAYS: ${JSON.stringify(opts.overlays).slice(0, 4000)}\nBROLL: ${JSON.stringify(opts.broll)}`,
    images: stills.map((s) => s.image),
    temperature: 0.2,
    maxTokens: 700,
    timeoutMs: 90_000,
    hedgeAfterMs: 40_000,
    stream: true,
  });
  if (!r.ok || !r.content) return null;
  const j = extractJson(r.content);
  const ints = (a: any, max: number) => (Array.isArray(a) ? a.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < max) : []);
  const nO = opts.overlays.length;
  const nB = opts.broll.length;
  const dropO = ints(j?.drop_overlays, nO).slice(0, Math.ceil(nO / 3)); // never strip the edit bare
  return {
    drop_overlays: dropO,
    move: (Array.isArray(j?.move) ? j.move : [])
      .map((m: any) => ({ idx: Number(m?.idx), zone: m?.zone }))
      .filter((m: any) => Number.isInteger(m.idx) && m.idx >= 0 && m.idx < nO && ["top", "middle", "bottom"].includes(m.zone)),
    drop_broll: ints(j?.drop_broll, nB),
    pip_broll: ints(j?.pip_broll, nB),
    notes: clean(j?.notes, 160),
  };
}
