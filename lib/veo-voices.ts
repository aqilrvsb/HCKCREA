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
  voiceId?: string | null;
  voiceLine?: string | null; // legacy free-text fallback (auto-content's gender/age block)
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
  const voiceDesc =
    getVoiceDescription(opts.voiceId) ||
    String(opts.voiceLine || "").trim();
  const voiceCharLine = voiceDesc
    ? `\nVOICE CHARACTER (LOCKED — use this exact voice for the entire clip and all continuations): ${voiceDesc}`
    : "";

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

  return `

🚫 CLEAN FRAME LOCK (READ FIRST — most violated rule): This is a RAW CAMERA RECORDING. The character / product fills the frame naturally edge-to-edge as a normal phone-recorded video. ZERO graphics rendered into the video. ZERO yellow shopping bag icons. ZERO yellow basket icons. ZERO TikTok Shop badges. ZERO floating product icons. ZERO emojis. ZERO stickers. ZERO buttons. ZERO captions. ZERO subtitles. ZERO text overlays. ZERO UI elements of any kind. The phrase "beg kuning" exists ONLY as spoken audio coming from the character's mouth — it is NEVER, under ANY circumstances, drawn / illustrated / rendered / composited as a yellow bag, shopping cart, basket, or any visual symbol in the frame. If you see a yellow shopping icon anywhere in the output, the entire generation is wrong. Frame contains ONLY: the person (if Template A) and the product, filling the natural shot composition — NOT confined to the top portion. NOTHING ELSE EXISTS IN THE FRAME.

ANATOMY LOCK: ONE human only — exactly 2 hands with 5 fingers each (both clearly visible when in frame), symmetric face, normal proportions, no missing limbs, no extra limbs, no fused fingers, no warped joints, no plastic / waxy skin, no uncanny-valley features, no morphing face, no asymmetric eyes, no doubled facial features.
AUDIO LOCK: ONE single voice only — no chatter, no background voices, no whispered second voice, no echo doubles, NO ghost sound, NO phantom audio, NO unexplained noise. NO background music, NO instrumental, NO sound effects, NO ambient music, NO score, NO jingles. All audio is spoken dialog only.${voiceCharLine}
${(() => {
  const d = Math.max(2, Math.round(opts.durationSec || 8));
  // Veo 8s shots have a tighter 20-24 word window (denser UGC pace).
  // Everything else (Grok 8-30s) uses 2-3 words/sec range.
  const lo = d === 8 ? 20 : d * 2;
  const hi = d === 8 ? 24 : d * 3;
  return `DIALOG LENGTH LOCK: Total spoken dialog = ${lo}-${hi} Malay words for this ${d}s shot. Under ${lo - 2} = mouth freezes at end. Over ${hi + 2} = rushed audio.`;
})()}
LANGUAGE LOCK: Spoken dialog is BAHASA MELAYU (Malaysian Malay) ONLY. NEVER Bahasa Indonesia. Use Malaysian markers: korang, aku, ni, tu, memang, gila, kau, lah, je, dah, eh. FORBIDDEN Indonesian words: kalian, gue, lo, banget, sih, dong, kayak, gimana, ngapain, kasihan, doang, mau, nih, tuh.
VOICE CONSISTENCY LOCK: The character's voice has fixed identity — same gender, same age range, same pitch, same Malaysian accent, same speaking rhythm and energy across the entire clip and any future continuation. Voice MUST stay locked so seg-2 / Extend continuations match seg-1 seamlessly.
PRODUCT LOCK: Product visual is pixel-identical to reference — same color, shape, label, typography, layout, packaging, finish. Sharp focus on label, no warping, no recoloring, no text drift, no relabel, no re-illustration. When a reference image is attached, the reference is the SINGLE source of truth for the product — anchor framing, lighting, and hand-holding around it.${hijabLockLine}
${ugcAuthLine}
MODESTY LOCK (Malaysian-Muslim audience — applies to ALL personas regardless of hijab choice): For FEMALE — short-sleeve T-shirts are FINE; loose-fit only. NO tight body-hugging tops that show breast/chest contour, NO cleavage, NO V-necks low enough to expose chest, NO crop tops, NO midriff or navel exposure, NO short shorts, NO mini skirts, NO thigh exposure. Bottoms must cover thighs (long pants, jeans, maxi/midi skirts, baju kurung). Hair MAY be visible only if persona is non-hijab. For MALE — long sleeves preferred but smart short-sleeve shirts/polos are fine. NO shirtless, NO tank tops, NO tight muscle-tees. Modest casual / smart-casual silhouettes only.

Negative: yellow shopping basket, yellow shopping bag, yellow basket icon, yellow bag icon, shopping cart icon, basket emoji, bag emoji, TikTok shop badge, TikTok shop button, beg kuning icon, beg kuning graphic, affiliate sticker, affiliate button, product floating icon, interface overlay, app overlay, on-screen button, on-screen icon, brand watermark, brand name watermark, brand logo overlay, brand name text overlay, store name overlay, store watermark, burned-in brand text, burned-in store name, burned-in watermark, registered trademark symbol overlay, copyright symbol overlay, brand name in capital letters as bottom overlay, ALL CAPS brand text watermark, lower-third brand text, lower-third product name text, letterbox bars, black bars top, black bars bottom, empty bottom band, cropped composition, vertical letterbox, cartoon, 3D cartoon, anime, airbrushed plastic skin, uncanny valley, glam makeup, salon hair, softbox studio lighting, tripod static shot (unless explicitly chosen), staged background, posed billboard framing, closed mouth while audio plays, duplicate limbs, extra fingers, fused fingers, distorted fingers, deformed hand, hand out of frame, warped product label, blurry product, motion-blurred product, text drift, subtitle burn-in, auto-captions, on-screen dialog text, burned-in lyrics, karaoke text, multiple speakers, second voice, whispered overdub, ghost voice, phantom audio, ambient noise, voiceover narration, music score, background music, instrumental track, sound effects, ambient music, jingles, Bahasa Indonesia, Indonesian accent, Indonesian slang${hijabNegatives}.`;
}
