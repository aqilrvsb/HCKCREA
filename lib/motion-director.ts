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
import { searchClips, searchPhotos, searchStickers } from "@/lib/motion-media";
import { MOTION_EDIT_PRESETS, MOTION_MY_TIKTOK_GUIDE } from "@/lib/motion-prompts";
import { MOTION_STYLES, motionStyle, type MotionEnergy, type MotionStyleId } from "@/lib/motion-styles";
import type { MotionLocks } from "@/lib/motion-manual";
import { HOOK_SOUNDS } from "@/lib/motion-hook-sounds";
import { vgcStyle, type VaultStyle } from "@/lib/vgc-styles";
import { extractJson, cleanItemPublic, type EditInput, type MotionItem } from "@/lib/motion";
import { GUARD_RULES, guardCensorWords, guardFixSlots, guardHits, guardStripQuery } from "@/lib/motion-guard";
import { HEADLINE_SPEC, applyOwnHeadlines, cleanHeadlines, enrichHeadlines, type HeadlinePlan } from "@/lib/motion-headline";
import { ingredientShots, withIngredientShots, type IngredientShot } from "@/lib/motion-ingredients";

type Cue = string | number;
const clean30 = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
export type DirectorWord = { i: number; w: string; t: number; e?: number };

export type BRollPlan = {
  at: Cue; to?: Cue; layout: "full" | "pip"; label?: string; query: string; candidates: string[];
  /** video = stock clip (candidates are MP4 links); photo otherwise. */
  kind?: "photo" | "video";
  /** pinned (an ingredient the speaker names): the composition makes room for it, nothing drops it */
  must?: boolean;
  /** the owner's sourcing rule: "product" = the product's own story (the product, its ingredients, how it is used)
   *  → Google Images; "story" = a new scene that adds to the story → Pixabay stock */
  about?: "product" | "story";
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
  cta?: { at: Cue; text: string; sub?: string; kind?: "bag" | "live" };
  /** REQUIRED headline layouts (over the speaker, a split panel, the speaker docked) — lib/motion-headline.ts */
  headlines?: HeadlinePlan[];
  /** the closing director's selling beats and what the code added for the ones nothing hit (diagnostics) */
  beats?: { kind: string; at: Cue; say: string; filled?: boolean }[];
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
  hook_style?: string; font?: string; caption_font?: string; caption_fx?: string; caption_look?: string; marker?: boolean; emoji?: "above" | "beside";
  grade?: string; grain?: boolean; camera?: string; transitions?: string[]; break_fx?: string; end_card?: string; progress?: string;
  second?: string; moves?: { at: Cue; move: string; power?: number }[];
  /** a picked style's own scene colours (bg "style") and the surface over the video */
  palette?: { bg: string; ink: string }; texture?: string;
  /** HyperFrames registry blocks (motion-hf/overrides/blocks.ts) with their own fields. */
  graphics?: ({ block: string; at: Cue; to?: Cue } & Record<string, unknown>)[];
  /** "subtle" = explainer captions (small words building), "big" = TikTok captions. */
  captions?: "big" | "subtle";
  /** "light" = no flashes / confetti / break light / automatic shakes (the calm explainer feel). */
  fx?: "full" | "light";
  /** Full-screen explainer scenes over the voice (motion-hf/overrides/scenesPro.tsx). */
  scenes?: Record<string, unknown>[];
  /** Big stacked words beside the speaker. */
  side?: Record<string, unknown>[];
  /** News strips over the speaker (a "TERKINI" tag, the headline, an optional ticker). */
  banner?: Record<string, unknown>[];
  /** A huge word behind the speaker's head (the speaker cut-out is drawn over it). */
  behind?: Record<string, unknown>[];
  /** The director's beat sheet (beat → tool), written before the tools: logged with the job, not rendered. */
  strategy?: Record<string, unknown>[];
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
/** The FYP playbook (TikTok Shop Academy 2026 + TikTok Creative Center) — AI Auto's brief and Custom Style's master director. */
const FYP_PLAYBOOK = `- Hook: land the video's strongest promise by 2.5 s — hook text, the spoken line and the visual say the same thing, tied to the product; hook sound + a zoom or text pop make something move in the first second. Build the hook from what is said: problem → fix, before / after, a price or promo shock (show a spoken price within 3 s), a pain-point question, first try / unboxing.
- Payoff early: show the benefit or result within 10–15 s — never save the product for the end; name / point at the product by ~3 s.
- Rhythm: fast hook, steadier middle, fast peak, quick ending. Change something on screen at the chosen look's pace; zoom at sentence turns and key words, the biggest zoom on the main claim or the price.
- Re-hook (videos > 30 s) at 40–50 % with an open loop ("tapi yang paling best…", a twist, a counter).
- Readability: every sticker enters on its spoken word and leaves before the next idea; on screen ≥ (its words ÷ 3 + 0.5) s, headlines and prices ≥ 2 s; ≤ 2 overlays at once; never over the face or the product.
- B-roll: 1.5–2.5 s each on the noun or claim being spoken, never two back to back, the speaker on screen most of the time (cutaways ≤ 40 % of the runtime).
- Trust sells in Malaysia: give real proof the speaker mentions (counter for "dah guna X", a verdict stamp, a check list) — never invented.
- CTA in the last 3–5 s, text + arrow down to the beg kuning; real urgency only. If the hook is about price / promo, a soft early "beg kuning" chip is fine.
- Music off when the product makes its own satisfying sound, for a heartfelt testimonial or very dense fast talk.
- TikTok Shop now pushes down near-identical videos — this one must not look like a template.`;

/** How a top editor uses the kit, beat by beat — the PRO direction and Custom Style's master director. */
const TOOL_PLAYBOOK = `- HOOK (0–2.5 s): hook title (headline / slam / blocks…), a crash zoom or "lines" on the hook word; a float card with a badge when there is a product / source picture; a gif reaction only for an emotional hook.
- THE SPEAKER'S STRONGEST LINE ON CAMERA: side words (small lead-in + big word) or ONE "behind" word (product name, result, verdict) — between scenes only.
- PAIN / PROBLEM: a red build that strikes the wrong belief; "lines" or a shake on the shock word; a gif (shocked face) at most once.
- MYTH vs FACT · DO vs DON'T · BEFORE vs AFTER · OLD vs NEW: split.
- BENEFITS · WHERE · WHAT'S INSIDE (a list): checklist. HOW TO USE · ROUTINE · PROCESS: steps. THINGS OVER TIME / DATES: timeline.
- NUMBERS: one big number → stat build (count / roll); a percentage → ring; two numbers → compare; several values over time → chart; a price → burst in a collage or a roll line; a bundle / what you get for the price → receipt (+ stamp).
- A RULE · LABEL · CLAIM · QUOTE the speaker unpacks: annotate (mark the words, handwritten notes). NEWS · REGULATION · SOURCE: article card, or a banner over the speaker.
- A QUESTION VIEWERS ASK (read out / answered): chat "comments". A CONVERSATION RECOUNTED: chat "chat". ORDERS / REMINDERS MENTIONED: chat "notif".
- PLACES · DELIVERY · STOCKISTS · BRANCHES: map.
- THE PRODUCT SHOWN TO CAMERA: a punch-in or "spotlight" (the room dims, the speaker stays lit); a product picture → polaroid / phone card or B-roll.
- RE-HOOK at 40–50 %: a "smash" cut on ONE word, or a swap line ("MURAH? MAHAL?" → "BERBALOI"), or a tilt.
- EMOTIONAL / PERSONAL MOMENT: stay on the speaker (spotlight allowed), no scene.
- A LONG SCENE (> ~6 s) WHERE TRUST MATTERS: give it "speaker": "left" | "right" (the face stays on screen as a sticker).
- CLOSING: a question build ("JADI KORANG RASA…?" → "KOMEN KAT BAWAH") right before the CTA; then the end card or the spoken CTA with side words.
- CAPTION LOOK by energy: hard sell → hormozi / beast; tutorial → popline / deep / pill; playful product → sticker / karaoke; fast talker → fill; drama / night → neon; podcast / talk → pod; TikTok-native → sweep; a scene-heavy news explainer → "captions": "subtle".
- Signature moments (behind, smash, spotlight, lines, crash) land hardest when rare: 2–4 per video, each on a different beat.`;

/**
 * Custom Style (Claude Code on HyperFrames, Sonnet 5.5) gets the same master director as Default: the client's VGC
 * prompt / chosen style still decides the LOOK; this decides the structure, the strategy and the selling craft, with
 * the rules Default's edits learned (grounding, layout safety). One source: Default's playbooks above.
 */
export function customDirectorPlaybook(source: "motion" | "footage"): string {
  const footage = source === "footage";
  return `

--- MASTER DIRECTOR (PeningLab) ---
You are also the master director of this video — the same director PeningLab's Default edits use. The VGC brief and the
chosen style above decide the LOOK (palette, type, motion feel); this decides the STRUCTURE, the strategy and the
selling craft. Where they disagree on look, the style wins; on structure, timing and facts, this wins.
1. Plan first: write ./video/STORYBOARD.md as a beat sheet before building — every beat in time order with the viewer's
   job (hook · pain · myth · benefits · how · proof · number · price · place · question · product · rehook · emotion ·
   close · cta), what is ${footage ? "said" : "said / shown"} there, and the device from the TOOL PLAYBOOK that tells it
   best. Build from that plan.
2. FYP PLAYBOOK:
${FYP_PLAYBOOK}
3. TOOL PLAYBOOK (device names as in the workspace's explainer rules — scenes, side words, text behind the speaker, split,
   checklist, steps, timeline, stat build, ring, compare, chart, annotate, article card, chat / comments, map, receipt,
   spotlight, smash cut, caption looks):
${TOOL_PLAYBOOK}
4. Ground rules:
- Only words, numbers and prices that are ${footage ? "spoken in the footage" : "in the client's brief"} or given by the client reach the screen — never invented.
${footage
    ? "- The voice is 100 % the speaker's own (./bahan/footage.mp4); no AI voice-over. Keep the speaker on screen most of the time: full-screen scenes about 45–70 % of a talking explainer, less for a personal story."
    : "- No footage: the product, the hook, the benefits, the proof, the price and the CTA carry the beats; a chosen AI voice-over carries the words."}
- Stickers and text never cover the speaker's eyes (forehead, hijab, chin are fine), never overlap each other or the captions;
  captions sit below a low face; the CTA card sits above the face or below it, never on the eyes; big text behind or over the
  head stays inside the frame at the camera's zoom.`;
}

/** The client's style (one of the 40 of the style library): its whole brief directs the edit, translated onto the kit. */
function styleBlock(vs: VaultStyle): string {
  const pal = vs.colors?.length === 3 ? ` Its palette: background ${vs.colors[0]}, text ${vs.colors[1]}, accent ${vs.colors[2]}.` : "";
  return `CLIENT-PICKED STYLE — "${vs.name}" (${vs.group}). The client chose this style for this video from PeningLab's style library.${pal} Its full brief (below, verbatim) is the CREATIVE DIRECTION of this edit: a viewer must recognise this style at first glance, from the first frame to the last. You build it with THIS engine — PeningLab's HyperFrames kit on the speaker's own footage — so translate EVERY part of the brief into the kit's choices, and use the kit's full range to get as close to the style as it can:
- Look & layout, colour → "palette" (the style's background + text colours) with "bg": "style" on most scenes, "accent", "second", tones, "grade", "grain", sticker / side-word tones, how much of the frame graphics take;
- Typography → "font", "caption_font", "caption_look" (or captions "subtle"), "hook_style", scene line sizes, "box" and "enter" styles. The kit has a face for each kind of type a brief may describe — serif / editorial → "playfair", mono / technical / typewriter → "mono", hand-drawn / marker → "marker", pixel / 8-bit → "pixel", comic lettering → "comic", soft / rounded → "rounded", plus six heavy sans — use the one the brief's typography names for "font" (captions may stay on a readable sans);
- Motion → "camera", "moves" (which ones, how often, how hard), "transitions", "fx" (full / light), scene "enter" styles and how lines land;
- Pacing → the "look" whose pace rules fit it, the share of the runtime in scenes, how fast scene items build, the gap between stickers;
- Audio direction → "music", "mood", the hook sound, how loud the hits are;
- Assets & Avoid → hard limits: whatever the brief says to avoid is not used anywhere in the plan.
The brief was written for a video built in code: skip its lines about tools, skills, installs, approvals, writing code, rendering, exporting or synthesising audio — PeningLab's engine does those. The footage and the voice stay the speaker's own (never a new person, never fake speech). Where the style and the FYP playbook below disagree on the LOOK (palette, type, texture, motion feel, pace), the style wins; on the hook in the first 2.5 s, honesty, facts and selling, the playbook wins.
--- STYLE BRIEF: ${vs.name} ---
${vs.brief}
--- END OF STYLE BRIEF ---

`;
}

function autoBrief(input?: EditInput, vs?: VaultStyle | null): string {
  const locks = input?.locks;
  // a picked style: every look is on the menu (the one whose pace fits the style wins), not a random 2
  const lookOpts = locks?.look ? [motionStyle(locks.look)] : vs ? MOTION_STYLES : shuffle(MOTION_STYLES).slice(0, 2);
  const looks = lookOpts.map((l) =>
    `- ${l.id} (${l.label}: ${l.desc}) — ${l.edit} Palette: ${l.palette}. Max gap ${l.maxGap} s. Music mood: ${l.mood}.`).join("\n");
  const anglePool = [
    ...MOTION_EDIT_PRESETS.map((a) => ({ label: a.label.replace(/^\P{L}+/u, ""), desc: firstSentence(a.prompt) })),
    ...EXTRA_ANGLES,
  ];
  const angles = (locks?.angle ? [{ label: locks.angle.label.replace(/^\P{L}+/u, ""), desc: firstSentence(locks.angle.brief) }] : shuffle(anglePool).slice(0, 4))
    .map((a) => `- ${a.label}: ${a.desc}`).join("\n");
  const sounds = shuffle(HOOK_SOUNDS.map((s, i) => `${i} = ${s}`)).slice(0, 5).join("\n");
  const formulas = shuffle(HOOK_FORMULAS).slice(0, 3).map((f) => `- ${f}`).join("\n");
  const caps = (vs ? [...CAPTION_CHOICES] : shuffle(CAPTION_CHOICES).slice(0, 2)).map((c) => `"${c}"`).join(" or ");
  const spark = SPARKS[Math.floor(Math.random() * SPARKS.length)];
  const colour = input?.accent || (vs?.colors?.[2] ?? ACCENTS[Math.floor(Math.random() * ACCENTS.length)]);
  return `${locks ? clientChoices(input!) : ""}${vs ? styleBlock(vs) : ""}AI AUTO — YOU ARE THE CREATIVE DIRECTOR AND THE EDITOR. ${vs ? "The client chose the STYLE above; everything else is your call" : "The client chose nothing"}: read the WHOLE transcript first, understand the product, the speaker's energy and what actually happens in the video, then decide EVERYTHING yourself. Goal: stop the scroll, keep people watching to the end, push the beg kuning — and beat what a skilled human TikTok editor would make of this footage, so it has its best shot at the For You Page.
Decide, in this order:
This generation's options were drawn at random — choose ONLY from them, the best fit for this footage (another generation of the same video gets different options on purpose):
1. "angle": ONE of the 4 ANGLES below — frame this footage through it honestly (a tutorial video can still be told as a POV, a soft-sell story, a myth-buster…); name it in ≤6 words.
2. "look": the id of ONE of the ${lookOpts.length} LOOKS below${vs ? " — the one whose pace and energy fit the client's style best (the style decides colour and type; the look sets the sticker rhythm and the render energy)" : ""}. Follow its pace rules.
   "accent": ${vs?.colors && !input?.accent ? `the style's accent ${colour} — use it (or a close shade that stays readable on this footage)` : `this generation's colour is ${colour} — use it (or a close shade) unless it truly clashes with the chosen look; then take the nearest colour from the look's palette`}.
3. "captions": {"style": ${caps}, "pos": "low" | "mid"} — "mid" only when hands / the product fill the bottom of the frame (ignored when the client switched captions off).
4. "hook": write it with ONE of the HOOK FORMULAS below, from what is really said.
5. "hook_sound": the index of ONE of the 5 HOOK SOUNDS below, the one whose feel matches your hook (it plays as the hook text lands).
6. "music": true when a music bed lifts it (selling energy, montage feel, light talk with breathing gaps); false when the voice must carry it alone (emotional story, dense fast talk, ASMR, a detailed tutorial). "mood" sets its feel.
7. Then the edit itself — stickers, B-roll, zooms, keywords, re-hook, CTA — built around the angle and the look.
FYP PLAYBOOK (TikTok Shop Academy 2026 + TikTok Creative Center):
${FYP_PLAYBOOK}
${vs ? `THINK IT UP FRESH INSIDE THE STYLE: no stock hook line, no template — find the idea that is special about THIS footage and build the whole edit around it, in "${vs.name}" from start to end.` : `THINK IT UP FRESH: treat this video as a brand-new creative brief — no default template, no safe go-to look, no stock hook line. Find the idea that is special about THIS footage and build the whole edit around it. Creative spark for this edit: "${spark}" — use it for one signature move only if it fits the content honestly; ignore it if it doesn't.`}

LOOKS — pick ${lookOpts.length === 1 ? "this one (the client chose it)" : `one of these ${lookOpts.length}`} (id — feel — pace rules — palette — max gap — music mood):
${looks}

ANGLES — pick ${locks?.angle ? "this one (the client chose it)" : "one of these 4"}:
${angles}

HOOK FORMULAS — pick one:
${formulas}

HOOK SOUNDS — pick one (index = sound — suits):
${sounds}`;
}

/** "Saya nak pilih sendiri": the client's picks, stated as rules that override every option and rule after them. */
function clientChoices(input: EditInput): string {
  const l = input.locks ?? {};
  const out: string[] = [];
  // the angle frames the story exactly as an AI Auto angle does (label + one line) — the preset's full brief was
  // written for the old sticker-only editor and, as a rule, it overrode the playbook (emoji / callout / punch-in recipes)
  if (l.angle) out.push(`Sales angle: "${l.angle.label.replace(/^\P{L}+/u, "")}" — ${firstSentence(l.angle.brief)} The hook and the story MUST use this angle (even when the footage reads as something else — find how it fits); how to edit it stays your call (playbook below).`);
  if (l.hook) out.push(`Hook: use exactly "${l.hook}" as hook.text (you may add a short "sub").`);
  // a picked angle that the hook doesn't voice reads as AI Auto's default (a tutorial video kept a "Cara guna …" hook under POV)
  else if (l.angle) out.push(`Hook: written in the "${l.angle.label.replace(/^\P{L}+/u, "")}" angle — e.g. a POV angle opens "POV: …" in the viewer's situation, a promo angle on the price / offer, a review on the verdict, before / after on the change — from what is said.`);
  if (l.cta) out.push(`CTA: use exactly "${l.cta}" as cta.text, in the last 3–5 s.`);
  if (l.look) out.push(`Look: "${l.look}" — follow its pace rules.`);
  if (input.accent) out.push(`Accent colour: ${input.accent}.`);
  if (l.captionLook === "tiktok") out.push(`Captions: style "tiktok".`);
  if (l.captionPos) out.push(`Captions position: "${l.captionPos}".`);
  if (typeof l.music === "boolean") out.push(`Music: ${l.music}.`);
  if (l.mood) out.push(`Music mood: "${l.mood}".`);
  const el = l.elements ?? {};
  if (el.gif === true) out.push("GIF stickers: 1–2 \"gif\" reactions on the most emotional beats.");
  if (el.gif === false) out.push("GIF stickers: none (no \"gif\" items).");
  if (el.emoji === true) out.push("Animated emoji: 2–4 — \"emoji\" items and keyword emoji on the key words.");
  if (el.emoji === false) out.push("Animated emoji: none (no \"emoji\" items, no keyword emoji).");
  if (input.instructions) out.push("The client's own notes (CLIENT PROMPT, in the message) — follow them.");
  return out.length ? `CLIENT CHOICES — the client picked these in the form; they are RULES and override any option or rule below:\n${out.map((x) => `- ${x}`).join("\n")}\nEverything the client did not pick is your call, exactly as below — aim for the same level a top editor reaches in AI Auto. When two picks pull different ways (e.g. a fast angle with a calm look), keep the look's pace and colour and carry the angle through the hook, the words on screen and the scenes.\n\n` : "";
}

// ── PRO direction (Laju v2 on HyperFrames) ───────────────────────────────────
// The render engine offers the craft; the director decides how THIS video uses
// it. Each option is described by its feel, never assigned to a content type
// as a rule — the model weighs footage, speaker, product and angle itself.
const PRO_SETS = {
  hook_style: ["slam", "rise", "blocks", "marker", "stack", "headline"],
  font: ["montserrat", "archivo", "anton", "bebas", "poppins", "inter", "playfair", "mono", "marker", "pixel", "comic", "rounded"],
  caption_fx: ["pop", "color", "box", "underline"],
  texture: ["none", "paper", "film", "crt", "halftone", "grid", "glow"],
  caption_look: ["hormozi", "beast", "karaoke", "popline", "deep", "pill", "fill", "pod", "sticker", "sweep", "neon"],
  grade: ["warm", "punchy", "clean", "cool", "matte", "vivid"],
  camera: ["calm", "handheld", "energetic"],
  transition: ["whip", "zoom", "push", "flash", "glitch", "iris"],
  break_fx: ["sweep", "leak", "burn"],
  end_card: ["pill", "badge", "banner", "none"],
  progress: ["bar", "thick", "dots", "none"],
  move: ["crash", "punch", "whip", "shake", "bump", "lines", "tilt", "smash", "spotlight"],
} as const;

const PRO_FEEL: Record<string, Record<string, string>> = {
  hook_style: {
    slam: "each word slams in with a blur — punchy", rise: "words rise blur-to-sharp — smooth", blocks: "each line on a colour block — bold, editorial",
    marker: "the line lands, a highlighter sweeps the key word and an underline draws — explainer", stack: "one big word per line — poster feel (hook ≤ 4 words)",
    headline: "news-explainer title: white stroked line, then its last part (or the hook \"sub\") wiped in on a colour box — calm authority",
  },
  font: {
    montserrat: "round, friendly, heavy", archivo: "wide and heavy", anton: "condensed, tall, loud", bebas: "condensed caps, clean and tall", poppins: "geometric, friendly", inter: "clean, modern",
    playfair: "high-contrast serif, sentence case — editorial, magazine, luxury, documentary, archive", mono: "monospace caps — technical, data, blueprint, dossier, retro computer",
    marker: "hand-drawn marker caps — scrapbook, notes, DIY, annotations", pixel: "8-bit pixel caps — retro game, pixel art (very wide: short words)",
    comic: "comic-book caps — comic, pop art, sports impact, loud fun", rounded: "soft rounded — friendly, playful vector, clay, cute, kids",
  },
  texture: {
    none: "no surface — clean", paper: "paper fibre + soft edges on the scenes — scrapbook, paper, stop-motion, archive",
    film: "old film over the whole video: flicker, scratches, dust, warm vignette — retro film, nostalgia", crt: "CRT over the whole video: scanlines, RGB mask, a rolling band — retro desktop, pixel, VHS",
    halftone: "halftone dots on the scenes — comic, pop art, print, poster", grid: "blueprint grid lines drifting on the scenes — blueprint, data, technical, plans",
    glow: "accent glow light on the scenes, glowing scene text — dark tech, neon noir, premium night",
  },
  caption_fx: { pop: "the spoken word scales up", color: "it turns the accent colour", box: "an accent box behind it", underline: "an accent bar under it" },
  caption_look: {
    hormozi: "caps, thick stroke, 2–3 short lines, one emphasis word per page in green / yellow — hard sell",
    beast: "loud yellow caps, the emphasis word green with a glow, bouncy tilt — hype, giveaways",
    karaoke: "caps, the spoken word pops in green / yellow — energetic default",
    popline: "caps, the spoken word grows over a purple bar — tutorials",
    deep: "lowercase dark words on a white box, grey → black as spoken — calm educator",
    pill: "sentence case on soft grey pills, words fill in as spoken — soft sell, UGC review",
    fill: "one caps line, spoken words stay lit in mint — fast talkers",
    pod: "big condensed caps, 1–2 words, hard cuts, one word hot pink — podcast / explainer",
    sticker: "CapCut sticker text: coloured words with a white outline popping in one by one — playful product hooks",
    sweep: "a red box slides from word to word — TikTok-native emphasis",
    neon: "condensed caps flickering on, the key word glowing cyan — night, tech, drama",
  },
  grade: { warm: "warm, golden skin", punchy: "high contrast, saturated", clean: "bright and neutral", cool: "slightly cool, crisp", matte: "soft, lifted blacks, gentle", vivid: "very saturated, poppy" },
  camera: { calm: "steady, slow breathing push", handheld: "natural handheld float", energetic: "livelier float, bigger punches" },
  transition: { whip: "fast whip with motion blur", zoom: "zoom-through", push: "clean push", flash: "flash cut", glitch: "RGB-split glitch", iris: "iris / circle reveal" },
  break_fx: { sweep: "warm light band", leak: "soft light leak", burn: "film burn from an edge" },
  end_card: { pill: "big pressing button", badge: "round bag badge + label", banner: "diagonal banner", none: "no end card — the speaker says the CTA, side words may carry it (the explainer ending)" },
  progress: { bar: "thin top bar", thick: "rounded glowing bar", dots: "segmented dots", none: "no bar" },
};
/** n options drawn at random; `keep` is always among them (the reference-level choice stays on the menu). */
/** The options this call offered, per field (PRO_DIRECTION fills it; enforceShortlists holds the plan to it). */
type Shortlists = Record<string, string[]>;
let LISTS: Shortlists | null = null;
/** The client's PRO picks for this call (field → value): its shortlist is that value alone. */
let LOCKED: Record<string, string> | null = null;
/** The faces added for the 40 styles: offered only when a style is picked (AI Auto keeps its six). */
const STYLE_FACES = new Set(["playfair", "mono", "marker", "pixel", "comic", "rounded"]);
/** A picked style: every option of the kit is offered (the style's brief decides), no random draw. */
let STYLED: string | null = null;
const shortlist = (key: string, n: number, keep?: string, field: string = key) => {
  const lock = LOCKED?.[field];
  if (lock && PRO_FEEL[key][lock]) {
    if (LISTS) LISTS[field] = [lock];
    return `"${lock}" (${PRO_FEEL[key][lock]}) — the client chose it`;
  }
  if (STYLED) {
    const every = Object.keys(PRO_FEEL[key]);
    if (LISTS) LISTS[field] = every;
    return every.map((k) => `"${k}" (${PRO_FEEL[key][k]})`).join(" | ");
  }
  const rest = shuffle(Object.keys(PRO_FEEL[key]).filter((k) => k !== keep && !(key === "font" && STYLE_FACES.has(k)))).slice(0, keep ? n - 1 : n);
  const picked = shuffle(keep ? [keep, ...rest] : rest);
  if (LISTS) LISTS[field] = picked;
  return picked.map((k) => `"${k}" (${PRO_FEEL[key][k]})`).join(" | ");
};
/** PRO_DIRECTION plus the shortlists it drew. */
export const proDirectionWithLists = (recent: string[], locks?: MotionLocks, style?: string | null): { text: string; lists: Shortlists } => {
  LISTS = {};
  LOCKED = proLocked(locks);
  STYLED = style ?? null;
  try { return { text: PRO_DIRECTION(recent) + proLockText(locks), lists: LISTS }; } finally { LISTS = null; LOCKED = null; STYLED = null; }
};

/** The PRO fields a manual pick decides. Gaya edit sets the pace (its rules are in the brief); effects / camera stay the AI's
 *  call as in AI Auto — forcing a calm look to light effects + a calm camera made manual edits flatter than AI Auto. */
function proLocked(locks?: MotionLocks): Record<string, string> | null {
  if (!locks) return null;
  const out: Record<string, string> = {};
  if (locks.font) out.font = locks.font;
  if (locks.grade) out.grade = locks.grade;
  if (locks.endCard) out.end_card = locks.endCard;
  if (locks.captionLook && locks.captionLook !== "tiktok") out.caption_look = locks.captionLook;
  return Object.keys(out).length ? out : null;
}

const SCENE_SHARE: Record<string, { cover: number; keep: number; say: string }> = {
  many: { cover: 0.72, keep: 2, say: "45–70 % of the runtime (the news / explainer feel)" },
  some: { cover: 0.45, keep: 1, say: "about 25–45 % of the runtime — the speaker is seen often" },
  few: { cover: 0.25, keep: 0, say: "at most 2 short scenes, under 25 % of the runtime — the speaker on screen almost all the time" },
};

/** The client's picks for the finish, as rules that override the PRO rules above them. */
function proLockText(locks?: MotionLocks): string {
  if (!locks) return "";
  const out: string[] = [];
  if (locks.scenes) out.push(`SCENES: ${SCENE_SHARE[locks.scenes].say} (this replaces the 45–70 % rule).`);
  if (locks.fx) out.push(`"fx": "${locks.fx}".`);
  const el = locks.elements ?? {};
  if (el.behind === true) out.push(`"behind": exactly 1 word, on the speaker's strongest line between scenes.`);
  if (el.behind === false) out.push(`"behind": [] (none).`);
  if (el.spotlight === true) out.push(`"moves": include exactly 1 "spotlight" (a confession, a secret or a warning).`);
  if (el.spotlight === false) out.push(`"moves": no "spotlight".`);
  if (el.smash === true) out.push(`"moves": include exactly 1 "smash" (the single biggest beat).`);
  if (el.smash === false) out.push(`"moves": no "smash".`);
  return out.length ? `\n\nCLIENT CHOICES FOR THE FINISH — rules, they override the PRO rules above:\n${out.map((x) => `- ${x}`).join("\n")}` : "";
}

/** The client's picks written into the finish (the model may leave a field out or drift from it). */
function applyProLocks(d: ProDirection, locks?: MotionLocks): void {
  if (!locks) return;
  const set = proLocked(locks) ?? {};
  for (const [k, v] of Object.entries(set)) (d as Record<string, unknown>)[k] = v;
  if (locks.fx) d.fx = locks.fx;
  const el = locks.elements ?? {};
  if (el.behind === false) d.behind = [];
  if (Array.isArray(d.moves)) {
    d.moves = d.moves.filter((m: any) => !(el.spotlight === false && m?.move === "spotlight") && !(el.smash === false && m?.move === "smash"));
  }
}
/** A choice outside this call's shortlist (the model drifting to a favourite) becomes the shortlist's first option:
 *  the random draw is what keeps a client's videos from looking alike. */
function enforceShortlists(d: ProDirection, lists: Shortlists): void {
  const one = (field: keyof ProDirection, list?: string[]) => {
    const v = d[field];
    if (list?.length && typeof v === "string" && !list.includes(v)) (d as Record<string, unknown>)[field] = list[0];
  };
  one("hook_style", lists.hook_style);
  one("font", lists.font);
  one("caption_font", lists.caption_font);
  one("caption_fx", lists.caption_fx);
  one("caption_look", lists.caption_look);
  one("grade", lists.grade);
  one("camera", lists.camera);
  one("break_fx", lists.break_fx);
  one("end_card", lists.end_card);
  one("progress", lists.progress);
  if (Array.isArray(d.transitions) && lists.transition?.length) {
    const t = d.transitions.filter((x) => lists.transition.includes(x));
    d.transitions = t.length ? t : [lists.transition[0]];
  }
}

export const PRO_DIRECTION = (recent: string[]) => `PRO FINISH — you are also the MASTER DIRECTING EDITOR of this video's finish. The render engine (HyperFrames) gives you the craft below; nothing is preset. Decide the treatment that serves THIS footage, speaker, product and angle — the way a top human TikTok editor would — and return it in "direction". ${STYLED ? `The client picked the style "${STYLED}" (its brief is above): every option of the kit is offered — choose the ones that make this video read as that style, for this footage.` : "This generation's options were drawn at random (another generation of the same video gets different ones on purpose): choose the best of them for this footage."}
"direction": {
  "strategy": [{"at": CUE, "beat": "hook" | "pain" | "myth" | "benefits" | "how" | "proof" | "number" | "price" | "place" | "question" | "product" | "rehook" | "emotion" | "close" | "cta", "tool": ≤40 (the device you give it, e.g. "split MITOS|FAKTA", "behind PALSU", "checklist")}] (4–12) — WRITE THIS FIRST: the video's beat sheet in time order, each beat with the tool from the TOOL PLAYBOOK below that tells it best; everything after follows this plan,
  "hook_style": ${shortlist("hook_style", 3, "headline")},
  "font": face of the hook and end card — ${shortlist("font", 3)},
  "caption_font": face of the captions — ${shortlist("font", 3, undefined, "caption_font")},
  "caption_fx": ${shortlist("caption_fx", 2)},
  "caption_look": the creator caption style of the big captions (it replaces caption_fx) — ${shortlist("caption_look", 4)},
  "marker": true | false (coloured keywords get a highlighter sweep), "emoji": "above" | "beside" (where a keyword's emoji pops),
  "grade": colour grade of the footage — ${shortlist("grade", 3)},
  "grain": true | false (fine film grain for texture),
  "camera": virtual camera feel on the speaker — ${shortlist("camera", 2)},
  "transitions": one per B-roll cutaway, in order, from — ${shortlist("transition", 4)},
  "break_fx": light at section breaks — ${shortlist("break_fx", 2)},
  "end_card": ${shortlist("end_card", 2, "none")},
  "progress": ${shortlist("progress", 2)},
  "second": "#RRGGBB" (a second colour that pairs with the accent),${STYLED ? `
  "palette": {"bg": "#RRGGBB", "ink": "#RRGGBB"} — the style's own scene colours: every scene with "bg": "style" is drawn on "bg" with its text in "ink" (start from the style's palette; keep them readable),
  "texture": the surface of the whole video — ${shortlist("texture", 7)},` : ""}
  "moves": [{"at": CUE, "move": "crash" | "punch" | "whip" | "shake" | "bump" | "lines" | "tilt" | "smash" | "spotlight", "power"?: 0.6–1.4, "text"?: ≤14 (smash only)}] — signature camera moves on the words that earn them (e.g. a crash zoom on the reveal, a punch-in on the price, a whip at a topic turn, a shake on a shock line, "lines" = manga focus lines burst around the face with a punch-in — a shock, a "WAJIB", a twist; "tilt" = a quick dutch-angle lean — a playful or "wait, what?" beat; "smash" = a smash cut: 0.4 s of black with ONE huge spoken word ("text"), then a hard cut back with a punch-in — the single biggest beat of the video, at most once; "spotlight" = for ~2.4 s the room behind the speaker dims and blurs while the speaker stays lit — a confession, a secret, a serious warning); a few per video, at least 2 s apart, none in the last 3 s,
  "graphics": [GRAPHIC] — optional motion-design moments in the band above the face (0–2 per video, each block type once, never during a B-roll card, the hook or the end card; a graphic replaces a sticker at that moment — never repeat a sticker's words or put both on the same beat):
    {"block": "count-up", "at": CUE, "to"?: CUE, "end": number, "start"?: number, "prefix"?: string (≤4, e.g. "RM"), "suffix"?: string (≤4, e.g. "%", " jam")} — a number counts up and lands: ONLY a number the speaker says,
    {"block": "star-rating-fill", "at": CUE, "to"?: CUE, "rating": 0–5} — stars fill to a rating: ONLY a rating the speaker says,
    {"block": "shutter-slam", "at": CUE, "to"?: CUE, "text": 1–2 words (≤14 chars)} — one word thrown through shutter-blurred beats: the single most important spoken word,
  "captions": "big" (bold TikTok captions) | "subtle" (small caps words that build as spoken — the explainer look, when scenes carry the message),
  "fx": "full" (flashes, confetti, light breaks, automatic shakes on the big hits) | "light" (none of those — only your own "moves"; the calm news / explainer feel),
  "scenes": [SCENE] — EXPLAINER SCENES: full-screen motion-graphic scenes that cut away from the speaker while the voice keeps playing (the news / explainer TikTok style); each line, entry or sticker enters on the word that says it:
    {"kind": "build", "at": CUE, "to": CUE, "bg": BG, "heading"?: small caps label (≤40, e.g. "1. Cara guna", "Nama dia"), "lines": [{"at": CUE, "text": ≤26, "size": "sm"|"md"|"lg"|"xl", "tone"?: TONE, "box"?: "yellow"|"black"|"white"|"accent", "enter"?: "slam" | "slide" | "type" (typewriter with a caret) | "scramble" (glyphs settle into the word — a reveal, a secret) | "letters" (letters pop in one by one) | "rise" (wipes up out of a mask) | "outline" (an outline lands, then the fill sweeps in) | "swap" (with "options": [2–3 short words] — the slot rolls through them and lands on "text": "MURAH? MAHAL?" → "BERBALOI", a guess game, a correction), "fx"?: "count" (its number counts up) | "marker" (a highlighter sweeps it) | "strike" (it gets crossed out — a myth, a wrong belief, the old price) | "circle" (a hand-drawn marker loop around it) | "underline" (a hand-drawn underline) | "arrow" (a hand-drawn arrow points at it) | "box" (a hand-drawn box) | "sparkle" (stars pop around a punchline) | "roll" (its digits spin into place like an odometer — prices, totals) | "extrude" (a 3D block shadow — the big claim) | "shine" (a gloss sweeps across it), "emoji"?: one emoji that pops on its corner (🔥 ✅ ❌ 💡 😱 👍 ⚠️ …)}] (≤6)} — numbered points, a stat that builds (a word, then the big number, then what it means), a punchline, a closing question to the viewer,
    {"kind": "timeline", "at": CUE, "to": CUE, "bg": BG, "kicker"?: ≤24, "title": ≤30, "entries": [{"at": CUE, "date": ≤20 (a date, a step or a "when" word), "lines": [≤24, ≤24?], "tone"?: TONE}] (≤4)} — steps, a before → after, what happens over time,
    {"kind": "collage", "at": CUE, "to": CUE, "bg": BG, "title"?: ≤22 (ransom-note letter tiles), "stickers": [{"at": CUE, "text": ≤24, "sub"?: ≤20, "kind": "note"|"strip"|"burst"|"tag", "tone"?: TONE}] (≤4)} — places / options / prices pinned up like a mood board (burst = a starburst for a price or number),
    {"kind": "card", "at": CUE, "to": CUE, "bg": BG, "style": "polaroid" | "article" | "float" | "phone", "heading"?: ≤40, "caption"?: ≤110 (the headline / point in the speaker's words), "source"?: ≤24 (only a source the speaker names), "date"?: ≤24 (only a spoken date), "badge"?: ≤14 (float, e.g. "VIRAL", "TERKINI", "BARU"), "highlight"?: [words of the caption a highlighter sweeps]} — a picture card: plan a B-roll at the same moment and its picture is shown here. "polaroid" = photo + caption; "article" = a web-news card (headline · source · date · picture) for a rule, a claim or news the speaker cites; "float" = a smaller card floating over the speaker with a badge — it may OPEN the video right under the hook title, and never covers the face; "phone" = the picture on a phone screen (an app, a shop page, a screenshot, a chat),
    {"kind": "compare", "at": CUE, "to": CUE, "bg": BG, "title"?: ≤30, "bars": [{"at": CUE, "label": ≤16, "value": ≤12, "tone"?: TONE}] (2–4)} — columns that grow on their words: numbers become bar heights (0.35% vs 0.6%, RM100 vs RM99.65, 2 jam vs 10 minit), words alone read as A vs B,
    {"kind": "checklist", "at": CUE, "to": CUE, "bg": BG, "heading"?: ≤40, "items": [{"at": CUE, "text": ≤28, "mark": "check" | "cross", "tone"?: TONE}] (≤6)} — each box ticks ✓ (or crosses ✗ for a don't) on its word: benefits, where to apply, do / don't lists, what's inside,
    {"kind": "steps", "at": CUE, "to": CUE, "bg": BG, "heading"?: ≤40, "steps": [{"at": CUE, "title": ≤28, "sub"?: ≤30, "tone"?: TONE}] (2–4)} — numbered circles joined by a line that draws to the next step: how to use, a routine, a process,
    {"kind": "ring", "at": CUE, "to": CUE, "bg": BG, "heading"?: ≤40, "rings": [{"at": CUE, "value": 0–100, "label": ≤20, "tone"?: TONE}] (1–3)} — percentage rings that fill while the number counts: ONLY a percentage the speaker says (or a plain share like "9 daripada 10" = 90),
    {"kind": "chart", "at": CUE, "to": CUE, "bg": BG, "heading"?: ≤40, "chart": {"type": "line" | "area" | "bars", "unit"?: ≤6 ("RM", "%", " jam"), "points": [{"at": CUE, "label": ≤10, "value": number}] (2–8)}} — a chart that draws on its spoken points, the value riding the tip (red when it falls): ONLY numbers the speaker says — a price over time, before → after, a drop, a rise,
    {"kind": "split", "at": CUE, "to": CUE, "sides": [{"title": ≤14, "tone"?: TONE, "items": [{"at": CUE, "text": ≤30}] (≤4)}, {same}], "marks"?: false} — the frame splits into two coloured halves (left red ✗, right green ✓ by default): MITOS | FAKTA, JANGAN | BOLEH, SEBELUM | SELEPAS, ORANG LAIN | KITA; each item lands on its word (no "bg"),
    {"kind": "annotate", "at": CUE, "to": CUE, "bg": BG, "text": ≤80 (a key sentence the speaker says, held big in the middle), "notes": [{"at": CUE, "word": a word / short phrase IN that text, "note": ≤26 (a handwritten note), "mark": "highlight" | "circle" | "underline" | "box"}] (1–3)} — the Vox-style explainer: the sentence stays while its words get marked and annotated one by one as the speaker unpacks them (a rule, a claim, a label, a quote),
    {"kind": "map", "at": CUE, "to": CUE, "bg": BG, "heading"?: ≤40, "places": [{"at": CUE, "name": a Malaysian state / federal territory / big town ("Johor", "KL", "Penang", "Kota Kinabalu", "Ipoh") or "seluruh Malaysia" / "Semenanjung" / "Sabah Sarawak", "label"?: ≤18 ("Stokis", "Hantar 2 hari", "Kedai baru"), "tone"?: TONE}] (≤6)} — a map of Malaysia: each spoken place lights its state with a pin and a label; "seluruh Malaysia" sweeps every state on (delivery everywhere, stockists, branches, where customers are) — ONLY places the speaker names,
    {"kind": "receipt", "at": CUE, "to": CUE, "bg": BG, "title"?: ≤30 (the shop / bundle name), "items": [{"at": CUE, "label": ≤22, "value": ≤12 ("RM39", "PERCUMA")}] (≤6), "total"?: {"at": CUE, "label"?: ≤12 ("JUMLAH", "BAYAR"), "value": ≤12}, "stamp"?: {"at": CUE, "text": ≤16 ("JIMAT RM20", "PERCUMA POS")}} — a receipt printing out item by item, the total counting up, a red stamp slamming on: a bundle, what you get for the price, a promo — ONLY prices the speaker says,
    {"kind": "chat", "at": CUE, "to": CUE, "bg": BG, "style": "comments" | "chat" | "notif", "title"?: ≤30 (sheet / contact name), "messages": [{"at": CUE, "text": ≤90, "who"?: "them" | "me", "name"?: ≤20, "likes"?: ≤8}] (≤6)} — "comments" = a comment sheet whose rows slide in (a question viewers ask, that the speaker reads out or answers), "chat" = a message thread with typing dots (a conversation the speaker recounts: "customer tanya…", "saya jawab…"), "notif" = notification banners dropping in (an order, a reminder, a message the speaker mentions). ONLY words the speaker actually says — never invent reviews, testimonials, names or numbers (no "name" unless the speaker says one),
    BG = "dark" (charcoal, warm glow, faint grid) | "red" | "accent" | "paper" | "cork" | "yellow" | "blue" | "notebook" (lined school paper, red margin — tips, tutorials) | "chalk" (green chalkboard in a wooden frame — teacher, lessons) | "grid" (graph paper — numbers, plans) | "gradient" (deep night with drifting colour light — premium, emotional) | "burst" (a sunburst turning behind a slammed word or price)${STYLED ? ` | "style" (the "palette" colours — the style's own background: give MOST scenes "style"; use another background only when the style's brief would use it too — e.g. a paper or notebook background for a paper / editorial / scrapbook style, never a background whose colours or mood the brief rules out)` : ""}; TONE = "white" | "yellow" | "green" | "red" | "blue" | "accent";
    any scene may set "speaker": "left" | "right" (the speaker stays on screen as a die-cut sticker in that bottom corner while the scene plays — keeps the face and trust on screen during a long scene; at most 2 scenes per video), "enter": "cut" (default — the hard explainer cut) | "push" | "zoom" | "whip" | "wipe" | "rise" | "iris" | "tear" (torn paper rises — paper / notebook scenes), and "rain": one emoji that rains over it (💸 money talk, 💧 water, 🔥 hot deal, 😭 pain…),
    a scene lasts 1.5–14 s, never during the hook (a float card may) or the CTA; stickers and B-roll pause under it; keep the speaker on screen for the hook, the personal / emotional moments and the CTA,
  "behind": [{"at": CUE, "to"?: CUE, "text": ≤14 (1–2 spoken words), "tone"?: TONE}] — ONE HUGE WORD standing behind the speaker's head (the speaker is cut out and drawn over it — the viral "text behind the person" look): 0–2 per video, on the speaker's strongest word while THEY are on screen (the speaker shot between scenes, never inside a scene's time where it can't show; the product name, the result, "PALSU", "RM39"); never together with side words, a banner or a sticker (a sticker on the same moment is dropped — never also plan the same word as a bigword),
  "banner": [{"at": CUE, "to"?: CUE, "tag": ≤12 ("TERKINI", "PENTING", "INFO", "AMARAN", "FAKTA"), "text": ≤48 (the headline in the speaker's words), "ticker"?: ≤90 (a running line of the key facts said)}] — a news strip over the speaker (a blinking tag, the headline wiping open, a ticker): 0–2 per video, for a fact, a rule, news or a warning while the speaker is on screen; never together with side words,
  "side": [{"at": CUE, "to"?: CUE, "align": "left" | "right" | "center", "words": [{"at": CUE, "text": ≤16, "tone"?: TONE, "size"?: "sm" | "md" | "lg"}] (1–3, stacked)}] — big words beside the speaker's head on the line that deserves them; mix sizes like an editor ("KEPUTUSAN" sm → "RHB" lg → "SENDIRI" md yellow), or "center" for ONE huge embossed word over the head on a punchline ("PALSU"). Only words that carry meaning (a claim, a number, a key noun / verb) — never fillers or interjections ("haa", "okey", "eh", "korang", "kan").
Every scene / side word shows ONLY words, numbers and facts the speaker actually says — short, punchy, in their language.
THE REFERENCE LEVEL (a top Malaysian news-explainer TikTok, the bar to reach when the content allows): a calm "headline" hook title with a float card of the source (badge "VIRAL") under it; the speaker states each point while side words land on the strongest words; every point then cuts (hard cut) to its own scene, numbered "1. … / 2. … / 3. …": a dark build whose lines slam in word by word ("TAKDE CHARGE" green → "BAYAR RM100" → "TOLAK RM100 JE" on a yellow box), a red stat build ("NAMA DIA" → "MDR" xl → "0.35%" count, yellow → "0.6%" → "KAD KREDIT" on a black box), a cork / paper collage (tag heading "CONTOHNYA", yellow note, starburst price, red strip), an article card of the news with its key words highlighted, a timeline of dates (green / red / yellow dots), a compare of two numbers; between scenes the speaker with side words; a closing question build right before the CTA ("JADI KORANG RASA…?" → "KOMEN KAT BAWAH" on a yellow box); "captions": "subtle", "fx": "light", no end card or a quiet one. For a selling / product video the same kit tells the product story (a stat build of the result, a compare of before → after or price vs value, a card of the product, a collage of variants / uses, a timeline of the routine) — still built from what is said.
HOW A TOP EXPLAINER EDITOR BUILDS THIS VIDEO — this is the default bar for every talking video (selling, tutorial, review, tips, news); step away from it only for a purely emotional story or a clip under ~12 s. A client prompt or selling recipe (checklists, price tags, zooms, a CTA) is delivered INSIDE this structure — a checklist build with ticks, a price starburst in a collage, a compare of old vs new price, a punch-in while the product is shown — never instead of it:
- The scenes are the main storytelling tool, not an extra. Whenever the speaker explains, teaches, lists, compares, gives steps, places, prices or numbers, cut to a scene that builds that point on screen as it is said — about 45–70 % of the runtime in scenes (the reference sits near 60 %; never more than 70 %), typically 4–8 scenes in 30–60 s, each a different kind / background (numbered "1. / 2." builds, a stat build, a collage of options, an article / polaroid card of the product or source, a timeline of steps, a compare of two numbers or choices, a split of myth vs fact or do vs don't, an annotated key sentence, a comment the speaker reads out and answers, a closing question before the CTA).
- Every scene keeps building like the reference: a new line / entry / sticker lands on its word every 1–2 spoken seconds, 3–7 of them per scene, filling the frame's upper two-thirds; never leave a scene sitting on one or two lines for more than ~2.5 s — add the next spoken phrase as a line, or end the scene and cut back to the speaker. Lines are short spoken phrases (1–4 words), mixed sizes (a small lead-in, then the big word, then what it means), colour and boxes for the key one.
- While the speaker is on screen between scenes, side words land on the strongest line almost every time (small lead-in + big word, or one huge centred word on a punchline), with few stickers — never a sticker and side words at the same moment.
- Open with the hook title and, when there is a product / source picture, a float card with a badge under it; keep the speaker on screen for the hook, the moments they hold the product up to camera, emotional lines and the CTA — and cut to scenes for everything they explain around those moments.
- Subtle captions and fx "light" are the reference look (the scenes carry the message); end on a closing question scene and the spoken CTA (no end card, or a quiet one).
TOOL PLAYBOOK — how a top editor uses this kit (plan the beats first, then give every beat the tool that tells it best; vary, never the same device twice in a row; only what the speaker actually says):
${TOOL_PLAYBOOK}
CHECK BEFORE YOU ANSWER (fix the plan if any is "no"): does your strategy name a beat for every part of the speech, and does each beat use the playbook tool that fits it (not just builds)? do the scenes cover between ~45 % and 70 % of the runtime (never more — the speaker must be seen: trust sells)? is every side word, behind word, banner, sticker (overlay) and camera move ("punch", "crash", "spotlight", "lines", "tilt", "shake", "bump", "whip") placed in a gap BETWEEN your scenes (inside a scene's at…to the speaker is hidden, so they never show)? is every number / price on screen one the speaker actually says? does every scene build 3–7 items, a new one every 1–2 spoken seconds? do side words land on the speaker's strongest lines between scenes? does each scene differ in kind or background from its neighbours? is every "behind" word's index OUTSIDE every scene's at…to range (a word inside a scene can't show)?
Craft notes (judgement, not rules): one main transition usually carries most cutaways with one or two accents; full-screen hits (shake, flash, crash) land hardest when rare; captions and stickers must stay readable over the grade; every choice must suit the product, the speaker's energy and the angle.
${STYLED ? `VARIETY INSIDE THE STYLE — the style "${STYLED}" sets the look; never break it for variety.${recent.length ? ` This client's recent edits used: ${recent.join(" | ")}. Where the style leaves room, vary the details (hook style, transitions, scene kinds and backgrounds).` : ""}` : `VARIETY — TikTok pushes down near-identical videos. ${recent.length ? `This client's recent edits used: ${recent.join(" | ")}. Give this one a clearly different combination (at least a different hook style, font, grade and end card).` : "Give this edit a combination of its own."}`}`;

