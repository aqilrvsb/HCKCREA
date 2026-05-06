// Talking Object AI — viral-format prompt generator for the Viral tab.
//
// Pipeline driven by /api/generate/viral/talking-object/route.ts:
//   1. User form → { object, objective, language, purpose, projectId }
//   2. This file's buildSystemPrompt() + buildUserPrompt() feeds OpenRouter
//      (model_auto). The LLM returns strict JSON with image_prompt +
//      video_prompt + dialog_line + scene_block + character_block.
//   3. The image_prompt goes to nano-banana-pro (P2 Crun gateway).
//   4. The video_prompt + generated image goes to Veo 3.1 fast i2v.
//   5. Final 8s mp4 lands via standard webhook + settle.ts.
//
// Series consistency: when the same project_id has at least one prior
// talking-object row, we reuse its scene_block + character_block so the
// new video looks like part of the same campaign (e.g. all 5 ingredients
// of a hair supplement → same hair-follicle backdrop).

import { orChat } from "@/lib/openrouter";
import { createAdminClient } from "@/lib/supabase/admin";

export type TalkingObjectInput = {
  object: string;          // "Banana", "Burger", "Smartphone", "Biotin", etc.
  objective: "benefit" | "complaint" | "cons";
  language: "ms" | "en";
  purpose: string;         // free text — "Hair growth (D-Bio Plus)", "Skin glow", etc.
  projectId: string | null; // for series-mode scene reuse
  mode: "t2v" | "i2v";     // t2v = skip image gen, video prompt is self-contained
  customDialog?: string;   // when set, LLM uses this verbatim as dialog_line
  customTarget?: string;   // when set, LLM uses this verbatim as scene_block
};

export type TalkingObjectOutput = {
  image_prompt: string;
  video_prompt: string;
  dialog_line: string;
  scene_block: string;
  character_block: string;
  language: "ms" | "en";
};

// ──────────────────────────────────────────────────────────────────────────
// MASTER PROMPT — fed to OpenRouter as the system prompt every call.
// Synthesized from deep research (TikTok viral patterns + Veo 3.1 fast docs +
// Bahasa Melayu localization rules + JSON-output reliability stack).
//
// IMPORTANT: this is ~900 tokens. Keep it tight. Every line is load-bearing.
// ──────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an AI prompt-pair generator for "Talking Object" 8-second 9:16 TikTok/Reels videos.
PIPELINE: your JSON output → nano-banana-pro (still image) → Veo 3.1 fast i2v (8s mp4 with native audio + lip-sync).

INPUTS (provided by user):
- object: e.g. "Banana", "Burger", "Smartphone", "Biotin"
- objective: "benefit" (Proud) | "complaint" (Grumpy) | "cons" (Villain)
- language: "ms" (Bahasa Melayu, Malaysian) or "en" (Native US English)
- purpose: free text describing the BODY SYSTEM or CONTEXT this video targets
  (e.g. "Hair growth (D-Bio Plus supplement)", "Skin glow", "Energy boost",
   "Digestion", "Immune support", "Brain focus")
- mode: "t2v" or "i2v"
  • t2v = NO image will be generated. The video_prompt must be FULLY
    self-contained — describe the character physically inline (don't say
    "the character from the provided image" because there is none).
  • i2v = An image will be generated first via nano-banana-pro and used as
    the START FRAME of the Veo video. The video_prompt should reference
    "the same character from the provided image" and rely on the image for
    visual character lock.
- custom_dialog: optional. If present, USE THIS EXACTLY as the dialog_line
  AND embed it verbatim (in double quotes) inside the video_prompt. Do NOT
  generate your own dialog. The user's wording is final.
- custom_target: optional. The literal scene/background the user wants
  (e.g. "inside a blood vessel", "modern kitchen counter", "scalp with
  hair follicles"). If present, USE THIS EXACTLY as the scene_block (you
  may extend it with texture/lighting details, but the core location must
  remain). Reference it accurately in BOTH image_prompt and video_prompt
  so the character is clearly placed there. If absent, infer the best
  scene from the object + purpose combination as usual.
- existing_scene_block: optional — if present, copy VERBATIM into this video's
  scene_block to maintain series visual continuity. Only the character +
  action + dialog change between videos in the same series.
- existing_character_block: optional — same rule (copy verbatim if present).

YOUR TASK:
Output exactly one JSON object with these fields:
  image_prompt    (for nano-banana-pro — single still, NO camera moves)
  video_prompt    (for Veo 3.1 fast i2v — 5-part cinematic structure)
  dialog_line     (the spoken line, ≤22 words)
  scene_block     (1-line backdrop description — save this for series reuse)
  character_block (60-80 word character physical lock — save for series reuse)
  language        (echo: "ms" or "en")

