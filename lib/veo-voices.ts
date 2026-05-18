// Veo 3.1 voice catalog — single source of truth.
//
// Matches the UI dropdown shown in the manual UGC tab and the agent
// confirmation dialog. Each entry combines the Veo voice ID with a
// short tonal description (gender, character, pitch). When a voice is
// chosen the prompt's AUDIO LOCK embeds this description verbatim so
// the video model uses the exact same voice across the entire clip and
// any future continuation (seg-2 / Extend chain).
//
// Order matches the UI dropdown alphabetically by display name.

export type VeoVoice = {
  id: string;             // lowercase key — what the API persists
  label: string;          // display name in the dropdown
  description: string;    // full tonal description embedded in AUDIO LOCK
};

export const VEO_VOICES: VeoVoice[] = [
  { id: "achernar",     label: "Achernar — Female, soft, high pitch",          description: "Achernar — Female, soft, high pitch. Light airy timbre, gentle delivery." },
  { id: "achird",       label: "Achird — Male, friendly, mid pitch",           description: "Achird — Male, friendly, mid-pitch. Warm conversational tone." },
  { id: "algenib",      label: "Algenib — Male, gravelly, low pitch",          description: "Algenib — Male, gravelly, low pitch. Deep rough timbre." },
  { id: "algieba",      label: "Algieba — Male, easy-going, mid-low pitch",    description: "Algieba — Male, easy-going, mid-low pitch. Relaxed casual delivery." },
  { id: "alnilam",      label: "Alnilam — Male, firm, mid-low pitch",          description: "Alnilam — Male, firm, mid-low pitch. Steady authoritative tone." },
  { id: "aoede",        label: "Aoede — Female, breezy, mid pitch",            description: "Aoede — Female, breezy, mid-pitch. Light, airy, conversational." },
  { id: "autonoe",      label: "Autonoe — Female, bright, mid pitch",          description: "Autonoe — Female, bright, mid-pitch. Cheerful upbeat delivery." },
  { id: "callirrhoe",   label: "Callirrhoe — Female, easy-going, mid pitch",   description: "Callirrhoe — Female, easy-going, mid-pitch. Natural conversational tone." },
  { id: "charon",       label: "Charon — Male, informative, lower pitch",      description: "Charon — Male, informative, lower pitch. Deep authoritative delivery." },
  { id: "despina",      label: "Despina — Female, smooth, mid pitch",          description: "Despina — Female, smooth, mid-pitch. Polished even delivery." },
  { id: "enceladus",    label: "Enceladus — Male, breathy, lower pitch",       description: "Enceladus — Male, breathy, lower pitch. Soft intimate delivery." },
  { id: "erinome",      label: "Erinome — Female, clear, mid pitch",           description: "Erinome — Female, clear, mid-pitch. Bright clean enunciation." },
  { id: "fenrir",       label: "Fenrir — Male, excitable, younger pitch",      description: "Fenrir — Male, excitable, younger pitch. Energetic Gen-Z hype delivery." },
  { id: "gacrux",       label: "Gacrux — Female, mature, mid pitch",           description: "Gacrux — Female, mature, mid-pitch. Warm motherly tone." },
  { id: "iapetus",      label: "Iapetus — Male, clear, mid-low pitch",         description: "Iapetus — Male, clear, mid-low pitch. Crisp confident delivery." },
  { id: "kore",         label: "Kore — Female, firm, mid pitch",               description: "Kore — Female, firm, mid-pitch. Steady assertive delivery." },
  { id: "laomedeia",    label: "Laomedeia — Female, upbeat, mid-high pitch",   description: "Laomedeia — Female, upbeat, mid-high pitch. Energetic cheerful tone." },
  { id: "leda",         label: "Leda — Female, youthful, mid-high pitch",      description: "Leda — Female, youthful, mid-high pitch. Trendy Gen-Z energy." },
  { id: "orus",         label: "Orus — Male, firm, mid-low pitch",             description: "Orus — Male, firm, mid-low pitch. Direct confident delivery." },
  { id: "puck",         label: "Puck — Male, upbeat, mid pitch",               description: "Puck — Male, upbeat, mid-pitch. Energetic hype delivery." },
  { id: "pulcherrima",  label: "Pulcherrima — Ungendered, forward, mid-high pitch", description: "Pulcherrima — Ungendered, forward, mid-high pitch. Direct neutral delivery." },
  { id: "rasalgethi",   label: "Rasalgethi — Male, informative, mid pitch",    description: "Rasalgethi — Male, informative, mid-pitch. Clear teaching delivery." },
  { id: "sadachbia",    label: "Sadachbia — Male, lively, low pitch",          description: "Sadachbia — Male, lively, low pitch. Animated grounded delivery." },
  { id: "sadaltager",   label: "Sadaltager — Male, knowledgeable, mid pitch",  description: "Sadaltager — Male, knowledgeable, mid-pitch. Expert calm delivery." },
  { id: "schedar",      label: "Schedar — Male, even, mid-low pitch",          description: "Schedar — Male, even, mid-low pitch. Balanced steady delivery." },
  { id: "sulafat",      label: "Sulafat — Female, warm, mid pitch",            description: "Sulafat — Female, warm, mid-pitch. Friendly approachable tone." },
  { id: "umbriel",      label: "Umbriel — Male, smooth, lower pitch",          description: "Umbriel — Male, smooth, lower pitch. Polished mature delivery." },
  { id: "vindemiatrix", label: "Vindemiatrix — Female, gentle, mid pitch",     description: "Vindemiatrix — Female, gentle, mid-pitch. Soft caring delivery." },
  { id: "zephyr",       label: "Zephyr — Female, bright, mid-high pitch",      description: "Zephyr — Female, bright, mid-high pitch. Cheerful clear delivery." },
  { id: "zubenelgenubi",label: "Zubenelgenubi — Male, casual, mid-low pitch",  description: "Zubenelgenubi — Male, casual, mid-low pitch. Relaxed friendly delivery." },
];

