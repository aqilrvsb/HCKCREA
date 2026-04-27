import type { Skill } from "../../types";

export const hookHandRaise: Skill = {
  id: "hand-raise",
  kind: "hook",
  tab: "ugc",
  title: "Hand-Raise Hook (Audience Identification)",
  triggers: ["hand raise", "sapa", "who else", "raise your hand", "pernah", "relate", "same", "audience identification", "comment if"],
  body: `# Hand-Raise Hook

**Pattern:** "Sapa pernah cry kat kereta sebab kulit teruk?" — asks a direct question that invites self-identification. The viewer either raises their hand (mentally/literally) or doesn't — those who do are perfectly qualified leads.
**Why it works:** The question format triggers an automatic internal response. Viewers who answer "yes" feel immediately understood. This creates a micro-commitment before the product is introduced. Comment rates spike because the hook is literally asking for a response.

## Hook phrase library (verified active 2025-26)
1. "Sapa pernah cry kat kereta sebab jerawat buat rasa tak confident nak keluar?"
2. "Sapa spend RM300+ kat skincare tapi still tak nampak result — comment 'I' bawah."
3. "Siapa yang dah give up nak ada kulit cerah? Sebab aku pernah kat tempat tu."
4. "Sapa yang setiap bulan breakout teruk masa period? Ni untuk korang."
5. "Who else pakai foundation tebal sebab tak confident tunjuk bare face?"
6. "Sapa yang kulit sensitive sampai tak boleh cuba produk baru? Same here."
7. "Korang pernah tak — dah buat everything right tapi kulit still hopeless?"
8. "Raise your hand kalau korang rasa skincare routine korang tak best tapi korang malas nak tukar."
9. "Sapa yang ada problem ni tapi tak pernah jumpa solution yang actually kerja?"

## Beat math (first 2s only)
- Word count: 7-12 words — "sapa/who" spoken at 0s, specific situation described by 2s
- Delivery: inclusive, warm tone — speaker is asking a friend, not conducting a survey
- Visual: speaker raises own hand or gestures inclusively; direct gaze invites viewer participation

## Structural rules
- ALWAYS be specific enough that only the target audience raises their hand — avoid "sapa rasa tak puas hati?"
- ALWAYS follow the hand-raise with "ni untuk korang" or equivalent empathy bridge
- NEVER make the situation so extreme it becomes unrelatable ("sapa pernah hospitalised sebab jerawat")
- ALWAYS add a comment CTA at end ("comment 'I' kalau sama") — hand-raise hook + comment CTA = engagement flywheel

## Pairs best with
- Frameworks: SSS (Star-Story-Solution), PAS, BAB-Extended, COI
- Personas: Inspirational Soft, Confessional Intimate, Casual Bestie
- Scenes: Confession Storytime, Bedroom soft-light, Emotional B-roll

## Pitfalls
- AVOID questions that feel like surveys ("korang prefer morning or night routine?") — no pain, no hook
- AVOID asking for hand-raises on things people would be embarrassed to admit publicly
- AVOID the hand-raise without delivering a genuine solution — it becomes emotional manipulation
- AVOID phrasing that alienates non-qualifiers ("kalau korang still ada acne") — frame as past tense ("pernah")

## Veo prompt insertion
Speaker raises own hand or points at camera warmly. Example:
"She raises her hand to camera, warm smile, says: 'Sapa pernah cry kat kereta sebab jerawat buat rasa tak confident nak keluar?' Then drops hand and shifts to earnest expression."
`,
};
