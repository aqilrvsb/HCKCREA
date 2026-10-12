// Motion "Gaya" — the 10 editing looks a client can pick (Edit Video + Buat
// Iklan). Each one tells the AI director HOW to edit: pace, which stickers,
// colour palette, music mood. The Remotion templates know two render energies
// (gempak = confetti bursts, punchier zooms, louder SFX, progress bar; clean =
// calm), so every look maps onto one of them via `energy`.
// Pure data (no imports) — shared by the Motion tab, the API routes and the
// director prompts.

export type MotionEnergy = "gempak" | "clean";
export type MotionStyleId =
  | "gempak" | "clean" | "hype" | "santai" | "aesthetic"
  | "lawak" | "promo" | "tutorial" | "berita" | "mewah";

export type MotionStyleDef = {
  id: MotionStyleId;
  emoji: string;
  label: string;
  /** One line for the client (Malay). */
  desc: string;
  energy: MotionEnergy;
  mood: "chill" | "upbeat" | "hype";
  /** Colour palette the director picks the accent from (unless the client chose one). */
  palette: string;
  /** Seconds per overlay (caps the overlay count) / per zoom / longest gap without a new overlay or B-roll. */
  overlayEvery: number;
  zoomEvery: number;
  maxGap: number;
  /** Edit Video director instructions (English, for the LLM). */
  edit: string;
  /** Buat Iklan script-writer instructions. */
  ad: string;
};