const VOICE_BY_ID: Record<string, VeoVoice> = Object.fromEntries(
  VEO_VOICES.map((v) => [v.id, v])
);

export const VEO_VOICE_IDS = VEO_VOICES.map((v) => v.id);

export function getVoice(id?: string | null): VeoVoice | undefined {
  if (!id) return undefined;
  return VOICE_BY_ID[String(id).toLowerCase()];
}

export function getVoiceDescription(id?: string | null): string {
  return getVoice(id)?.description || "";
}

// Persona → Veo voice ID picker. Two forms:
//
//   pickAutoContentVoice(gender, age) — legacy 8-entry mapping (kept for
//   backward compat with any caller that doesn't pass vibe). One
//   canonical voice per (gender, age) — no rotation.
//
//   pickVoiceByPersona(gender, age, vibe?) — NEW "close match" picker
//   that scores ALL 30 voices in the catalog against the persona's
//   traits and returns the best match. When vibe is provided (e.g.
//   from a framework's target_emotion or scene tone), the score boosts
//   voices whose description matches that vibe. When vibe is absent,
//   degrades gracefully to the same picks pickAutoContentVoice makes.
//
// The picker is deterministic per (gender, age, vibe) tuple — same input
// always returns the same voice ID, so retries / Extend continuations /
// auto-resubmit stay on the same voice as seg-1.
export type AutoContentAge = "20s" | "30s" | "40s" | "55+";
export type VoiceVibe =
  | "hype"      // energetic, excitable — HOOK / CTA emotion
  | "warm"      // friendly, gentle — VALUE / REASSURANCE emotion
  | "firm"      // confident, authoritative — REVEAL / DECISIVE emotion
  | "calm"      // smooth, even — STORYTELLING / NARRATION emotion
  | "playful"   // upbeat, breezy — LIGHT / FUN emotion
  | "serious"   // informative, knowledgeable — EDUCATIONAL / EXPERT emotion
  | "youthful"  // Gen-Z trendy — VIRAL HOOK emotion
  | "mature";   // motherly, deep — NOSTALGIC / WISE emotion

export function pickAutoContentVoice(
  gender: "male" | "female",
  age: AutoContentAge
): string {
  return pickVoiceByPersona(gender, age);
}