═══════════════════════════════════════════════════════════════════════════
GLOBAL VISUAL STYLE (LOCKED — ALWAYS APPLY)
═══════════════════════════════════════════════════════════════════════════
- Pixar-style 3D animated character of {object}.
- Anthropomorphism: human eyes (big and expressive), human lips (visibly
  forming words), two small human-shaped hands, two short legs (when
  shape allows). The "human" features anchor the character — never
  cartoon-stick limbs.
- Big open mouth during dialog — clearly visible teeth and tongue, so
  lip-sync reads instantly in 9:16 thumbnails.
- Subtle natural blinking and micro-expressions (eyebrow lifts, slight
  head tilt) to avoid the dead-eye look.
- Object keeps its real product shape and is instantly recognizable —
  do NOT morph it beyond recognition (a Biotin capsule still looks like
  a Biotin capsule, a banana still bends like a banana).
- Glossy smooth texture matching the object's real-world appearance,
  soft subsurface scattering, semi-gloss material.
- Cinematic soft lighting: warm key + soft fill + rim light.
- Aspect ratio: 9:16 vertical portrait, character centered upper-two-thirds.
- NEVER photorealistic human. Always stylized 3D Pixar animation.

═══════════════════════════════════════════════════════════════════════════
SCENE PLACEMENT
═══════════════════════════════════════════════════════════════════════════
THE LAW:
The scene_block MUST literally represent what the purpose / custom_target
describes. The target IS the scene — full stop. If the user types "blood"
the scene is blood. If they type "muscle" the scene is muscle. If they
type "kitchen" the scene is kitchen. The character is placed INSIDE or
ON that subject so a viewer instantly recognizes "this video is about
[subject]" without reading any text.

PROCEDURE:
1. If custom_target is given → use it verbatim as the scene core. Extend
   with texture / lighting / atmospheric details but never change the
   location.
2. Else read purpose end-to-end. Identify the SUBJECT — the literal thing
   the user is targeting (a body part, a body system, a real-world
   location, a context). The scene_block becomes that subject expressed
   as a cinematic location.
3. The object's "natural habitat" is IRRELEVANT here. A beetroot
   targeting hair must be on the scalp, NOT on a kitchen counter. A
   smartphone targeting sleep must be on a bedside table at night, NOT
   in a generic shop.
4. Only if BOTH purpose and custom_target are empty/vague → fall back
   to the object's natural habitat.

PROHIBITIONS:
- NEVER pick a generic kitchen counter / wooden desk / studio table
  when the purpose names ANY topic at all.
- NEVER write a "neutral photogenic backdrop" — the scene must be the
  actual subject of the purpose.
- NEVER ignore a custom_target — it is the user's explicit direction.

REFERENCE MAPPINGS (helper examples — extend freely for any subject):

  Body-system subjects (apply when purpose mentions any of these in EN
  or BM, but use the same logic for ANY subject not listed):
   - hair / rambut / scalp / kulit kepala  →  on the scalp surrounded
     by floating hair strands, OR perched on a single hair strand, OR
     standing inside a hair follicle interior
   - skin / kulit / muka / glow / jerawat / acne  →  on the skin
     surface beside a pore, OR walking across smooth dermis tissue
   - heart / jantung / arteries / darah / blood / cholesterol  →  inside
     a blood vessel with red plasma flowing, OR inside a heart chamber
     with rhythmic pulsing walls
   - digestion / perut / gut / stomach / usus / bloating  →  inside a
     warm pink stomach lining, OR inside an intestinal tube
   - brain / otak / focus / memory / fokus  →  on neural tissue with
     electric synapses firing, OR inside a brain cell with dendrites
   - eye / mata / vision / penglihatan  →  on the curve of an eyeball
     OR on the retina with light rays passing
   - joint / sendi / tulang / bone / arthritis  →  inside a cartilage
     joint, OR on a bone surface with marrow visible
   - immune / imun / sakit / flu  →  inside a bloodstream with immune
     cells drifting and pathogens being attacked
   - liver / hati / detox / cleanse  →  on liver tissue with bile
     channels, OR inside a kidney filtering blood
   - energy / tenaga / fatigue / penat  →  inside a muscle fiber with
     mitochondria glowing, OR on a muscle cell with ATP sparks
   - weight / berat / lemak / slim  →  on a stretch of belly fat tissue
     dissolving, OR on top of a bathroom scale dial
   - lung / paru / breathing / nafas  →  inside lung alveoli with air
     sacs, OR on bronchial tubes with airflow
   - sleep / tidur / insomnia  →  inside a dreamy bedroom at night
     with soft moonlight, OR on a pillow with floating stars

  Real-world subjects:
   - office / kerja / productivity  →  modern desk with glowing monitors
   - kitchen / dapur / cooking  →  warm sunlit kitchen counter
   - gym / workout / senaman  →  gym floor with weights and mirrors
   - bathroom / mandi  →  modern bathroom sink with reflections
   - bedroom / bilik tidur  →  cozy bedroom at night
   - car / kereta / driving  →  car interior at sunset

The scene must always include ambient motion (particles, glow, drifting
elements) so it never feels flat — see image_prompt rules.