function cleanDirection(d: any, nWords: number, duration: number): ProDirection | undefined {
  if (!d || typeof d !== "object") return undefined;
  const pick = (v: unknown, set: readonly string[]) => (typeof v === "string" && set.includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : undefined);
  const out: ProDirection = {
    hook_style: pick(d.hook_style, PRO_SETS.hook_style),
    font: pick(d.font, PRO_SETS.font),
    caption_font: pick(d.caption_font, PRO_SETS.font),
    caption_fx: pick(d.caption_fx, PRO_SETS.caption_fx),
    caption_look: pick(d.caption_look, PRO_SETS.caption_look),
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
    ...(typeof d.palette?.bg === "string" && /^#[0-9a-f]{6}$/i.test(d.palette.bg) && typeof d.palette?.ink === "string" && /^#[0-9a-f]{6}$/i.test(d.palette.ink)
      ? { palette: { bg: d.palette.bg, ink: d.palette.ink } } : {}),
    texture: pick(d.texture, PRO_SETS.texture),
    moves: Array.isArray(d.moves) ? d.moves.map((m: any) => {
      const at = cueIn(m?.at, nWords, duration);
      const move = pick(m?.move, PRO_SETS.move);
      if (at === undefined || !move) return null;
      const power = Number(m?.power);
      const text = move === "smash" ? clean(m?.text, 14) : "";
      if (move === "smash" && !text) return null;
      return { at, move, ...(Number.isFinite(power) ? { power: Math.min(1.4, Math.max(0.6, power)) } : {}), ...(text ? { text } : {}) };
    }).filter(Boolean).slice(0, 10) as ProDirection["moves"] : undefined,
    graphics: Array.isArray(d.graphics) ? d.graphics.map((g: any) => {
      const block = typeof g?.block === "string" ? g.block.trim() : "";
      const at = cueIn(g?.at, nWords, duration);
      if (!["count-up", "star-rating-fill", "shutter-slam"].includes(block) || at === undefined) return null;
      const to = cueIn(g?.to, nWords, duration);
      const out: Record<string, unknown> = { block, at, ...(to !== undefined ? { to } : {}) };
      if (block === "count-up") {
        const end = Number(g?.end);
        if (!Number.isFinite(end)) return null;
        out.end = end;
        if (Number.isFinite(Number(g?.start))) out.start = Number(g.start);
        out.prefix = clean(g?.prefix, 4);
        out.suffix = clean(g?.suffix, 6);
      } else if (block === "star-rating-fill") {
        const r = Number(g?.rating);
        if (!(r > 0 && r <= 5)) return null;
        out.rating = r;
      } else {
        const text = clean(g?.text, 14);
        if (!text) return null;
        out.text = text;
      }
      return out;
    }).filter(Boolean).slice(0, 2) as ProDirection["graphics"] : undefined,
    ...(d.captions === "subtle" || d.captions === "big" ? { captions: d.captions } : {}),
    ...(d.fx === "light" || d.fx === "full" ? { fx: d.fx } : {}),
    scenes: Array.isArray(d.scenes) ? d.scenes.map((sc: any) => cleanScene(sc, nWords, duration)).filter(Boolean).slice(0, 14) as Record<string, unknown>[] : undefined,
    side: Array.isArray(d.side) ? d.side.map((x: any) => {
      const at = cueIn(x?.at, nWords, duration);
      if (at === undefined) return null;
      const to = cueIn(x?.to, nWords, duration);
      const words = (Array.isArray(x?.words) ? x.words : []).map((w: any) => {
        const wat = cueIn(w?.at, nWords, duration) ?? at;
        const text = clean(w?.text, 16);
        return text ? { at: wat, text, ...(SCENE_TONES.has(w?.tone) ? { tone: w.tone } : {}), ...(["sm", "md", "lg"].includes(w?.size) ? { size: w.size } : {}) } : null;
      }).filter(Boolean).slice(0, 3);
      return words.length ? { at, ...(to !== undefined ? { to } : {}), align: ["right", "center"].includes(x?.align) ? x.align : "left", words } : null;
    }).filter(Boolean).slice(0, 10) as Record<string, unknown>[] : undefined,
    strategy: Array.isArray(d.strategy) ? d.strategy.map((x: any) => {
      const at = cueIn(x?.at, nWords, duration);
      const beat = clean(x?.beat, 12);
      const tool = clean(x?.tool, 40);
      return at !== undefined && beat ? { at, beat, ...(tool ? { tool } : {}) } : null;
    }).filter(Boolean).slice(0, 12) as Record<string, unknown>[] : undefined,
    behind: Array.isArray(d.behind) ? d.behind.map((b: any) => {
      const at = cueIn(b?.at, nWords, duration);
      const text = clean(b?.text, 14);
      if (at === undefined || !text) return null;
      const to = cueIn(b?.to, nWords, duration);
      return { at, ...(to !== undefined ? { to } : {}), text, ...(SCENE_TONES.has(b?.tone) ? { tone: b.tone } : {}) };
    }).filter(Boolean).slice(0, 2) as Record<string, unknown>[] : undefined,
    banner: Array.isArray(d.banner) ? d.banner.map((b: any) => {
      const at = cueIn(b?.at, nWords, duration);
      const text = clean(b?.text, 48);
      if (at === undefined || !text) return null;
      const to = cueIn(b?.to, nWords, duration);
      return { at, ...(to !== undefined ? { to } : {}), tag: clean(b?.tag, 12) || "TERKINI", text, ...(clean(b?.ticker, 90) ? { ticker: clean(b.ticker, 90) } : {}) };
    }).filter(Boolean).slice(0, 2) as Record<string, unknown>[] : undefined,
  };
  // a word behind the speaker inside a full-screen scene can never show (the scene hides the speaker): drop it
  if (out.behind?.length && out.scenes?.length) {
    const wi = (c: unknown) => { const m = /^w(\d+)/i.exec(String(c ?? "")); return m ? Number(m[1]) : NaN; };
    const spans = out.scenes.filter((sc) => !(sc.kind === "card" && sc.style === "float")).map((sc) => [wi(sc.at), wi(sc.to ?? sc.at)]);
    out.behind = out.behind.filter((b) => { const i = wi(b.at); return !Number.isFinite(i) || !spans.some(([a, z]) => i >= a && i <= z); });
  }
  for (const k of Object.keys(out) as (keyof ProDirection)[]) if (out[k] === undefined || (Array.isArray(out[k]) && !(out[k] as unknown[]).length)) delete out[k];
  return Object.keys(out).length ? out : undefined;
}