// Parse persona traits out of a freeform Veo prompt — used by manual
// UGC tab and UGC AI agent where the caller doesn't have an explicit
// avatar gender/age form field but DOES have a scene description that
// usually mentions the character.
//
// Returns gender + age + optional vibe. Defaults:
//   gender = female (most Malaysian TikTok UGC is female-fronted)
//   age = 30s (most common bestie-tone register)
//   vibe = undefined (no biasing)
//
// Detection is keyword-based and case-insensitive. When multiple age
// keywords match, the MORE SPECIFIC one wins (nenek > older woman >
// woman). Same for gender (male/man wins over woman if both appear,
// because male reference often follows "and a woman" framing).
export function detectPersonaFromPrompt(prompt: string): {
  gender: "male" | "female";
  age: AutoContentAge;
  vibe?: VoiceVibe;
} {
  const p = String(prompt || "").toLowerCase();

  // Gender — female cues are stronger because Malaysian UGC defaults
  // female; only flip to male when male cues appear and female don't.
  const femaleCues = /\b(female|woman|lady|girl|makcik|nenek|kakak|adik perempuan|wife|mother|daughter|sister|aunt|aunty|granddaughter|hijab|tudung|baju kurung|baju kebaya|she\b|her\b)/i;
  const maleCues = /\b(male|\bman\b|guy|boy|pakcik|atok|abang|adik lelaki|husband|father|son|brother|uncle|grandson|baju melayu|kopiah|songkok|\bhe\b|\bhis\b)/i;
  const hasFemale = femaleCues.test(p);
  const hasMale = maleCues.test(p);
  let gender: "male" | "female" = "female";
  if (hasMale && !hasFemale) gender = "male";
  else if (hasMale && hasFemale) {
    // Both present — first match wins (subject typically mentioned first)
    const fIdx = p.search(femaleCues);
    const mIdx = p.search(maleCues);
    gender = mIdx >= 0 && mIdx < fIdx ? "male" : "female";
  }

  // Age — most-specific keywords first
  let age: AutoContentAge = "30s";
  if (/\b(nenek|grandma|grandmother|atok|grandfather|grandpa|elderly|granny|in (his|her) (50s|60s|70s|80s))\b/.test(p)) {
    age = "55+";
  } else if (/\b(makcik|pakcik|aunt|uncle|aunty|middle.?aged|mature|in (his|her) 40s)\b/.test(p)) {
    age = "40s";
  } else if (/\b(young|gen.?z|teen|teenager|college|student|youthful|trendy|in (his|her) 20s|early.?20s)\b/.test(p)) {
    age = "20s";
  } else if (/\b(in (his|her) 30s|professional adult|adult woman|adult man)\b/.test(p)) {
    age = "30s";
  }

  // Vibe — optional biasing toward voices matching the scene tone
  let vibe: VoiceVibe | undefined;
  if (/\b(excited|hype|hyped|energetic|trendy|viral|wild|epic|crazy|gila)\b/.test(p)) vibe = "hype";
  else if (/\b(playful|fun|cheerful|upbeat|silly|cute|lively)\b/.test(p)) vibe = "playful";
  else if (/\b(warm|friendly|kind|caring|gentle|cozy|welcoming|approachable)\b/.test(p)) vibe = "warm";
  else if (/\b(firm|confident|direct|authoritative|serious|knowledgeable)\b/.test(p)) vibe = "firm";
  else if (/\b(calm|peaceful|soft|quiet|smooth|relaxed|reflective)\b/.test(p)) vibe = "calm";
  else if (/\b(mature|wise|experienced|nostalgic|traditional)\b/.test(p)) vibe = "mature";

  return { gender, age, vibe };
}

// One-call helper for prompt-based callers (manual UGC, UGC agent).
// Parses persona from the prompt + returns the picked voice ID. Same
// determinism as pickVoiceByPersona — identical prompts return identical
// voices across retries / segments, so the character's voice stays
// locked through the whole clip + any continuations.
export function pickVoiceFromPrompt(prompt: string): string {
  const { gender, age, vibe } = detectPersonaFromPrompt(prompt);
  return pickVoiceByPersona(gender, age, vibe);
}