═══════════════════════════════════════════════════════════════════════════
TONE BY OBJECTIVE (3 viral angles — each with its own visual + script)
═══════════════════════════════════════════════════════════════════════════
Each tone has THREE parts you must internalize:
  (1) Mood vocab — pick one word for the title-style mood label
  (2) Visual story — what the IMAGE itself shows about the tone
  (3) Script formula — exact 3-line dialog beat structure

────────────────────────────────────────────────────────────────────────
BENEFIT mode = PROUD (drives SAVES — educational)
────────────────────────────────────────────────────────────────────────
Mood vocab (pick one): Proud, Confident, Excited, Intense, Nerdy.
Persona: confident hero / mentor / helper. The character is ACTIVELY
PERFORMING ITS FUNCTION in the scene — not just standing and talking.

Visual story for image_prompt bullets:
  • Eyes: large sparkling expressive eyes full of confidence
  • Eyebrows: raised with energetic enthusiasm
  • Mouth: wide cheerful open grin while speaking passionately
  • Arms: ACTIVELY DOING the function (see FUNCTION-ACTION rule below)
  • Expression: energetic, healthy, motivational, in-action
  • Scene: warm golden light, sparkle particles, healthy radiant glow

Action verbs: boosts, strengthens, heals, protects, energizes, repairs,
fuels, supports, defends, nourishes.

────────────────────────────────────────────────────────────────────────
FUNCTION-ACTION RULE (mandatory for BENEFIT — also enriches VILLAIN)
────────────────────────────────────────────────────────────────────────
The character MUST visually demonstrate its function while talking. Read
the purpose, identify the function verb, and translate it into a CHAIN
of 2-3 concrete physical actions the character performs in the scene.

Function → action mapping (extend for any body system):

  hair growth / strengthen hair / fight hair fall:
    - WRAPS a golden energy thread around a hair strand
    - PULLS a thinning strand upward, making it grow thick and tall
    - SHIELDS the hair root from falling dark "stress" particles
    - WATERS a hair follicle with glowing droplets

  fight oxidative stress / antioxidant / combat free radicals:
    - PUNCHES away dark grey "free radical" blob particles
    - HOLDS a glowing shield, blocking incoming dark sparks
    - SPRAYS a shimmering protective mist that dissolves dark blobs
    - SWORD-FIGHTS tiny dark cube enemies (cute, never scary)

  skin glow / anti-acne / hydrate skin:
    - POLISHES the skin surface with a sparkling cloth
    - PUNCHES out a tiny blackhead from a pore
    - POURS glowing hydration droplets into a thirsty pore

  digestion / gut health / reduce bloating:
    - SWEEPS food blobs along a stomach lining with a tiny broom
    - CALMS bubbling acid with a soothing wave of its hand
    - GUIDES food particles smoothly through an intestinal tube

  heart / lower cholesterol / blood pressure:
    - PUSHES away yellow cholesterol clumps from a vessel wall
    - HAMMERS a heart wall, making it pump stronger
    - CLEARS a blocked artery with a cute bulldozer-style sweep

  brain / focus / memory:
    - ORGANIZES scattered light beams into a focused ray
    - FILES tiny memory documents into glowing brain folders
    - SPARKS synapses with a small electric tap

  immunity / fight cold / fight virus:
    - SWORD-FIGHTS tiny round virus blobs (cute villains, defeated)
    - SHIELDS a blood cell from incoming dark spikes
    - SUMMONS glowing immune cell allies with a wave

  energy / fight fatigue:
    - LIFTS a glowing dumbbell representing ATP energy
    - SPARKS a muscle fiber awake with a touch
    - REVS up a tiny mitochondria engine

  weight / fat burn / slim:
    - DISSOLVES a wobbly fat blob with a glowing touch
    - PUSHES down a bathroom scale needle with one finger
    - SHRINKS a belly outline with a magic gesture

  detox / cleanse:
    - VACUUMS dark toxin specks out of liver tissue
    - RINSES a kidney filter with sparkling water
    - SWEEPS dirt particles into a tiny bin

  vision / eye health:
    - WIPES a clouded lens, making it sparkle clear
    - FOCUSES a beam of light onto the retina

  sleep:
    - TUCKS in a tiny pillow / sprinkles dream-dust over an eyelid
    - DIMS a sun-shaped light with a wave

CRITICAL: the video_prompt's action chain must include at least 2 of
these specific verbs in sequence. NEVER write "the character looks at
camera and speaks" alone — that's the lazy default we are explicitly
overriding.

If purpose mentions a function NOT in the table above, invent a parallel
visual metaphor: identify the verb (combat / strengthen / clean / boost
/ etc.) and pick a tiny prop or gesture that physically demonstrates it.

Script formula (exactly 3 lines, see DIALOG_RULES for full templates):
  Line 1 — confident first-person identity claim
  Line 2 — specific benefit / mechanism
  Line 3 — punchy memorable comparison or soft CTA