const SCENE_TONES = new Set(["white", "yellow", "green", "red", "blue", "accent", "black"]);
const SCENE_BGS = new Set(["dark", "red", "accent", "paper", "cork", "yellow", "blue", "notebook", "chalk", "grid", "gradient", "burst", "style"]);
/** One emoji (a pictographic cluster) or nothing. */
const emojiOf = (v: unknown) => (typeof v === "string" && v.length <= 8 && /\p{Extended_Pictographic}/u.test(v) ? v.trim() : undefined);

/** One explainer scene, cleaned to what scenesPro.tsx draws (unknown fields dropped, text clipped). */
function cleanScene(sc: any, nWords: number, duration: number): Record<string, unknown> | null {
  const kind = String(sc?.kind || "");
  if (!["build", "timeline", "collage", "card", "compare", "checklist", "steps", "ring", "chart", "split", "annotate", "chat", "map", "receipt"].includes(kind)) return null;
  const at = cueIn(sc?.at, nWords, duration);
  if (at === undefined) return null;
  const to = cueIn(sc?.to, nWords, duration);
  const cueOr = (c: unknown) => cueIn(c, nWords, duration) ?? at;
  const out: Record<string, unknown> = { kind, at, ...(to !== undefined ? { to } : {}), bg: SCENE_BGS.has(sc?.bg) ? sc.bg : "dark" };
  for (const [k, n] of [["heading", 40], ["kicker", 24], ["title", 30], ["caption", 110]] as const) {
    const v = clean(sc?.[k], n);
    if (v) out[k] = v;
  }
  const tone = (v: unknown) => (SCENE_TONES.has(v as string) ? { tone: v } : {});
  if (["cut", "push", "zoom", "whip", "wipe", "rise", "iris", "tear"].includes(sc?.enter)) out.enter = sc.enter;
  if (emojiOf(sc?.rain)) out.rain = emojiOf(sc.rain);
  if ((sc?.speaker === "left" || sc?.speaker === "right") && !(kind === "card" && sc?.style === "float")) out.speaker = sc.speaker;
  if (kind === "card") {
    out.style = ["polaroid", "article", "float", "phone"].includes(sc?.style) ? sc.style : "polaroid";
    for (const [k, n] of [["source", 24], ["date", 24], ["badge", 14]] as const) {
      const v = clean(sc?.[k], n);
      if (v) out[k] = v;
    }
    const hl = (Array.isArray(sc?.highlight) ? sc.highlight : []).map((x: unknown) => clean(x, 30)).filter(Boolean).slice(0, 4);
    if (hl.length) out.highlight = hl;
  }
  if (kind === "build") {
    const lines = (Array.isArray(sc?.lines) ? sc.lines : []).map((l: any) => {
      const text = clean(l?.text, 26);
      return text ? {
        at: cueOr(l?.at), text, ...tone(l?.tone),
        size: ["sm", "md", "lg", "xl"].includes(l?.size) ? l.size : "md",
        ...(["yellow", "black", "white", "accent"].includes(l?.box) ? { box: l.box } : {}),
        ...(["slam", "slide", "type", "scramble", "letters", "rise", "outline"].includes(l?.enter) ? { enter: l.enter } : {}),
        ...(l?.enter === "swap" && Array.isArray(l?.options) && l.options.some((o: unknown) => clean(o, 26))
          ? { enter: "swap", options: l.options.map((o: unknown) => clean(o, 26)).filter(Boolean).slice(0, 4) } : {}),
        ...(["count", "marker", "strike", "circle", "underline", "arrow", "box", "sparkle", "roll", "extrude", "shine"].includes(l?.fx) ? { fx: l.fx } : {}),
        ...(emojiOf(l?.emoji) ? { emoji: emojiOf(l.emoji) } : {}),
      } : null;
    }).filter(Boolean).slice(0, 6);
    if (!lines.length) return null;
    out.lines = lines;
  } else if (kind === "timeline") {
    const entries = (Array.isArray(sc?.entries) ? sc.entries : []).map((en: any) => {
      const date = clean(en?.date, 20);
      const lines = (Array.isArray(en?.lines) ? en.lines : [en?.text]).map((x: unknown) => clean(x, 24)).filter(Boolean).slice(0, 2);
      return date && lines.length ? { at: cueOr(en?.at), date, lines, ...tone(en?.tone) } : null;
    }).filter(Boolean).slice(0, 4);
    if (!entries.length) return null;
    out.entries = entries;
  } else if (kind === "collage") {
    const stickers = (Array.isArray(sc?.stickers) ? sc.stickers : []).map((st: any) => {
      const text = clean(st?.text, 24);
      return text ? { at: cueOr(st?.at), text, ...(clean(st?.sub, 20) ? { sub: clean(st.sub, 20) } : {}),
        kind: ["note", "strip", "burst", "tag"].includes(st?.kind) ? st.kind : "tag", ...tone(st?.tone) } : null;
    }).filter(Boolean).slice(0, 4);
    if (!stickers.length && !out.title) return null;
    out.title = out.title ? clean(out.title, 22) : undefined;
    out.stickers = stickers;
  } else if (kind === "chart") {
    const ch = sc?.chart && typeof sc.chart === "object" ? sc.chart : sc;
    const points = (Array.isArray(ch?.points) ? ch.points : []).map((pt: any) => {
      const value = Number(pt?.value);
      const label = clean(pt?.label, 10);
      return Number.isFinite(value) && label ? { at: cueOr(pt?.at), label, value } : null;
    }).filter(Boolean).slice(0, 8);
    if (points.length < 2) return null;
    out.chart = { type: ["line", "area", "bars"].includes(ch?.type) ? ch.type : "line", ...(clean(ch?.unit, 6) ? { unit: clean(ch.unit, 6) } : {}), points };
  } else if (kind === "checklist") {
    const items = (Array.isArray(sc?.items) ? sc.items : []).map((it: any) => {
      const text = clean(it?.text, 28);
      return text ? { at: cueOr(it?.at), text, mark: it?.mark === "cross" ? "cross" : "check", ...tone(it?.tone) } : null;
    }).filter(Boolean).slice(0, 6);
    if (!items.length) return null;
    out.items = items;
  } else if (kind === "steps") {
    const steps = (Array.isArray(sc?.steps) ? sc.steps : []).map((st: any) => {
      const title = clean(st?.title, 28);
      return title ? { at: cueOr(st?.at), title, ...(clean(st?.sub, 30) ? { sub: clean(st.sub, 30) } : {}), ...tone(st?.tone) } : null;
    }).filter(Boolean).slice(0, 4);
    if (steps.length < 2) return null;
    out.steps = steps;
  } else if (kind === "ring") {
    const rings = (Array.isArray(sc?.rings) ? sc.rings : []).map((rg: any) => {
      const value = Number(rg?.value);
      const label = clean(rg?.label, 20);
      return Number.isFinite(value) && label ? { at: cueOr(rg?.at), value: Math.max(0, Math.min(100, value)), label, ...tone(rg?.tone) } : null;
    }).filter(Boolean).slice(0, 3);
    if (!rings.length) return null;
    out.rings = rings;
  } else if (kind === "split") {
    const sides = (Array.isArray(sc?.sides) ? sc.sides : []).slice(0, 2).map((sd: any) => {
      const title = clean(sd?.title, 14);
      const items = (Array.isArray(sd?.items) ? sd.items : []).map((it: any) => {
        const text = clean(it?.text, 30);
        return text ? { at: cueOr(it?.at), text } : null;
      }).filter(Boolean).slice(0, 4);
      return title ? { title, ...tone(sd?.tone), items } : null;
    }).filter(Boolean);
    if (sides.length < 2) return null;
    out.sides = sides;
    if (sc?.marks === false) out.marks = false;
  } else if (kind === "annotate") {
    const text = clean(sc?.text, 80);
    if (!text) return null;
    const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const notes = (Array.isArray(sc?.notes) ? sc.notes : []).map((n: any) => {
      const word = clean(n?.word, 30);
      const note = clean(n?.note, 26);
      // the marked word must be in the sentence
      return word && note && norm(text).includes(norm(word).split(" ")[0]) ? { at: cueOr(n?.at), word, note, mark: ["highlight", "circle", "underline", "box"].includes(n?.mark) ? n.mark : "highlight" } : null;
    }).filter(Boolean).slice(0, 3);
    if (!notes.length) return null;
    out.text = text;
    out.notes = notes;
  } else if (kind === "map") {
    const places = (Array.isArray(sc?.places) ? sc.places : []).map((pl: any) => {
      const name = clean(pl?.name, 30);
      return name ? { at: cueOr(pl?.at), name, ...(clean(pl?.label, 18) ? { label: clean(pl.label, 18) } : {}), ...tone(pl?.tone) } : null;
    }).filter(Boolean).slice(0, 6);
    if (!places.length) return null;
    out.places = places;
  } else if (kind === "receipt") {
    const items = (Array.isArray(sc?.items) ? sc.items : []).map((it: any) => {
      const label = clean(it?.label, 22);
      const value = clean(it?.value, 12);
      return label && value ? { at: cueOr(it?.at), label, value } : null;
    }).filter(Boolean).slice(0, 6);
    if (!items.length) return null;
    out.items = items;
    if (sc?.total && clean(sc.total.value, 12)) out.total = { at: cueOr(sc.total.at), label: clean(sc.total.label, 12) || "JUMLAH", value: clean(sc.total.value, 12) };
    if (sc?.stamp && clean(sc.stamp.text, 16)) out.stamp = { at: cueOr(sc.stamp.at), text: clean(sc.stamp.text, 16) };
  } else if (kind === "chat") {
    const messages = (Array.isArray(sc?.messages) ? sc.messages : []).map((m: any) => {
      const text = clean(m?.text, 90);
      return text ? { at: cueOr(m?.at), text, who: m?.who === "me" ? "me" : "them", ...(clean(m?.name, 20) ? { name: clean(m.name, 20) } : {}),
        ...(clean(m?.likes, 8) ? { likes: clean(m.likes, 8) } : {}) } : null;
    }).filter(Boolean).slice(0, 6);
    if (!messages.length) return null;
    out.style = ["chat", "comments", "notif"].includes(sc?.style) ? sc.style : "comments";
    out.messages = messages;
  } else if (kind === "compare") {
    const bars = (Array.isArray(sc?.bars) ? sc.bars : []).map((b: any) => {
      const label = clean(b?.label, 16);
      const value = clean(b?.value, 12);
      return label && value ? { at: cueOr(b?.at), label, value, ...tone(b?.tone) } : null;
    }).filter(Boolean).slice(0, 4);
    if (bars.length < 2) return null;
    out.bars = bars;
  }
  return out;
}