export function pickVoiceByPersona(
  gender: "male" | "female",
  age: AutoContentAge,
  vibe?: VoiceVibe
): string {
  // Hard filter — female personas only consider female-labelled voices,
  // male personas only male. pulcherrima (ungendered) is excluded by
  // this filter, kept available for manual UGC dropdown selection only.
  const candidates = VEO_VOICES.filter((v) => {
    const lbl = v.label;
    if (gender === "female") return /\bFemale\b/.test(lbl);
    return /\bMale\b/.test(lbl) && !/\bFemale\b/.test(lbl);
  });

  // Age-band scoring — match the trait keywords in each voice's
  // description against typical traits for that age band.
  const AGE_KEYWORDS: Record<AutoContentAge, RegExp> = {
    "20s":  /youthful|young|gen.?z|excitable|upbeat|energetic|bright|hype|trendy|high pitch|mid-high/i,
    "30s":  /friendly|warm|easy-going|natural|conversational|smooth|breezy/i,
    "40s":  /mature|warm|firm|motherly|steady|authoritative|smooth|knowledgeable|even/i,
    "55+":  /gentle|deep|mature|wise|calm|caring|informative|lower pitch|low pitch/i,
  };
  const AGE_PITCH_BONUS: Record<AutoContentAge, RegExp> = {
    "20s":  /high pitch|mid-high pitch/i,
    "30s":  /mid pitch|mid-pitch/i,
    "40s":  /mid pitch|mid-low pitch/i,
    "55+":  /low pitch|lower pitch|mid-low pitch/i,
  };

  // Vibe scoring — boost voices whose description matches the requested
  // emotional tone. Optional — vibe=undefined skips this step.
  const VIBE_KEYWORDS: Record<VoiceVibe, RegExp> = {
    hype:     /hype|excitable|excited|energetic|upbeat|cheerful/i,
    warm:     /warm|friendly|gentle|caring|approachable|motherly/i,
    firm:     /firm|steady|authoritative|direct|confident|knowledgeable/i,
    calm:     /gentle|smooth|even|caring|calm|breathy/i,
    playful:  /playful|upbeat|excitable|cheerful|hype|breezy|lively/i,
    serious:  /informative|authoritative|knowledgeable|firm|deep|mature/i,
    youthful: /youthful|young|gen.?z|trendy|energetic|bright|excitable/i,
    mature:   /mature|warm|motherly|caring|deep|gentle|knowledgeable/i,
  };

  const scored = candidates.map((v) => {
    const desc = v.description;
    let score = 0;
    if (AGE_KEYWORDS[age].test(desc)) score += 30;
    if (AGE_PITCH_BONUS[age].test(desc)) score += 10;
    if (vibe && VIBE_KEYWORDS[vibe].test(desc)) score += 25;
    return { voice: v, score };
  });

  // Deterministic tie-break by voice ID alphabetical order, so same
  // input always produces same output across server restarts and
  // retries — critical for seg-1 ↔ seg-2 voice continuity.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.voice.id.localeCompare(b.voice.id);
  });

  return scored[0]?.voice.id || (gender === "female" ? "callirrhoe" : "achird");
}