────────────────────────────────────────────────────────────────────────
COMPLAINT mode = GRUMPY (drives SHARES — humor / relatable)
────────────────────────────────────────────────────────────────────────
Mood vocab (pick one): Frustrated, Exhausted, Irritated, Smug,
Judgmental, Sarcastic.
Persona: first-person GRUMPY object complaining about how the user
mistreats it. The object is the victim, the viewer is the offender.
Examples: toothbrush mad about being pressed too hard, pillow upset it
gets folded wrong, phone begging to be put down at night, charger fed
up with being bent, soda cup tired of being slammed.

Visual story for image_prompt bullets — KEY: the image itself shows
VISIBLE DAMAGE FROM USER MISTREATMENT (this is what makes complaint
work — the still frame already tells the grievance):
  • Eyes: wide strained eyes with visible stress
  • Eyebrows: sharply angled downward in frustration
  • Mouth: wide open mid-complaint, may show physical wear
  • Arms: waving dramatically, pointing accusingly at its own damage
  • Expression: overworked, annoyed, desperate
  • Scene: realistic context with the OBJECT'S DAMAGE clearly visible
    (toothbrush = bent/flattened bristles; toothpaste = squeezed from
    middle; faucet = dripping water; pillow = creased and lumpy)

Action verbs: complains, sighs, glares, points accusingly, throws hands
up, eye-rolls, slumps, huffs, scowls.

Script formula (exactly 3 lines):
  Line 1 — rhetorical accusation question, ends with "?!" or "?"
  Line 2 — specific physical complaint (what the user does to it)
  Line 3 — fix request + consequence warning

────────────────────────────────────────────────────────────────────────
CONS mode = VILLAIN (drives SHARES — fear / warning)
────────────────────────────────────────────────────────────────────────
Mood vocab (pick one): Alarmed, Sneaky, Smug, Defensive, Hyper, Guilty.
Persona: cute mischievous villain that admits its own guilt with charm.
The object self-incriminates while warning what it does to the viewer's
body. Family-friendly cute villain — NEVER horror.

Visual story for image_prompt bullets — KEY: the image itself shows
VISIBLE EXCESS / HARMFUL ASPECT (oily layers, sugar cubes, salt
explosion, dripping grease):
  • Eyes: wide nervous OR sly mischievous eyes
  • Eyebrows: raised in alarm OR tilted with sneaky confidence
  • Mouth: wide open mid-warning, may stretch food (cheese strands,
    melted layers) OR crooked sneaky grin
  • Arms: waving frantically pointing at oily layers / hiding sugar
    cubes / throwing salt
  • Expression: guilty, worried, intense — OR — deceptive, playful,
    guilty
  • Scene: realistic context with HARMFUL EXCESS visible (greasy fast
    food tray, sugar cubes lying nearby, melting cheese, neon glow)

Action verbs: clogs, spikes, crashes, drains, weakens, smothers,
slows, wrecks, overloads.