export const MOTION_STYLES: readonly MotionStyleDef[] = [
  {
    id: "gempak", emoji: "🔥", label: "Gempak", desc: "Padat & laju — viral TikTok", energy: "gempak", mood: "upbeat",
    palette: "bold yellow or hot pink on dark", overlayEvery: 2.2, zoomEvery: 3, maxGap: 6,
    edit: "dense and punchy: something new on screen every 2–4 s (overlay, B-roll, zoom or bigword); 1 zoom every 3–5 s; 3–6 bigword punches on the strongest words; emoji often; at least one callout or arrow.",
    ad: "2–3 items per scene, at least 3 bigwords in the ad, emoji on ~1 in 3 scenes, use callout/arrow, cta item on the cta line.",
  },
  {
    id: "clean", emoji: "✨", label: "Clean", desc: "Kemas & premium", energy: "clean", mood: "chill",
    palette: "one calm brand colour with lots of white", overlayEvery: 3.5, zoomEvery: 6, maxGap: 10,
    edit: "calm and premium: a change every 4–6 s; 1 zoom every 6–8 s; at most 2 bigwords; few emoji.",
    ad: "1–2 items per scene, at most 1 bigword, minimal emoji, cta item on the cta line.",
  },
  {
    id: "hype", emoji: "⚡", label: "Hype", desc: "Tenaga maksimum, potong laju", energy: "gempak", mood: "hype",
    palette: "neon green or electric pink", overlayEvery: 1.8, zoomEvery: 2, maxGap: 5,
    edit: "maximum energy: something new every 1.5–3 s; 1 zoom every 2–3 s; 5–8 bigword / stamp punches; emoji and 1–2 gif reactions; confetti on the big reveal; short B-roll (1–2 s each).",
    ad: "3 items per scene, 4+ bigwords or stamps, emoji in half the scenes, confetti on the reveal, cta item on the cta line.",
  },
  {
    id: "santai", emoji: "☕", label: "Santai", desc: "Soft sell, bual santai", energy: "clean", mood: "chill",
    palette: "warm orange and cream", overlayEvery: 3.5, zoomEvery: 6, maxGap: 10,
    edit: "relaxed, conversational soft sell with a handwritten feel: notes, scribbles, underlines, tape labels and callout asides; a change every 4–6 s; 1 gentle zoom every 6–8 s; at most 1 bigword; few emoji; no stamps.",
    ad: "1–2 items per scene: notes, scribbles, callouts; at most 1 bigword; soft cta item on the cta line.",
  },
  {
    id: "aesthetic", emoji: "🌸", label: "Aesthetic", desc: "Pastel, minimal, lembut", energy: "clean", mood: "chill",
    palette: "soft pastel — blush pink, lilac or sage", overlayEvery: 4.5, zoomEvery: 8, maxGap: 12,
    edit: "minimal and airy (Pinterest look): a change every 5–7 s; small tags, chips and underlines with very few words; no bigword, no stamp, no confetti; 1 slow zoom every 8 s; emoji rarely (✨🌸 only).",
    ad: "1 small item per scene (tag, chip or underline), no bigword, no stamp, at most 1 emoji, gentle cta item on the cta line.",
  },
  {
    id: "lawak", emoji: "😂", label: "Lawak", desc: "Meme & reaksi kelakar", energy: "gempak", mood: "upbeat",
    palette: "bright comic colours — yellow, cyan, red", overlayEvery: 2.4, zoomEvery: 3, maxGap: 6,
    edit: "funny meme edit that reacts to the speaker: callout bubbles with witty asides, bigwords on the funny words, emoji and 1–2 gif reactions at the punchlines, circle the absurd bit, quick zooms on punchlines (every 3–4 s). Keep it friendly — never mock the speaker or the product.",
    ad: "2–3 items per scene with witty callouts, emoji reactions and bigwords on punchlines, cta item on the cta line.",
  },
  {
    id: "promo", emoji: "💸", label: "Promo", desc: "Hard sell — harga & tawaran", energy: "gempak", mood: "hype",
    palette: "sale red with yellow", overlayEvery: 2.2, zoomEvery: 3, maxGap: 6,
    edit: "hard-sell promo: a price, counter or stamp on every price / offer the speaker says, a checklist of what the buyer gets, arrow and point toward the beg kuning, urgency tags only for what the speaker actually says, confetti on the price reveal and the CTA; a change every 2–4 s.",
    ad: "2–3 items per scene: price / stamp / check items on every offer in the brief (never invent one), confetti on the price reveal, cta item on the cta line.",
  },
  {
    id: "tutorial", emoji: "📝", label: "Tutorial", desc: "Langkah demi langkah", energy: "clean", mood: "upbeat",
    palette: "fresh teal with white", overlayEvery: 3, zoomEvery: 5, maxGap: 8,
    edit: "clear how-to: number the steps with tags (\"Langkah 1\", \"Langkah 2\" …), a check for every tip, arrow / point / circle on what to look at, underline the key do's and don'ts, fact cards for background; 1 zoom every 5–6 s; few emoji.",
    ad: "1–2 items per scene: numbered step tags, checks, arrows; at most 1 bigword; cta item on the cta line.",
  },
  {
    id: "berita", emoji: "📰", label: "Berita", desc: "Gaya laporan berita / info", energy: "clean", mood: "upbeat",
    palette: "news blue and white with a red accent", overlayEvery: 3.2, zoomEvery: 5, maxGap: 8,
    edit: "news-report look: a headline bar at the start, lower-third style tags and chips naming each topic, fact cards, counters for spoken numbers; no emoji, no confetti, no gif; a change every 4–5 s; steady zooms.",
    ad: "1–2 items per scene: headline, tag and fact-style items; no emoji; cta item on the cta line.",
  },
  {
    id: "mewah", emoji: "💎", label: "Mewah", desc: "Luxury, elegan & eksklusif", energy: "clean", mood: "chill",
    palette: "gold on black or deep navy", overlayEvery: 4.5, zoomEvery: 8, maxGap: 12,
    edit: "luxury premium: few elegant words on screen, tags and underlines, slow zooms (every 7–9 s), product B-roll as full-screen reveals; no emoji, no confetti, no stamps, at most 1 bigword.",
    ad: "1 elegant item per scene (tag or underline), no emoji, no stamp, at most 1 bigword, refined cta item on the cta line.",
  },
];

const BY_ID = new Map(MOTION_STYLES.map((s) => [s.id, s]));

export function isMotionStyle(v: unknown): v is MotionStyleId {
  return typeof v === "string" && BY_ID.has(v as MotionStyleId);
}

/** The look for an id (unknown / missing → Gempak). */
export function motionStyle(id: unknown): MotionStyleDef {
  return BY_ID.get(id as MotionStyleId) ?? MOTION_STYLES[0];
}

/** Render energy (Remotion + Modal) for a look. */
export function styleEnergy(id: unknown): MotionEnergy {
  return motionStyle(id).energy;
}