/** One line per earlier edit (for the VARIETY note). */
export const directionSummary = (d: ProDirection | undefined | null): string | null =>
  d ? [d.hook_style, d.font, d.grade, d.end_card, d.caption_look ?? d.caption_fx, d.camera,
    Array.isArray(d.scenes) && d.scenes.length ? `scenes:${d.scenes.map((x) => `${x.kind}${x.style ? "-" + x.style : ""}/${x.bg ?? ""}`).join(",")}` : ""].filter(Boolean).join("/") || null : null;

const HEX = /^#[0-9a-f]{6}$/i;
const EDIT_CUE = /^w\d{1,4}(?:\$)?(?:[+-]\d{0,2}(?:\.\d+)?)?$/i;
const KEY_COLORS = new Set(["benefit", "price", "pain", "brand", "accent"]);
const MOODS = new Set(["chill", "upbeat", "hype"]);
/** Whitespace-normalised and clipped to `max` — at a word boundary when one is near (no "Tampal dekat man"). */
const clean = (s: unknown, max: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp >= max * 0.6 ? cut.slice(0, sp) : cut).trim();
};
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
  "broll": [{"at": CUE, "to": CUE, "layout": "full" | "pip", "kind": "photo" | "video", "about": "product" | "story", "query": string, "label"?: string (≤4 words)}],
  ${HEADLINE_SPEC},
  "facts": [{"at": CUE, "to": CUE, "query": string, "topic": string}],
  "keywords": [{"i": word index, "color": "benefit" | "price" | "pain" | "brand", "emoji"?: one emoji}],
  "rehook"?: {"at": CUE, "text": string (≤4 words)},
  "cta"?: {"at": CUE, "text": string (≤4 words, e.g. "Tekan beg kuning"), "sub"?: string (≤5 words)},
  "beats": [{"at": CUE, "to"?: CUE, "kind": "pain" | "fear" | "emotion" | "product" | "ingredient" | "how" | "benefit" | "proof" | "objection" | "offer" | "urgency" | "cta", "say": string (≤5 words — the point, in the speaker's language), "query": string (2–4 plain English words for a picture of it; the product itself → start with the brand)}]
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
- YOU ARE A CLOSING DIRECTOR. This video exists to SELL: every edit decision serves the sale and speaks from the viewer's side (what THEY get, avoid, save). Read the whole transcript first and list its SELLING BEATS in "beats", each on its own words: the PAIN (the viewer's problem / fear), the PRODUCT (named or shown), each INGREDIENT, HOW it is used, each BENEFIT / RESULT (the viewer's win), PROOF (the seller's own experience, a testimony, a number they say), an OBJECTION broken ("tak payah telan", "selamat", "tak mahal"), the OFFER (price, promo, free gift), URGENCY, the CTA. EVERY beat is HIT on screen right on its words — a picture for anything showable (the pain, the product, the ingredient, the use, the result: B-roll / a scene with an image / a headline panel), a strong sticker for the rest (offer → price / tape, objection broken → check, urgency → stamp / tape, proof → circle). A selling beat left on the talking head alone is a lost sale; zooms don't count. Colour the beat words in "keywords".
- ALERT BEATS are the strongest selling moments — catch every one: PAIN (the problem hurting them), FEAR (a hidden danger or risk: how much sugar is in that drink, a side effect, what happens if they ignore it), EMOTION (worry, shame, relief, love for family) and URGENCY (limited stock, price ends today). Mark them "kind": "pain" | "fear" | "emotion" | "urgency". Each one gets a PICTURE of it on screen right on its words ("query": sugar cubes, a sugary drink, a worried face…) plus an impact move — a text headline alone does NOT hit an alert beat.
- Hook covers 0–2.5 s: the video's promise in ≤5 punchy words. null if the video is under 5 s.
- Every overlay sits on the word it illustrates. Max 2 overlays on screen at once — one at a time reads best. Zones: top = headline/tag/tape/callout/arrow/fact area; bottom = chips/checks/cta (just above captions); middle = bigword/emoji/stamp/price only, briefly. The renderer keeps every sticker clear of the eyes, the captions and the other stickers (shrinking it a little if needed); a sticker with no room left is DROPPED — so never stack stickers on the same moment, and keep sticker text short (a big word = 1–2 short words).
- B-ROLL SOURCES (the owner's rule): "about": "product" for the PRODUCT'S OWN STORY — the product itself, its ingredients, how it is used / applied, anything specific to it → a Google Images photo (query: exactly that thing); "about": "story" for a NEW SCENE that adds to the story — a feeling, a person, a place, a lifestyle moment (someone tired at work, a family at dinner) → Pixabay stock (photo, or "kind": "video" for a moving scene; plain English query, no brand).
- B-ROLL: pick moments where the speaker names something visual — the product, an ingredient, a place, a body part, an object, a brand, a problem. "query" = EXACTLY the thing the speaker says at that moment, in their sense ("berapa kandungan gula dalam air kotak" → "sugar cubes beside juice box") — never a nearby thing (candy, chocolate); specific. For shots of the product itself (box, packshot, the item in use) START the query with the brand name (e.g. "Gluvera patch box") — those come from the brand's own website first; for generic shots (a body part, an object, a place) leave the brand out. 1 B-roll every 6–10 s, each 1.5–3 s; "full" for the product / big reveals, "pip" (card over the upper half) otherwise. Never during the first 1.5 s or the CTA. "kind": "photo" for the product itself (its own website photos), "video" for a moving stock clip of a generic action or scene (someone sticking a patch on an arm, drinking water, walking, cooking) — the query for a video is plain English ("woman applying patch on arm"), never a brand.
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
  // "Saya nak pilih sendiri": one of the 40 styles — its brief comes from the style library (null → plain manual)
  const vs = auto && input.locks?.styleId ? await vgcStyle(input.locks.styleId) : null;
  const brief = auto ? autoBrief(input, vs) : undefined;
  // The seller's own product photos (uploaded with the video): product shots
  // come ONLY from them; generic shots still come from Google (brand-free).
  const uploads = (input.productImages ?? []).filter((u) => /^https:\/\//.test(u)).slice(0, 5);
  const style = motionStyle(input.style).id;
  // AI Auto: the plan is checked against the look the director chose itself
  const lookOf = (raw: { look?: unknown } | null | undefined): MotionStyleId => (auto ? motionStyle(input.locks?.look ?? raw?.look).id : style);
  const transcript = words.slice(0, 1400).map((w) => `${w.i}@${w.t.toFixed(2)} ${w.w}`).join("\n");
  const userPrompt =
    `VIDEO: ${duration.toFixed(1)} s, ${words.length} words, language ${input.language}. Face on screen: ${opts.hasFace === false ? "no" : "yes"}.\n` +
    (input.product ? `PRODUCT / CONTEXT: ${clean(input.product, 300)}\n` : "") +
    (uploads.length
      ? `SELLER'S PRODUCT PHOTOS: ${uploads.length} uploaded. Product shots (the box, packshot, the item itself or in use) come ONLY from these — plan at most ${uploads.length} such B-roll moment${uploads.length === 1 ? "" : "s"}, their queries starting with the brand name. Generic shots (a body part, an action, a place, an object) come from a Google search — never name a brand in those queries.\n`
      : "") +
    (input.instructions ? `CLIENT PROMPT (follow it): ${clean(input.instructions, 900)}\n` : "") +
    // CLIPPER: a clip cut from a longer video (podcast, talk, live) — not an ad
    (input.clip
      ? `CLIP CONTEXT: this is a clip cut from a longer video ("${clean(input.product ?? "", 120)}") for TikTok / Reels / Shorts — NOT an ad. Edit it so the speaker's point lands: the hook on the first line, keep the viewer to the payoff, words and scenes from what is said. No selling devices (no "beg kuning", no price / buy CTA, no product B-roll) unless the speaker sells something in this very clip; "cta" only when the speaker asks for an action, and no end card otherwise.\n`
      : "") +
    (input.headlineFix?.some((f) => f.lead || f.big || f.box)
      ? `CLIENT'S OWN HEADLINES (the "headlines" set in order: over, split, pip, split) — use these words exactly for THOSE slots only and place each on the line it fits; every other slot gets different words of your own (never repeat the client's):${input.headlineFix.filter((f) => f.lead || f.big || f.box).map((f) => `#${f.i + 1} lead "${clean(f.lead ?? "", 34)}" big "${clean(f.big ?? "", 18)}" box "${clean(f.box ?? "", 34)}"`).join("; ")}\n`
      : "") +
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
  const proText = pro ? proDirectionWithLists(opts.recent ?? [], input.locks, vs?.name) : null;
  for (let attempt = 0; attempt < 2 && !raw; attempt++) {
    const r = await orChat({
      modelKey: "model_motion",
      systemPrompt: DIRECTOR_SYSTEM(style, !!input.guard, brief) + (proText ? `\n\n${proText.text}\nInclude "direction" in the JSON object.` : ""),
      userPrompt: attempt === 0 ? userPrompt : `${userPrompt}\n\nYour previous answer was not valid JSON (${lastErr}). Return ONLY the JSON object.`,
      temperature: auto ? 0.9 : 0.7, // AI Auto: fresher ideas from video to video
      maxTokens: pro ? 11000 : 7000,
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
    if (direction) {
      if (proText) enforceShortlists(direction, proText.lists);
      applyProLocks(direction, input.locks);
      plan.direction = direction;
    }
  }
  // the client's closing CTA choice wins over the director's: the yellow basket, the LIVE, or none
  if (input.ctaKind === "none") delete plan.cta;
  else if ((input.ctaKind === "bag" || input.ctaKind === "live") && duration >= 6) {
    plan.cta = {
      at: plan.cta?.at ?? Math.max(0, duration - 3.5),
      text: input.ctaKind === "live" ? "Jom masuk LIVE" : clean30(input.locks?.cta) || "Tekan beg kuning",
      ...(input.ctaKind === "bag" && plan.cta?.sub ? { sub: plan.cta.sub } : {}),
      kind: input.ctaKind,
    };
  }
  // the required headline layouts (made up when the director wrote none; guard mode keeps none that breaks the rules)
  const headSource = [plan.hook?.text, input.product].filter(Boolean).join(" ");
  // numbers on a headline: said by the speaker, or written by the client (product name, brief, own hook / CTA)
  const headNums = [input.product, input.instructions, input.locks?.hook, input.locks?.cta].filter(Boolean).join(" ");
  plan.headlines = cleanHeadlines(raw?.headlines, words, duration, headSource, headNums);
  if (input.guard) {
    plan.headlines = cleanHeadlines(plan.headlines.filter((h) => !guardHits([h.lead, h.big, h.box].join(" ")).length), words, duration, headSource, headNums);
  }
  // only numbers the speaker says (or the client wrote) reach the screen; nothing that sits on the speaker hides inside a scene
  // CLOSING: a selling beat the plan left on the talking head gets a picture / sticker (grounded + guarded below)
  const beatsAll = cleanBeats(raw?.beats, words, duration);
  const beatFills = hitBeats(plan, beatsAll, words, duration, String(input.product || plan.brand || ""));
  plan.beats = beatsAll.map((b) => ({ kind: b.kind, at: b.at, say: b.say, ...(beatFills.includes(b) ? { filled: true } : {}) }));
  groundPlan(plan, words, duration, [input.product, input.instructions, input.locks?.hook, input.locks?.cta].filter(Boolean).join(" "), input.locks?.scenes);
  const guard = !!input.guard;
  if (guard) await guardEditPlan(plan, words, input).catch(() => undefined);

  // Ground it: images + facts in parallel (each fail-soft).
  const factMoments = rawFacts(raw, words.length, duration)
    .map((f) => (guard ? { ...f, query: guardStripQuery(f.query) } : f))
    .filter((f) => !guard || (f.query.length >= 3 && guardHits(f.topic).length === 0));
  const [broll, facts, , headlines, ingShots] = await Promise.all([
    input.broll === false ? Promise.resolve([] as BRollPlan[]) : byDeadline(enrichBroll(plan.broll, guard, plan.brand, input.product, uploads, words,
      [input.product || plan.brand, plan.angle, input.instructions?.slice(0, 160)].filter(Boolean).join(" — ")), [] as BRollPlan[]),
    input.facts === false ? Promise.resolve([] as FactPlan[]) : byDeadline(writeFacts(factMoments, words), [] as FactPlan[]),
    byDeadline(resolveStickers(plan.overlays, guard), undefined),
    byDeadline(enrichHeadlines(plan.headlines ?? [], [input.product || plan.brand, plan.angle, input.instructions?.slice(0, 200)].filter(Boolean).join(" — ")), plan.headlines ?? []),
    // every ingredient the speaker names gets its picture on that word (required; off only with B-roll off)
    input.broll === false ? Promise.resolve([] as IngredientShot[])
      : byDeadline(ingredientShots(words, [input.product || plan.brand, input.instructions?.slice(0, 200)].filter(Boolean).join(" — "), { uploads }), [] as IngredientShot[]),
  ]);
  // A B-roll card label that repeats a sticker ("Cara guna" twice) is dropped.
  const said = new Set(plan.overlays.map((o) => String(o.text || "").toLowerCase().replace(/[^a-z0-9]/g, "")).filter(Boolean));
  const dedupedBroll = broll.map((b) => (b.label && said.has(b.label.toLowerCase().replace(/[^a-z0-9]/g, "")) ? { ...b, label: undefined } : b));
  // the client's own headline words / B-roll (review step) win over the AI's, slot by slot — and appear only there
  const finalHeads = applyOwnHeadlines(headlines ?? [], input.headlineFix ?? [], words, headSource);
  // a selling beat whose picture wasn't found still gets hit: its words on a tape sticker
  for (const b of beatFills) {
    if (!SHOWABLE.has(b.kind) || broll.some((x) => x.at === b.at) || !b.say || /\d/.test(b.say) || (guard && guardHits(b.say).length)) continue;
    const s = cueT(b.at, words);
    plan.overlays.push({ t: "tape", text: b.say.split(/\s+/).slice(0, 4).join(" "), zone: "top", at: b.at, to: Math.round((s + 2) * 100) / 100 });
  }
  // the ingredient shots are pinned; any other B-roll at their time gives way — and so does any sticker / side text
  // there (the shot carries its own label; the director once wrote a misheard name on a tag over it)
  const allBroll = withIngredientShots(dedupedBroll, ingShots, words) as BRollPlan[];
  if (ingShots.length) {
    const wins = ingShots.map((s) => [cueT(s.at, words) - 0.2, cueT(s.to, words, true) + 0.2] as const);
    const free = (at: Cue | undefined, to: Cue | undefined, len: number) => {
      if (at === undefined) return true;
      const s = cueT(at, words), e = to !== undefined ? Math.max(s + 0.4, cueT(to, words, true)) : s + len;
      return !wins.some(([a, z]) => s < z && e > a);
    };
    plan.overlays = plan.overlays.filter((o) => free(o.at, o.to, 1.6));
    const d = plan.direction as Record<string, any> | undefined;
    if (d) for (const k of ["side", "banner", "behind"]) if (Array.isArray(d[k])) d[k] = d[k].filter((x: any) => free(x?.at, x?.to, 2));
  }
  return { ...plan, director, broll: allBroll, facts: guard ? facts.filter((f) => guardHits(f.text).length === 0) : facts, headlines: finalHeads };
}

// ── grounding: numbers on screen are spoken; on-speaker pieces live between scenes; scenes ≤ ~70 % ─────────────

const NUM = /\d+(?:[.,]\d+)*/g;
/** "1,250" / "1.250" → "1250"; "0,35" → "0.35"; "08" → "8". */
const normNum = (raw: string) => {
  const t = raw.replace(/[.,]$/, "");
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return String(Number(t.replace(/[.,]/g, "")));
  return String(Number(t.replace(",", ".")));
};
/** Every number the speaker says (as digits) or the client wrote, plus shares said as "X daripada Y" (→ percent). */
function allowedNumbers(words: DirectorWord[], extra: string): Set<string> {
  const out = new Set<string>();
  for (const w of words) for (const m of String(w.w).match(NUM) ?? []) out.add(normNum(m));
  for (const m of extra.match(NUM) ?? []) out.add(normNum(m));
  for (let i = 0; i + 2 < words.length; i++) {
    if (/^daripada$/i.test(words[i + 1].w.replace(/[^\p{L}]/gu, ""))) {
      const a = Number(normNum((words[i].w.match(NUM) ?? [""])[0] || "x"));
      const b = Number(normNum((words[i + 2].w.match(NUM) ?? [""])[0] || "x"));
      if (a > 0 && b > 0) out.add(String(Math.round((a / b) * 100)));
    }
  }
  return out;
}

function groundPlan(plan: EditPlanV2, words: DirectorWord[], duration: number, brief: string, scenesLock?: string): void {
  const ok = allowedNumbers(words, brief);
  // a leading step number ("1. Cara guna") is numbering, not a claim
  const numsOk = (v: unknown) => typeof v !== "string" || (v.replace(/^\s*\d{1,2}[.)]\s+/, "").match(NUM) ?? []).every((m) => ok.has(normNum(m)));
  const valOk = (v: unknown) => typeof v !== "number" || ok.has(normNum(String(v)));
  const tOf = (c: unknown, end = false): number => {
    if (typeof c === "number") return c;
    const m = /^w(\d+)(\$)?([+-][\d.]+)?/i.exec(String(c ?? ""));
    if (!m) return Number(c) || 0;
    const w = words[Math.min(words.length - 1, Number(m[1]))];
    return ((m[2] || end) ? (w?.e ?? w?.t ?? 0) : (w?.t ?? 0)) + (m[3] ? Number(m[3]) : 0);
  };
  let dropped = 0;
  const why: string[] = [];
  let reason = "";
  const show = (x: any) => String(x?.text ?? x?.title ?? x?.label ?? x?.note ?? x?.move ?? (x?.words ?? []).map((w: any) => w.text).join(" ") ?? "").slice(0, 24);
  const keep = <T,>(xs: T[] | undefined, test: (x: T) => boolean): T[] | undefined => {
    if (!Array.isArray(xs)) return xs;
    const k = xs.filter(test);
    for (const x of xs) if (!k.includes(x)) why.push(`${reason}:${show(x)}`);
    dropped += xs.length - k.length;
    return k;
  };

  // stickers (overlays) with an unspoken number
  reason = "number";
  plan.overlays = keep(plan.overlays, (o) => numsOk(o.text) && numsOk(o.sub)) ?? [];
  const d = plan.direction as Record<string, any> | undefined;
  if (d) {
    for (const sc of (d.scenes ?? []) as Record<string, any>[]) {
      for (const f of ["heading", "kicker", "title", "caption", "text"]) if (!numsOk(sc[f])) { delete sc[f]; dropped++; }
      sc.lines = keep(sc.lines, (l: any) => numsOk(l.text) && (l.options ?? []).every(numsOk));
      sc.entries = keep(sc.entries, (e: any) => numsOk(e.date) && (e.lines ?? []).every(numsOk));
      sc.stickers = keep(sc.stickers, (x: any) => numsOk(x.text) && numsOk(x.sub));
      sc.bars = keep(sc.bars, (b: any) => numsOk(b.value) && numsOk(b.label));
      sc.items = keep(sc.items, (it: any) => numsOk(it.text) && numsOk(it.label) && numsOk(it.value));
      sc.steps = keep(sc.steps, (st: any) => numsOk(st.title) && numsOk(st.sub));
      sc.rings = keep(sc.rings, (r: any) => valOk(r.value) && numsOk(r.label));
      sc.messages = keep(sc.messages, (m: any) => numsOk(m.text));
      sc.notes = keep(sc.notes, (n: any) => numsOk(n.note));
      sc.places = keep(sc.places, (pl: any) => numsOk(pl.label));
      if (sc.chart?.points) sc.chart.points = keep(sc.chart.points, (pt: any) => valOk(pt.value) && numsOk(pt.label));
      if (Array.isArray(sc.sides)) for (const sd of sc.sides) sd.items = keep(sd.items, (it: any) => numsOk(it.text));
      if (sc.total && !numsOk(sc.total.value)) { delete sc.total; dropped++; }
      if (sc.stamp && !numsOk(sc.stamp.text)) { delete sc.stamp; dropped++; }
    }
    d.side = keep(d.side, (x: any) => (x.words ?? []).every((w: any) => numsOk(w.text)));
    d.behind = keep(d.behind, (b: any) => numsOk(b.text));
    d.banner = keep(d.banner, (b: any) => numsOk(b.text) && numsOk(b.ticker));
    d.moves = keep(d.moves, (m: any) => numsOk(m.text));

    // scenes ≤ ~70 % of the runtime (or the client's pick): the thinnest scene (fewest items per second) goes first
    reason = "over70";
    const share = SCENE_SHARE[scenesLock ?? "many"] ?? SCENE_SHARE.many;
    const scenes = ((d.scenes ?? []) as Record<string, any>[]);
    const full = () => scenes.filter((sc) => !(sc.kind === "card" && sc.style === "float"));
    const span = (sc: any) => Math.max(0, tOf(sc.to ?? sc.at, true) - tOf(sc.at));
    const itemsOf = (sc: any) => ["lines", "entries", "stickers", "bars", "items", "steps", "rings", "messages", "notes", "places"]
      .reduce((n, k) => n + (Array.isArray(sc[k]) ? sc[k].length : 0), 0) + (sc.chart?.points?.length ?? 0) + (sc.sides ?? []).reduce((n: number, sd: any) => n + (sd.items?.length ?? 0), 0);
    while (full().length > share.keep && (full().reduce((a, sc) => a + span(sc), 0) > duration * share.cover || (scenesLock === "few" && full().length > 2))) {
      const thin = full().sort((a, b) => itemsOf(a) / Math.max(0.5, span(a)) - itemsOf(b) / Math.max(0.5, span(b)))[0];
      scenes.splice(scenes.indexOf(thin), 1);
      why.push(`over70:${thin.kind}`);
      dropped++;
    }

    // what sits on the speaker never lands inside a full-screen scene (it would never show)
    // the composition ends a scene ~3.5 s after its last item (a card may hold 11 s): use that real end
    const itemTimes = (sc: any) => ["lines", "entries", "stickers", "bars", "items", "steps", "rings", "messages", "notes", "places"]
      .flatMap((k) => (Array.isArray(sc[k]) ? sc[k] : []).map((x: any) => tOf(x.at)))
      .concat((sc.chart?.points ?? []).map((x: any) => tOf(x.at)), (sc.sides ?? []).flatMap((sd: any) => (sd.items ?? []).map((x: any) => tOf(x.at))));
    const realEnd = (sc: any) => {
      const to = tOf(sc.to ?? sc.at, true);
      const ts = itemTimes(sc);
      return sc.kind === "card" ? Math.min(to, tOf(sc.at) + 11) : ts.length ? Math.min(to, Math.max(...ts) + 3.5) : to;
    };
    const spans = full().map((sc) => [tOf(sc.at), realEnd(sc)] as const);
    const inside = (c: unknown) => { const t = tOf(c); return spans.some(([a, b]) => t >= a - 0.05 && t < b); };
    reason = "under-scene";
    d.side = keep(d.side, (x: any) => !inside(x.at));
    d.behind = keep(d.behind, (x: any) => !inside(x.at));
    d.banner = keep(d.banner, (x: any) => !inside(x.at));
    d.moves = keep(d.moves, (x: any) => !inside(x.at));
    plan.overlays = keep(plan.overlays, (o) => o.t === "confetti" || !inside(o.at)) ?? [];
  }
  if (dropped) console.log(`[director] grounding dropped ${dropped}: ${why.join(" | ").slice(0, 900)}`);
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
// ── closing: every selling beat is hit on screen (the owner's call, 2026-10-24: "director master closing sales") ──
type Beat = { at: Cue; to?: Cue; kind: string; say: string; query: string };
const BEAT_KINDS = new Set(["pain", "fear", "emotion", "product", "ingredient", "how", "benefit", "proof", "objection", "offer", "urgency", "cta"]);
// beats a picture shows best; the rest get a strong sticker
const SHOWABLE = new Set(["pain", "fear", "emotion", "product", "how", "benefit", "proof"]);
// the strongest selling moments (the owner's call): a PICTURE on their words (a text headline doesn't count),
// pinned so a headline moves off it, plus an impact move
const ALERT = new Set(["pain", "fear", "emotion", "urgency"]);
const ALERT_MOVE: Record<string, string> = { pain: "shake", fear: "shake", emotion: "punch", urgency: "crash" };

/** The seconds a cue stands for on these words. */
function cueT(c: Cue | undefined, words: DirectorWord[], end = false): number {
  if (typeof c === "number") return c;
  const m = /^w(\d+)(\$)?([+-][\d.]+)?/i.exec(String(c ?? ""));
  if (!m) return Number(c) || 0;
  const w = words[Math.min(words.length - 1, Number(m[1]))];
  return ((m[2] || end) ? (w?.e ?? w?.t ?? 0) : (w?.t ?? 0)) + (m[3] ? Number(m[3]) : 0);
}

function cleanBeats(raw: unknown, words: DirectorWord[], duration: number): Beat[] {
  const out: Beat[] = [];
  for (const b of Array.isArray(raw) ? raw.slice(0, 24) : []) {
    const kind = String((b as any)?.kind ?? "").toLowerCase();
    const at = cueIn((b as any)?.at, words.length, duration);
    if (!BEAT_KINDS.has(kind) || at === undefined) continue;
    const to = cueIn((b as any)?.to, words.length, duration);
    out.push({ at, ...(to !== undefined ? { to } : {}), kind, say: clean((b as any)?.say, 34), query: clean((b as any)?.query, 60) });
  }
  return out.sort((a, b) => cueT(a.at, words) - cueT(b.at, words));
}

/** The plan's selling beats that nothing hits on screen (no sticker, B-roll, headline or scene on their words) get
 *  one: a picture (B-roll card, its search the beat's) for what can be shown, a sticker for the rest. Ingredients
 *  have their own pinned shots; the CTA has its end card; the hook covers the opening. */
function hitBeats(plan: EditPlanV2, beats: Beat[], words: DirectorWord[], duration: number, brand: string): Beat[] {
  const busy: [number, number][] = [];
  const add = (at: Cue | undefined, to: Cue | undefined, len: number) => {
    if (at === undefined) return;
    const s = cueT(at, words);
    busy.push([s, to !== undefined ? Math.max(s + 0.6, cueT(to, words, true)) : s + len]);
  };
  for (const o of plan.overlays ?? []) add(o.at, o.to, 1.6);
  for (const b of plan.broll ?? []) add(b.at, b.to, 2.4);
  for (const h of plan.headlines ?? []) add(h.at, h.to, 3.4);
  const d = plan.direction as Record<string, any> | undefined;
  for (const k of ["scenes", "side", "banner", "behind"]) for (const x of (d?.[k] ?? []) as any[]) add(x?.at, x?.to, 3);
  const hit = (s: number, e: number) => busy.some(([a, z]) => s < z && e > a);
  // what shows a picture: B-roll and the split / corner headline panels
  const pics: [number, number][] = [];
  const pic = (at: Cue | undefined, to: Cue | undefined, len: number) => {
    if (at === undefined) return;
    const s = cueT(at, words);
    pics.push([s, to !== undefined ? Math.max(s + 0.6, cueT(to, words, true)) : s + len]);
  };
  for (const b of plan.broll ?? []) pic(b.at, b.to, 2.4);
  for (const h of plan.headlines ?? []) if (h.kind !== "over") pic(h.at, h.to, 3.4);
  const hasPic = (s: number, e: number) => pics.some(([a, z]) => s < z && e > a);
  const d0 = plan.direction as Record<string, any> | undefined;
  const moved = (s: number) => ((d0?.moves ?? []) as { at: Cue }[]).some((m) => Math.abs(cueT(m.at, words) - s) < 1);
  const filled: Beat[] = [];
  const brandWord = brand.split(/\s+/)[0] || "";
  for (const b of beats) {
    if (b.kind === "cta" || b.kind === "ingredient") continue;
    const alert = ALERT.has(b.kind);
    let s = cueT(b.at, words);
    // the hook owns 0–2.5 s: an alert beat the director put there ("berapa gula dalam tu" at 0.1 s, said again at
    // 3.2 s) lands on the first word after the hook instead of being lost
    if (s < 2.6) {
      const j = words.findIndex((w) => w.t >= 2.6);
      if (!alert || j < 0 || words[j].t > s + 5) continue;
      b.at = `w${j}`;
      if (b.to !== undefined && cueT(b.to, words, true) <= words[j].t + 0.6) delete b.to;
      s = words[j].t;
    }
    if (s > duration - 3.4) continue;
    // an alert beat needs a picture (a sticker / text headline there doesn't count); the others any visual
    if (alert ? (b.kind === "urgency" ? hit(s - 0.4, s + 1.8) : hasPic(s - 0.4, s + 1.8)) : hit(s - 0.4, s + 1.8)) {
      if (alert && d0 && Array.isArray(d0.moves) && !moved(s)) d0.moves.push({ at: b.at, move: ALERT_MOVE[b.kind], power: 1 });
      // the director's own B-roll on an alert beat is pinned too (no headline drops it) and fills the screen —
      // a small card isn't emphasis enough for a fear / pain moment
      if (alert && b.kind !== "urgency") {
        for (const x of plan.broll ?? []) {
          const xs = cueT(x.at, words), xe = x.to !== undefined ? cueT(x.to, words, true) : xs + 2.4;
          if (xs < s + 1.8 && xe > s - 0.4) { x.must = true; x.layout = "full"; }
        }
      }
      continue;
    }
    if (filled.length >= 8) break;
    if (alert && d0 && !moved(s)) (d0.moves ??= []).push({ at: b.at, move: ALERT_MOVE[b.kind], power: 1 });
    const label = /\d/.test(b.say) ? "" : b.say.split(/\s+/).slice(0, 4).join(" ");
    if (SHOWABLE.has(b.kind) && b.query) {
      const query = b.kind === "product" && brandWord && !b.query.toLowerCase().startsWith(brandWord.toLowerCase()) ? `${brandWord} ${b.query}` : b.query;
      // the product / how it's used → Google Images; the pain / win / proof as a scene → Pixabay
      const about = b.kind === "product" || b.kind === "how" ? "product" as const : "story" as const;
      // an alert beat: the picture fills the screen and is pinned (a headline there moves off it)
      plan.broll.push({ at: b.at, ...(b.to !== undefined ? { to: b.to } : {}), layout: alert ? "full" : "pip", kind: "photo", about, query, ...(label ? { label } : {}), candidates: [], ...(alert ? { must: true } : {}) });
      pics.push([s - 0.2, s + 2.2]);
    } else if (b.say) {
      const sticker: MotionItem = b.kind === "objection" ? { t: "check", text: b.say.split(/\s+/).slice(0, 4).join(" "), mark: "check", zone: "bottom", at: b.at }
        : b.kind === "urgency" ? { t: "stamp", text: b.say.split(/\s+/).slice(0, 2).join(" "), zone: "middle", at: b.at }
        : { t: "tape", text: b.say.split(/\s+/).slice(0, 4).join(" "), zone: "top", at: b.at };
      plan.overlays.push({ ...sticker, to: Math.round((s + 2) * 100) / 100 });
    } else continue;
    busy.push([s - 0.2, s + 2.2]);
    filled.push(b);
  }
  return filled;
}

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
  const locks = input.locks;
  const capStyle = locks?.captionLook ? (locks.captionLook === "tiktok" ? "tiktok" : "pop")
    : auto && CAPTION_STYLES.has(raw?.captions?.style) ? raw.captions.style as EditPlanV2["captions"]["style"] : input.captionStyle;
  const capPos = locks?.captionPos ?? (auto ? (raw?.captions?.pos === "mid" ? "mid" : "low") : input.captionPos);
  const hs = Number(raw?.hook_sound);
  const autoPicks: Partial<EditPlanV2> = auto ? {
    angle: (input.locks?.angle ? clean(input.locks.angle.label.replace(/^\P{L}+/u, ""), 60) : clean(raw?.angle, 60)) || undefined,
    look: look.id,
    energy: look.energy,
    music: typeof locks?.music === "boolean" ? locks.music : typeof raw?.music === "boolean" ? raw.music : look.energy === "gempak",
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
        // the product's own story comes from Google Images (photos); a new story scene from Pixabay (photo or clip)
        ...(b?.about === "product" ? { about: "product" as const, kind: "photo" as const } : { kind: b?.kind === "video" ? "video" as const : "photo" as const, ...(b?.about === "story" ? { about: "story" as const } : {}) }) };
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
  const hookText = clean(locks?.hook, 40) || clean(raw?.hook?.text, 40);
  const accent = HEX.test(input.accent || "") ? input.accent! : HEX.test(raw?.accent) ? raw.accent : "#FFD93B";
  const rehookAt = cueIn(raw?.rehook?.at, nWords, duration);
  const ctaAt = cueIn(raw?.cta?.at, nWords, duration);
  const brand = clean(raw?.brand, 40) || clean(String(input.product || "").split(/[,(|\-–]/)[0], 40);
  return {
    ...(brand ? { brand } : {}),
    hook: hookText && duration >= 5 ? { text: hookText, ...(raw?.hook?.sub ? { sub: clean(raw.hook.sub, 40) } : {}) } : null,
    accent,
    mood: locks?.mood ?? (MOODS.has(raw?.mood) ? raw.mood : look.mood),
    captions: { on: input.captions, style: capStyle, pos: capPos, maxWords: capStyle === "karaoke" ? 4 : 3 },
    ...autoPicks,
    // the client switched GIF stickers / animated emoji off
    overlays: overlays.filter((o: MotionItem) => !(locks?.elements?.gif === false && o.t === "gif") && !(locks?.elements?.emoji === false && o.t === "emoji")),
    zooms,
    broll,
    facts: [],
    keywords: locks?.elements?.emoji === false ? keywords.map(({ emoji: _e, ...k }) => k) : keywords,
    ...(rehookAt !== undefined && clean(raw?.rehook?.text, 30) && duration > 20 ? { rehook: { at: rehookAt, text: clean(raw.rehook.text, 30) } } : {}),
    ...(locks?.cta && duration >= 6
      // the client's CTA, word for word — at the director's moment, else the last ~3.5 s
      ? { cta: { at: ctaAt ?? Math.max(0, duration - 3.5), text: clean(locks.cta, 30), ...(raw?.cta?.sub ? { sub: clean(raw.cta.sub, 34) } : {}) } }
      : ctaAt !== undefined && clean(raw?.cta?.text, 30) ? { cta: { at: ctaAt, text: clean(raw.cta.text, 30), ...(raw?.cta?.sub ? { sub: clean(raw.cta.sub, 34) } : {}) } } : {}),
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
async function enrichBroll(moments: BRollPlan[], guard = false, brand?: string, product?: string, uploads: string[] = [],
  spoken: DirectorWord[] = [], purpose = ""): Promise<BRollPlan[]> {
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
    // The owner's sourcing rule: a new story scene comes from Pixabay stock only (a moving clip, else a photo) …
    if (!productShot && m.about === "story") {
      if (m.kind === "video") {
        const clips = await searchClips(m.query).catch(() => []);
        if (clips.length) {
          return { kind: "video" as const, hits: clips.map((c) => ({ url: c.url, thumb: c.thumb, width: c.width, height: c.height, title: m.query })), source: "stock" as const };
        }
      }
      const photos = await searchPhotos(m.query).catch(() => []);
      return { kind: "photo" as const, hits: photos.map((c) => ({ url: c.url, thumb: c.thumb, width: c.width, height: c.height, title: m.query })), source: "stock" as const };
    }
    // … the product's own story (about "product") from Google Images below (the brand / seller photos first for the product itself)
    // Moving cutaway: stock clips (vision sees their thumbnails); none → photos.
    if (m.kind === "video" && m.about !== "product") {
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
  // each picture is checked against what the speaker SAYS right there and what the video is for, not just its search words
  const saidAt = (m: BRollPlan) => {
    if (!spoken.length) return "";
    const s = cueT(m.at, spoken) - 1.2, e = (m.to !== undefined ? cueT(m.to, spoken, true) : cueT(m.at, spoken) + 2.4) + 0.6;
    return spoken.filter((w) => w.t >= s && w.t <= e).slice(0, 16).map((w) => w.w).join(" ");
  };
  const picked = await Promise.all(batches.map((b) => visionPick(b.map((x) => ({ ...x, said: saidAt(x.m) })), guard, brandName || undefined, purpose).catch(() => null)));
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

async function visionPick(items: { m: BRollPlan; hits: ImageHit[]; source?: string; said?: string }[], guard = false, brand?: string, purpose = ""): Promise<number[] | null> {
  const images: string[] = [];
  const lines: string[] = [];
  items.forEach(({ m, hits, source, said }, k) => {
    const opts = hits.slice(0, 3);
    lines.push(`Moment ${k} — ${said ? `SPEAKER SAYS: "${said}" — ` : ""}query "${m.query}"${m.label ? ` (label "${m.label}")` : ""}${m.must ? " [KEY SELLING MOMENT: it must show exactly what is said]" : ""}${SOURCE_NOTE[source ?? ""] ?? ""}: images ${opts.map((_, j) => `#${images.length + j}`).join(", ")}`);
    for (const h of opts) images.push(h.thumb || h.url);
  });
  if (images.length > 24) return null;
  const r = await orChatVision({
    modelKey: "model_motion",
    systemPrompt: "You pick B-roll images for a TikTok edit. For each moment choose the image that shows EXACTLY what the speaker says at that moment, in the sense they mean it, and serves the video's purpose — the query only helps. A related-but-different thing is WRONG: candy or chocolate when they say how much sugar is in a boxed drink (show sugar / a sugary drink), a blood donor when they say 'buat dono' (= acting like they don't know). Literal, never a metaphor or a mood picture: for 'ramai tak ambil tahu' show a person shrugging / ignoring it, not a storm or a dark sky. Also: a real product/object, clean, no big watermark, not a meme, not text-heavy, safe for ads." +
      (purpose ? ` THE VIDEO: ${purpose.slice(0, 260)}.` : "") +
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
export type QaPatch = { drop_overlays: number[]; move: { idx: number; zone: "top" | "middle" | "bottom" }[]; drop_broll: number[]; pip_broll: number[]; notes?: string; via?: string };

export async function qaPatch(opts: {
  /** eyes = the band of the speaker's eyes in that still from the face tracker ([top, bottom] fractions of the height) */
  stills: { frame: number; t: number; active: string[]; image: string; eyes?: [number, number] | null }[];
  overlays: { idx: number; t?: string; text?: string; zone?: string }[];
  broll: { idx: number; layout?: string }[];
}): Promise<QaPatch | null> {
  const stills = opts.stills.slice(0, 6);
  if (!stills.length) return null;
  const eyesOf = (s: { eyes?: [number, number] | null }): [number, number] | null =>
    (Array.isArray(s.eyes) && s.eyes.length === 2 && s.eyes.every((v) => typeof v === "number" && v >= 0 && v <= 1) && s.eyes[0] < s.eyes[1] ? s.eyes : null);
  const desc = stills.map((s, k) => { const e = eyesOf(s); return `Still ${k} @${s.t.toFixed(1)}s — active: ${s.active.join(" | ") || "none"}`
    + (e ? ` — the eyes (face tracker) are between ${e[0].toFixed(2)} and ${e[1].toFixed(2)} of the height` : ""); }).join("\n");
  const r = await orChatVision({
    modelKey: "model_motion",
    // The sticker layout already keeps the eyes, the captions and the other stickers clear (layout.ts). Asked only
    // for problems, the model kept reporting stickers on the hijab / above the head as "covering eyes" (asked to
    // describe the same still it put the word at 15 % and the eyes at 40 %), so every fix now carries what it
    // measured in the still, and an "eyes" fix whose box doesn't reach the eyes is thrown away. Even then it put the
    // eyes at 24 % (they sat at ~43 %), so the eyes come from the face tracker (a band) whenever the job has one.
    systemPrompt: "You are the QA editor of an automated TikTok edit (9:16). Look at the stills and find REAL problems only: an overlay that actually covers the speaker's EYES (its box overlaps the eye line), overlays overlapping each other or the captions, text cut off at the frame edge, unreadable text, a B-roll image that is wrong/irrelevant/watermarked/low-quality, a full-screen B-roll hiding an important moment. NOT problems (pro edits do this on purpose): a sticker on the forehead, hair, hijab or above the head; a sticker on the chin, chest or briefly over the mouth; big text behind or above the head. An overlay's zone in the list is only its preferred band — the layout already moved it clear of the face — so judge ONLY from what each still shows. For every overlay you would change, first MEASURE it in the still: its vertical extent as fractions of the still's height (0 = top edge, 1 = bottom edge) and, for an eyes problem, the eye line. Fix with the smallest change. Answer ONLY JSON: {\"issues\":[{\"idx\":n, \"still\":k, \"why\":\"eyes|overlap|captions|cutoff|unreadable\", \"box\":[top,bottom], \"eyes\":0.0-1.0 (eyes only), \"fix\":\"drop|top|middle|bottom\"}], \"drop_broll\":[idx], \"pip_broll\":[idx], \"notes\":\"≤20 words\"}. Use the overlay/broll idx numbers from the lists. Empty arrays when it looks good.",
    textPrompt: `${desc}\n\nOVERLAYS: ${JSON.stringify(opts.overlays).slice(0, 4000)}\nBROLL: ${JSON.stringify(opts.broll)}`,
    images: stills.map((s) => s.image),
    temperature: 0.2,
    maxTokens: 900,
    timeoutMs: 90_000,
    hedgeAfterMs: 40_000,
    stream: true,
  });
  if (!r.ok || !r.content) return null;
  const j = extractJson(r.content);
  const ints = (a: any, max: number) => (Array.isArray(a) ? a.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < max) : []);
  const nO = opts.overlays.length;
  const nB = opts.broll.length;
  const frac = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null);
  // an "eyes" fix stands only when the measured box reaches the eyes — the face tracker's eye band for that still
  // when known (the model's own guess drifts), else its eye line ±2 % of the height
  const rejected: number[] = [];
  const issues = (Array.isArray(j?.issues) ? j.issues : []).filter((x: any) => {
    const idx = Number(x?.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= nO || !["drop", "top", "middle", "bottom"].includes(x?.fix)) return false;
    if (x?.why !== "eyes") return true;
    const box = Array.isArray(x?.box) ? x.box.map(frac) : [];
    const k = Number(x?.still);
    const tracked = Number.isInteger(k) && k >= 0 && k < stills.length ? eyesOf(stills[k]) : null;
    const own = frac(x?.eyes);
    const band: [number, number] | null = tracked ?? (own !== null ? [own - 0.02, own + 0.02] : null);
    const ok = box.length === 2 && box[0] !== null && box[1] !== null && band !== null
      && Math.min(box[0], box[1]) <= band[1] && Math.max(box[0], box[1]) >= band[0];
    if (!ok) rejected.push(idx);
    return ok;
  });
  const dropO = [...new Set(issues.filter((x: any) => x.fix === "drop").map((x: any) => Number(x.idx)))].slice(0, Math.ceil(nO / 3)) as number[]; // never strip the edit bare
  const move = issues.filter((x: any) => x.fix !== "drop" && !dropO.includes(Number(x.idx)))
    .map((x: any) => ({ idx: Number(x.idx), zone: x.fix as "top" | "middle" | "bottom" }));
  const notes = clean(j?.notes, 160);
  return {
    drop_overlays: dropO,
    move,
    drop_broll: ints(j?.drop_broll, nB),
    pip_broll: ints(j?.pip_broll, nB),
    notes: rejected.length ? `${notes ?? ""} [ignored ${rejected.length} unmeasured eyes claim(s)]`.trim() : notes,
    // which model judged the stills ("provider/model"), like plan.director
    via: (() => { const m = r as { provider?: string; model?: string }; return m.provider && m.model ? `${m.provider}/${m.model}` : undefined; })(),
  };
}