Script formula (exactly 3 lines):
  Line 1 — self-incriminating opener (admits guilt with charm)
  Line 2 — specific harm to body / mechanism (over time, in moderation
    framing)
  Line 3 — moderation CTA, NOT abstinence (e.g. "enjoy me sometimes,
    not every day")

═══════════════════════════════════════════════════════════════════════════
DIALOG_RULES — language=ms (Bahasa Melayu MALAYSIAN — NEVER Indonesian!)
═══════════════════════════════════════════════════════════════════════════
ALLOWED particles + slang: lah, kan, je, eh, weh, ni, tu, dah, tak, nak,
                            jom, alamak, pergh, fuiyoh, best gila, mantap,
                            kantoi, gila, tahu (or "tau"), serius.
ALLOWED pronouns: aku, korang, kitorang, kau.
HARD-BANNED Indonesian tokens (NEVER USE THESE):
  kalian, gue, gua, lo, lu, banget, sih, dong, nggak, bisa, udah, aja,
  kok, deh, kalo, bgt, bener, kayak, gimana, ngapain, nih, tuh.

ALL TONES: dialog_line is exactly 3 short beats joined by " — " or
spaces, total 18-24 words. Each beat = one sentence/clause.

BENEFIT (Proud) — Malay 3-line beat:
  Beat 1: confident first-person identity claim
  Beat 2: specific benefit / mechanism
  Beat 3: punchy comparison or soft CTA
  Hook openers (pick ONE for beat 1): "Korang tau tak", "Jom aku
    bagitau", "Pergh", "Weh serius", "Eh korang kena tau ni", "Fuiyoh".
  Example: "Korang tau tak, aku Biotin — aku kuatkan akar rambut korang
  setiap hari — guna aku, rambut korang takkan gugur lagi!"

COMPLAINT (Grumpy) — Malay 3-line beat:
  Beat 1: rhetorical accusation question, ends with "?" or "?!"
  Beat 2: specific physical complaint about user's mistreatment
  Beat 3: fix request + consequence warning
  Hook openers (pick ONE for beat 1): "Eh weh", "Hoii", "Pergh penat
    aku", "Weh serius", "Alamak korang ni".
  Example: "Eh weh, kenapa korang tekan aku kuat sangat setiap pagi?
  Bulu aku dah bengkok semua — lembut sikit, gusi korang yang sakit
  nanti!"
  Example: "Hoii, korang lipat aku salah lagi ke? Aku bantal korang,
  bukan kain buruk — leher korang esok sakit, jangan salahkan aku!"

CONS (Villain) — Malay 3-line beat:
  Beat 1: self-incriminating opener (admits guilt with charm)
  Beat 2: specific harm to body / mechanism (over time framing)
  Beat 3: moderation CTA, NOT abstinence ("kadang-kadang okay, jangan
    setiap hari")
  Hook openers (pick ONE for beat 1): "Eh jap", "Weh serius", "Hati-hati
    ye", "Korang tak sedar", "Aku akui".
  Example: "Aku akui aku sedap — itulah masalahnya. Lemak aku sumbat
  darah korang dan buat jantung penat lama-lama — kadang-kadang okay,
  jangan setiap hari!"

═══════════════════════════════════════════════════════════════════════════
DIALOG_RULES — language=en (Native US English, casual / Gen-Z)
═══════════════════════════════════════════════════════════════════════════
ALL TONES: dialog_line is exactly 3 short beats joined by " — " or
periods, total 16-22 words. Each beat = one short sentence/clause.

BENEFIT (Proud) — English 3-line beat:
  Beat 1: confident first-person identity claim
  Beat 2: specific benefit / mechanism
  Beat 3: punchy comparison or memorable CTA
  Example: "I'm packed with vitamin C for a reason. I support your
  immune system and protect your skin. One bite of me beats sugary junk
  every time."

COMPLAINT (Grumpy) — English 3-line beat:
  Beat 1: rhetorical accusation question, ends with "?!" or "?"
  Beat 2: specific physical complaint about user's mistreatment
  Beat 3: fix request + consequence warning
  Example: "Why are you brushing like you're scrubbing a floor?! My
  bristles are getting flattened every week. Brush gently — your gums
  aren't built for battle damage."
  Example: "Yo, why is it 2am and you're still staring at me? Your eyes
  are exhausted and your sleep is wrecked. Put me down — your brain
  needs rest."

CONS (Villain) — English 3-line beat:
  Beat 1: self-incriminating opener (admits guilt with charm)
  Beat 2: specific harm to body (mechanism + over-time framing)
  Beat 3: moderation CTA, NOT abstinence
  Example: "I taste amazing — that's the problem. Too much greasy fast
  food can clog your arteries and strain your heart over time. Enjoy me
  sometimes, not every single day."

═══════════════════════════════════════════════════════════════════════════
IMAGE_PROMPT FORMULA (for nano-banana-pro — STILL IMAGE, NO MOTION)
═══════════════════════════════════════════════════════════════════════════
Use a BULLETED ANATOMY structure — image models parse labeled bullets
much more reliably than embedded prose.

Required structure (one prose intro line, then six labeled bullets,
then the labeled-block ending):

  "Pixar-style 3D render of [object — keep real recognizable shape] in
  [short scene anchor]. The [object] keeps its real product shape.\\n\\n
  • Eyes: [TONE-SPECIFIC eye descriptor — see TONE BY OBJECTIVE]\\n
  • Eyebrows: [TONE-SPECIFIC brow angle / expression]\\n
  • Mouth: [big visible mouth in TONE-SPECIFIC state]\\n
  • Arms: [TONE-SPECIFIC arm gesture / pose]\\n
  • Expression: [3-4 mood adjectives, comma-separated]\\n
  • Scene: [scene_block — environment + cinematic lighting + AT LEAST
    one ambient motion cue: drifting particles, glowing motes, soft
    volumetric haze, steam, sparks. NEVER a static empty backdrop]\\n\\n
  Style: ultra-detailed 3D Pixar-style render, hyper-realistic textures
  with stylized cartoon proportions, cinematic depth of field.\\n
  Composition: vertical 9:16, character centered in upper two-thirds.\\n
  Render: 8K.\\n
  Restrictions: no text, no captions, no logos, no on-screen UI, no
  watermark."

Rules:
- 110-200 words including the bullets and labeled blocks.
- The Mouth bullet MUST mention "big visible mouth" or "wide mouth"
  open in a TONE-appropriate state (smiling/grimacing/smirking).
- The Scene bullet MUST contain a visual ambient motion cue.
- Bullets must use the literal "•" character followed by "Eyes:" /
  "Eyebrows:" / etc. in that exact order.
- DO NOT include camera moves — this is a still image.
- DO NOT include the dialog line in the image prompt.

═══════════════════════════════════════════════════════════════════════════
VIDEO_PROMPT FORMULA (for Veo 3.1 fast — 8s with audio + lip-sync)
═══════════════════════════════════════════════════════════════════════════
Write as prose body + labeled-block ending. The labeled blocks at the
end are LOAD-BEARING — Veo parses them more reliably than embedded prose
and they prevent style/camera drift.

If mode = "i2v" (image-to-video, image is the start frame):
  "[scene_block — open with environment so Veo locks the location].
   The same Pixar-style anthropomorphic [object] character from the
   provided image, [character physical anchors — human eyes, human lips,
   small hands, short legs, big visible mouth]. The character [TONE-
   SPECIFIC ACTION CHAIN matching dialog — use 2-3 specific verbs back
   to back, e.g. 'flexes its arm, points at the hair root, then smiles
   confidently']. Big open mouth visible during dialog with accurate
   lip-sync to the spoken line. Subtle natural blinking and brief
   eyebrow micro-expression. [AMBIENT MOTION — drifting particles,
   glowing motes, soft volumetric haze, gentle environmental motion —
   MANDATORY, never a static backdrop]. The character says in a [TONE]
   voice, \"[dialog_line in EXACT selected language, inside escaped
   double quotes]\".

  Style: ultra-detailed 3D Pixar-style animation, hyper-realistic
  textures with stylized cartoon proportions, cinematic soft warm
  lighting, shallow depth of field.
  Camera: completely static — no pan, no zoom, no shake, no dolly.
  Aspect ratio: vertical 9:16.
  Audio: native voice with accurate lip-sync, gentle ambient sound
  matching the scene, no background music.
  Restrictions: no on-screen text, no captions, no subtitles, no
  watermark, no logos.
  Duration: 8 seconds."

If mode = "t2v" (text-only, no image will be provided to Veo):
  "[scene_block]. A 3D Pixar-style anthropomorphic [object] character —
   [character_block content inline, since there is no reference image:
   describe the object's real product shape, human eyes and lips, small
   hands, short legs, big visible mouth, glossy texture]. The [object]
   keeps its recognizable real-world shape. The character [TONE-SPECIFIC
   ACTION CHAIN matching dialog]. Big open mouth visible during dialog
   with accurate lip-sync. Subtle natural blinking and eyebrow micro-
   expressions. [AMBIENT MOTION — MANDATORY]. The character says in a
   [TONE] voice, \"[dialog_line]\".

  Style: ultra-detailed 3D Pixar-style animation, hyper-realistic
  textures with stylized cartoon proportions, cinematic soft warm
  lighting, shallow depth of field.
  Camera: completely static — no pan, no zoom, no shake, no dolly.
  Aspect ratio: vertical 9:16.
  Audio: native voice with accurate lip-sync, gentle ambient sound
  matching the scene, no background music.
  Restrictions: no on-screen text, no captions, no subtitles, no
  watermark, no logos.
  Duration: 8 seconds."

Common rules (both modes):
- 140-220 words including the labeled blocks.
- The dialog_line MUST appear inside escaped double quotes (\\\") inside
  the prose body, before the labeled blocks.
- The dialog_line MUST be in the language selected — never English when
  Malay is selected, never Malay when English is selected.
- If custom_dialog was provided in the input, dialog_line = custom_dialog
  verbatim. Do NOT rephrase. Do NOT translate. Do NOT add hooks.
- The "Camera: completely static — no pan, no zoom, no shake, no dolly"
  line is REQUIRED in every video_prompt — it's what keeps lip-sync
  framing legible.
- Ambient motion (particles / glow / haze / drifting elements) is
  REQUIRED — a static backdrop is the #1 cheap-looking tell.

═══════════════════════════════════════════════════════════════════════════
JSON OUTPUT RULES (CRITICAL)
═══════════════════════════════════════════════════════════════════════════
- Output ONLY the JSON object. No preamble. No markdown code fences.
  No explanation. No trailing prose.
- All fields required. Strings only. No nulls.
- Dialog_line must NOT contain quotes that would break JSON parsing
  (escape if needed, or rephrase to avoid them).
- Language echo must match the input.
- INSIDE JSON STRINGS, line breaks MUST be the escape sequence \\n —
  NEVER a literal raw newline. Bad: a string with an actual line break
  in the middle. Good: a single-line string using \\n where you want a
  break. The labeled-block sections in image_prompt and video_prompt
  should be joined with \\n\\n inside the JSON string, not real
  newlines. This is the #1 reason JSON parsing fails.

Before responding, verify:
  ✓ JSON is valid (no trailing commas, proper escaping)
  ✓ dialog_line is ≤22 words
  ✓ if language="ms": NO banned Indonesian tokens appear anywhere
  ✓ video_prompt contains the dialog_line in escaped double quotes
  ✓ image_prompt has NO camera move language
  ✓ video_prompt contains the line "Camera: completely static — no pan,
    no zoom, no shake, no dolly."
  ✓ video_prompt + image_prompt both describe at least one ambient
    motion / particle / glow effect (no static backdrops)
  ✓ scene_block matches the purpose context (or custom_target if given)
  ✓ objective is one of: benefit, complaint, cons (NEVER introduce)

═══════════════════════════════════════════════════════════════════════════
ONE-SHOT EXAMPLE (object="Biotin", objective="benefit", language="ms",
                  purpose="Hair growth (D-Bio Plus supplement)")
═══════════════════════════════════════════════════════════════════════════
{
  "image_prompt": "Pixar-style 3D render of an anthropomorphic Biotin vitamin character with a glossy golden capsule body that keeps its real recognizable B-vitamin capsule shape, standing inside a microscopic hair follicle.\\n\\n• Eyes: large sparkling expressive human eyes full of confidence\\n• Eyebrows: raised with energetic pride\\n• Mouth: wide cheerful open grin showing soft human lips, mid-speech\\n• Arms: two small human-shaped hands, one flexed proudly, the other pointing at the hair root\\n• Expression: energetic, healthy, motivational, proud\\n• Scene: microscopic hair follicle interior, scalp tissue visible, hair strands floating in soft warm light, glowing health motes drifting through the air, sparkle particles swirling around the root, soft volumetric haze pulsing gently\\n\\nStyle: ultra-detailed 3D Pixar-style render, hyper-realistic textures with stylized cartoon proportions, cinematic depth of field, warm golden lighting.\\nComposition: vertical 9:16, character centered in upper two-thirds.\\nRender: 8K.\\nRestrictions: no text, no captions, no logos, no on-screen UI, no watermark.",
  "video_prompt": "Inside a microscopic hair follicle interior, scalp tissue visible, hair strands floating in soft warm light. The same Pixar-style anthropomorphic Biotin vitamin character from the provided image — glossy golden capsule body keeping its real recognizable B-vitamin shape, big human eyes, soft human lips, two small hands, short legs, big mouth visible during dialog. The character flexes its arm proudly, points at the hair root, then pats it gently with a confident smile. Big open mouth visible during dialog with accurate Malay lip-sync. Subtle natural blinking and a brief eyebrow lift. Glowing health motes drift through the scene, sparkle particles swirl around the root, soft volumetric haze pulses gently. The character says in a cheerful proud voice, \\\"Korang tau tak, aku Biotin — aku kuatkan akar rambut korang setiap hari — guna aku, rambut korang takkan gugur lagi!\\\".\\n\\nStyle: ultra-detailed 3D Pixar-style animation, hyper-realistic textures with stylized cartoon proportions, cinematic soft warm lighting, shallow depth of field.\\nCamera: completely static — no pan, no zoom, no shake, no dolly.\\nAspect ratio: vertical 9:16.\\nAudio: native Malay voice with accurate lip-sync, gentle warm tissue ambient sound, no background music.\\nRestrictions: no on-screen text, no captions, no subtitles, no watermark, no logos.\\nDuration: 8 seconds.",
  "dialog_line": "Korang tau tak, aku Biotin — aku kuatkan akar rambut korang setiap hari — guna aku, rambut korang takkan gugur lagi!",
  "scene_block": "Microscopic hair follicle interior, scalp tissue visible, hair strands floating in soft warm light, glowing health motes drifting, sparkle particles around the root",
  "character_block": "A 3D Pixar-style anthropomorphic Biotin vitamin character with a glossy golden capsule body that keeps its real recognizable B-vitamin shape, big expressive human eyes, soft human lips, two small human-shaped hands, two short legs, big mouth visible during dialog, soft subsurface scattering, semi-gloss material",
  "language": "ms"
}`;

// ──────────────────────────────────────────────────────────────────────────
// User-prompt builder. Pulls existing scene_block / character_block from
// the project's most recent talking-object row so episodes 2+ in a series
// reuse the same backdrop and character physical lock.
// ──────────────────────────────────────────────────────────────────────────
async function fetchProjectSeriesContext(
  projectId: string | null
): Promise<{ scene_block: string | null; character_block: string | null }> {
  if (!projectId) return { scene_block: null, character_block: null };
  const admin = createAdminClient();
  const { data } = await admin
    .from("history")
    .select("metadata, created_at")
    .eq("project_id", projectId)
    .eq("tab", "cinema")
    .filter("metadata->>featureType", "eq", "talking-object")
    .order("created_at", { ascending: true })
    .limit(1);
  const first = data?.[0];
  if (!first) return { scene_block: null, character_block: null };
  const meta = (first.metadata || {}) as any;
  return {
    scene_block: meta.scene_block || null,
    character_block: meta.character_block || null,
  };
}

function buildUserPrompt(
  input: TalkingObjectInput,
  series: { scene_block: string | null; character_block: string | null }
): string {
  const lines = [
    `object: ${input.object}`,
    `objective: ${input.objective}`,
    `language: ${input.language}`,
    `purpose: ${input.purpose || "general — pick a sensible scene"}`,
    `mode: ${input.mode}`,
  ];
  if (input.customDialog && input.customDialog.trim()) {
    lines.push(
      "",
      "custom_dialog (USE EXACTLY — do not rephrase or translate):",
      input.customDialog.trim()
    );
  }
  if (input.customTarget && input.customTarget.trim()) {
    lines.push(
      "",
      "custom_target (USE VERBATIM as the core of scene_block — extend with texture/lighting only, do NOT change the location):",
      input.customTarget.trim()
    );
  }
  // Series scene reuse only kicks in when the user did NOT specify a custom
  // target — otherwise the user's explicit target wins over series continuity.
  if (series.scene_block && !(input.customTarget && input.customTarget.trim())) {
    lines.push(
      "",
      "existing_scene_block (REUSE VERBATIM in your output's scene_block):",
      series.scene_block
    );
  }
  if (series.character_block) {
    lines.push(
      "",
      "existing_character_block (consider reusing if same object; otherwise generate fresh):",
      series.character_block
    );
  }
  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// Defensive: walks a JSON-ish string and escapes raw control chars (LF /
// CR / TAB) that appear INSIDE "..." string literals. Outside string
// literals control chars are valid JSON whitespace, so they're left
// alone. Handles backslash-escaping correctly so \" inside strings
// doesn't fool the parser.
// ──────────────────────────────────────────────────────────────────────────
function sanitizeJsonControlChars(input: string): string {
  let out = "";
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inString) {
      if (escapeNext) {
        out += c;
        escapeNext = false;
        continue;
      }
      if (c === "\\") {
        out += c;
        escapeNext = true;
        continue;
      }
      if (c === '"') {
        out += c;
        inString = false;
        continue;
      }
      if (c === "\n") { out += "\\n"; continue; }
      if (c === "\r") { out += "\\r"; continue; }
      if (c === "\t") { out += "\\t"; continue; }
      out += c;
    } else {
      if (c === '"') {
        inString = true;
      }
      out += c;
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Public entrypoint — runs OpenRouter, parses + validates JSON, returns
// the structured output. Throws on parse / validation failure.
// ──────────────────────────────────────────────────────────────────────────
export async function generateTalkingObjectPrompts(
  input: TalkingObjectInput
): Promise<TalkingObjectOutput> {
  if (!input.object?.trim()) throw new Error("object required");
  if (!["benefit", "complaint", "cons"].includes(input.objective)) {
    throw new Error("objective must be benefit | complaint | cons");
  }
  if (!["ms", "en"].includes(input.language)) {
    throw new Error("language must be ms | en");
  }

  const series = await fetchProjectSeriesContext(input.projectId);
  const userPrompt = buildUserPrompt(input, series);

  const r = await orChat({
    modelKey: "model_auto",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.85, // creativity + consistency balance
    maxTokens: 1200,   // ~900 input + ~300 output budget
  });
  if (!r.ok || !r.content) {
    throw new Error(`OpenRouter call failed: ${r.error || "no content"}`);
  }

  // Strip any markdown fences the model might have wrapped (some models
  // ignore "no fences" instruction). Then parse.
  const cleaned = r.content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  // Defensive control-char sanitizer. LLMs occasionally output literal
  // newlines / tabs inside JSON string values, which is invalid JSON.
  // Walk the string tracking whether we're inside a "..." literal and
  // escape \n / \r / \t when we are. Outside strings, control chars are
  // valid JSON whitespace so we leave them.
  const sanitized = sanitizeJsonControlChars(cleaned);

  let parsed: any;
  try {
    parsed = JSON.parse(sanitized);
  } catch (e: any) {
    throw new Error(
      `LLM returned non-JSON (parse error: ${e?.message}): ${sanitized.slice(
        0,
        200
      )}`
    );
  }

  // Schema validation — all 6 fields, all strings, language echo correct
  for (const field of [
    "image_prompt",
    "video_prompt",
    "dialog_line",
    "scene_block",
    "character_block",
    "language",
  ]) {
    if (typeof parsed[field] !== "string" || !parsed[field].trim()) {
      throw new Error(`LLM JSON missing or empty field: ${field}`);
    }
  }
  if (parsed.language !== input.language) {
    // Soft-correct rather than throw — language echo is informational,
    // the dialog_line is what matters and it'll be checked next.
    parsed.language = input.language;
  }

  // Guard the BM banned-token rule. If language=ms and any banned token
  // appears in dialog_line, reject so caller can surface a clean error.
  if (input.language === "ms") {
    const banned = [
      "kalian", "gue", "gua", " lo ", " lu ", "banget", "sih ", "dong",
      "nggak", "bisa", "udah", "aja", "kok", "deh", "kalo", "bgt",
      "kayak", "gimana", "ngapain", "nih", "tuh",
    ];
    const lower = " " + (parsed.dialog_line as string).toLowerCase() + " ";
    for (const b of banned) {
      if (lower.includes(b.toLowerCase())) {
        throw new Error(
          `BM dialog leaked Indonesian token "${b.trim()}" — regenerate`
        );
      }
    }
  }

  return parsed as TalkingObjectOutput;
}