// The full lock block appended to every Veo prompt — same wording across
// manual UGC, the UGC AI agent, and Auto Content. When a voice is chosen
// its description is embedded inside the AUDIO LOCK as VOICE CHARACTER
// (LOCKED) so the model treats it as a hard constraint.
//
// When hijab=true, the block ALSO injects:
//   • HIJAB LOCK — non-negotiable rule that hair must stay fully covered
//   • Removes "loose hair" from UGC AUTHENTICITY (was overriding the
//     character's hijab description for clients)
//   • Adds hijab-specific terms to the Negative list ("free hair",
//     "uncovered hair", "no hijab", etc.) so Veo can't drop the tudung
//     mid-generation.
//
// Without this flag (or hijab=false), nothing about hijab is asserted —
// the persona stays free-hair-allowed, same as the pre-fix behaviour.
export function buildVeoLocks(opts: {
  /** Explicit catalog voice ID (e.g. "callirrhoe", "fenrir"). When
   *  provided, used verbatim — manual UGC tab passes the user's
   *  dropdown selection here. */
  voiceId?: string | null;
  /** Auto-pick context (used when voiceId is missing). Persona gender +
   *  age — pickVoiceByPersona scores all 30 catalog voices and returns
   *  the closest match (e.g. fenrir for male 20s hype, callirrhoe for
   *  female 30s, vindemiatrix for female 55+). Same input always returns
   *  the same voice ID, so seg-1 ↔ seg-2 ↔ retries stay locked. */
  gender?: "male" | "female";
  age?: AutoContentAge;
  /** Optional emotion hint that biases auto-pick. Comes from framework
   *  target_emotion in Auto Content (HOOK=hype, VALUE=warm, REVEAL=firm,
   *  STORYTELLING=calm) or scene template in UGC agent. */
  vibe?: VoiceVibe;
  /** Legacy free-text voice description. DEPRECATED — STRICT catalog pick
   *  is preferred (every Veo prompt now resolves to ONE specific catalog
   *  voice, not a free-text description). Kept as last-resort fallback. */
  voiceLine?: string | null;
  /** true when the persona is hijabi. Caller in auto-content / UGC
   *  passes the value selected by the user in the Style dropdown. */
  hijab?: boolean;
  /** Duration in seconds for this shot. Drives the DIALOG LENGTH LOCK
   *  word-count target — rule is N × 3 Malay words at conversational
   *  pace. Defaults to 8 (Veo 8s shot). Grok callers pass their
   *  per-second slider value (8-30) so a 12s Grok clip targets 36
   *  words, a 20s Grok clip targets 60, etc. */
  durationSec?: number;
}): string {
  // STRICT VOICE PICK — every Veo prompt now resolves to ONE specific
  // catalog voice ID (1 of 30 in VEO_VOICES). Generic free-text
  // descriptions like "warm Malay woman in her 30s" let Veo's TTS drift
  // between voices across retries / segments. A specific catalog ID
  // ("Callirrhoe — Female, easy-going, mid-pitch. Natural conversational
  // tone.") is treated as a hard constraint.
  //
  // Resolution order:
  //   1. opts.voiceId (explicit pick — manual UGC dropdown)
  //   2. pickVoiceByPersona(gender, age, vibe) (auto-content / agent)
  //   3. opts.voiceLine (legacy free-text, kept for back-compat)
  //   4. Hard default "callirrhoe" (sensible female 30s)
  let resolvedVoiceId = String(opts.voiceId || "").trim();
  if (!resolvedVoiceId && opts.gender && opts.age) {
    resolvedVoiceId = pickVoiceByPersona(opts.gender, opts.age, opts.vibe);
  }
  const catalogDesc = resolvedVoiceId ? getVoiceDescription(resolvedVoiceId) : "";
  const voiceDesc =
    catalogDesc ||
    String(opts.voiceLine || "").trim() ||
    getVoiceDescription("callirrhoe"); // last-resort hard default
  const voiceCharLine =
    `\nVOICE CHARACTER (LOCKED — use this exact voice for the entire clip and all continuations): ${voiceDesc}`;

  const isHijab = !!opts.hijab;

  // HIJAB LOCK — only appended when persona is hijabi. The phrasing is
  // deliberately maximalist (NEVER / non-negotiable) because Veo
  // empirically drops the tudung when the prompt is permissive. Three
  // repetitions of the "covered" constraint anchor it across attention
  // layers.
  const hijabLockLine = isHijab
    ? `\nHIJAB LOCK (non-negotiable): The female character wears a hijab / tudung labuh that COMPLETELY covers all hair, ears, and neck. ZERO hair strands visible anywhere in frame. NEVER bangs showing, NEVER fringe peeking, NEVER side-hair, NEVER ears exposed, NEVER neck exposed. The hijab stays on for the entire clip — through movement, head turns, smiles, and reactions. If the reference avatar shows hijab, the generated character MUST match: hair fully covered, no exceptions, no drift.`
    : "";

  // UGC AUTHENTICITY drops "loose hair" for hijab personas because that
  // phrase was overriding the hijab description silently. For non-hijab
  // personas the original phrasing is preserved.
  const ugcAuthLine = isHijab
    ? `UGC AUTHENTICITY: Authentic amateur iPhone UGC — handheld arm's-length, natural skin texture with pores and subtle T-zone shine (NOT airbrushed), no-makeup-makeup, ordinary mixed lighting (NOT softbox), lived-in background with minor clutter.`
    : `UGC AUTHENTICITY: Authentic amateur iPhone UGC — handheld arm's-length, natural skin texture with pores and subtle T-zone shine (NOT airbrushed), no-makeup-makeup, loose hair, ordinary mixed lighting (NOT softbox), lived-in background with minor clutter.`;

  // Negative list — hijab-specific terms are appended only when hijab=true.
  const hijabNegatives = isHijab
    ? ", free hair, loose hair, uncovered hair, visible hair, hair strands, fringe showing, bangs, no hijab, hijab removed, head uncovered, ears visible, neck exposed, salon-style hair"
    : "";

  // Compressed lock block — keeps EVERY constraint category from the
  // original verbose version (CLEAN FRAME / ANATOMY / AUDIO / VOICE
  // CHARACTER / DIALOG LENGTH / LANGUAGE / VOICE CONSISTENCY / PRODUCT /
  // HIJAB / UGC AUTHENTICITY / MODESTY / Negative). Phrasing is terser
  // per MindStudio's Veo 3.1 Fast spec:
  //   "Veo 3.1 Fast processes prompts up to 2,000 characters. Longer
  //    descriptions don't improve results and may slow generation."
  // Old version was ~2,200-3,000 chars of locks alone — total prompts
  // (with scene description) consistently hit 4,500-5,500 chars,
  // 2-3× over Veo's effective attention budget. Compressed version
  // lands at ~1,200-1,500 chars so total prompts fit under 2,000.
  // No structural changes: same opts signature (voiceId, voiceLine,
  // hijab, durationSec), same hijab branching, same per-second Grok
  // dialog math, same negative list (just deduped against positive
  // locks).
  return `

🚫 CLEAN FRAME LOCK (top violation): Raw camera footage. Subject + product fill frame edge-to-edge. ZERO icons, badges, emojis, stickers, buttons, captions, subtitles, text overlays, UI of any kind. "beg kuning" = SPOKEN AUDIO ONLY — NEVER drawn as a yellow bag, basket, cart, or any visual symbol. Yellow shopping icon in frame = wrong output.

ANATOMY LOCK: 1 human, 2 hands × 5 fingers (both visible when in frame), symmetric face, normal proportions. No extra/missing/fused limbs, warped joints, plastic skin, morphing face, doubled features.
AUDIO LOCK: ONE voice only. No chatter, background voices, whispered overdubs, echo doubles, ghost sound, phantom audio. No music, instrumental, SFX, ambient, score, jingles. Spoken dialog only.${voiceCharLine}
${(() => {
  const d = Math.max(2, Math.round(opts.durationSec || 8));
  // Veo 8s shots have a tighter 20-24 word window (denser UGC pace).
  // Grok (any duration other than 8s, since Veo always runs as 8s
  // segments) uses a FIXED 3 words/sec rate — Grok's lip-sync engine
  // is tuned for that pace; under = mouth freezes, over = clipped.
  if (d === 8) {
    return `DIALOG LENGTH LOCK: 20-24 Malay words for this 8s shot. Under 18 = mouth freezes. Over 26 = rushed.`;
  }
  const target = d * 3;
  return `DIALOG LENGTH LOCK: EXACTLY ${target} Malay words for this ${d}s Grok shot (FIXED 3 words/sec — Grok lip-sync tuned for this rate). <${target - 2} = freeze. >${target + 2} = clipped.`;
})()}
LANGUAGE LOCK: Bahasa Melayu (Malaysian Malay) ONLY — never Bahasa Indonesia. Use: korang, aku, ni, tu, memang, gila, lah, je, dah, eh. NEVER: kalian, gue, lo, banget, sih, dong, kayak, gimana, kasihan, mau, nih, tuh.
PRODUCT LOCK: Pixel-identical to reference — same color, shape, label, typography, packaging. Sharp focus on label, no warp/recolor/relabel/text-drift. Reference = single source of truth.${hijabLockLine}
${ugcAuthLine}
MODESTY LOCK (Malaysian-Muslim, ALL personas): FEMALE — loose-fit only, short-sleeve OK, NO tight body-hugging tops, cleavage, V-necks, crop tops, midriff/navel exposure, short shorts, mini skirts, thigh exposure. Bottoms cover thighs (long pants, maxi/midi skirts, baju kurung). Hair visible only if non-hijab. MALE — long sleeves preferred, smart short-sleeve OK, NO shirtless, tank tops, tight muscle-tees. Modest casual only.

Negative: yellow shopping bag/basket/cart icon, TikTok shop badge, affiliate sticker/button, product floating icon, interface/app overlay, brand watermark/logo/text overlay, store name overlay, letterbox/black bars, cropped composition, cartoon, 3D cartoon, anime, airbrushed plastic skin, uncanny valley, glam makeup, salon hair, softbox lighting, posed billboard framing, closed mouth while audio plays, extra/fused/deformed fingers, hand out of frame, warped product label, blurry product, text drift, subtitle burn-in, auto-captions, on-screen dialog text, second voice, whispered overdub, ghost voice, music, instrumental, SFX, ambient, jingles, Bahasa Indonesia, Indonesian slang${hijabNegatives}.`;
}
