import type { Skill } from "../../types";

export const voiceGacrux: Skill = {
  id: "gacrux",
  kind: "voice",
  tab: "ugc",
  title: "Voice: Gacrux — Male, Energetic, Excited, Hype",
  triggers: ["gacrux", "male", "energetic", "excited", "hype", "loud", "reaction", "high energy", "enthusiastic", "foodie", "comedy"],
  body: `# Voice: Gacrux

## Character archetype
Male. High energy, excited, forward-leaning. The voice that sounds like it just discovered something and physically cannot contain the information. Not fake — this is the voice of someone who is GENUINELY excited and doesn't regulate it for politeness. Age read: 20-32. Dynamic range: can go from normal to peak within one sentence. Pattern interrupts (sudden volume drop, deadpan aside) land perfectly in this voice because the contrast is so sharp.

## Best persona pairings
- \`comedic-foodie\` — canonical match. Hype + comedy = this voice's home territory.
- \`gym-bro\` — secondary match for hype-energy fitness content (pre-workout, competition prep).
- \`casual-bestie\` — male version at peak energy (product discovery, excited sharing).

## Best scene pairings
- First-bite taste reaction (comedic foodie format)
- "I tried this and I cannot calm down" unboxing
- Product ranking / elimination challenge
- Post-workout supplement reveal (high-pump energy)
- Food haul reaction (multiple products in one session)
- Pattern interrupt deadpan moment ("Wait. Jap. Korang dengar ni dulu.")

## Sample BM-EN dialog (3 lines)
1. "WEHHHH — korang tunggu. Aku baru je try ni and I genuinely cannot explain kenapa takde orang cakap lagi."
2. "Okay. [sudden deadpan] Serious ah. Aku dah order sebulan terus. Lepas tu boleh excited balik."
3. "Link dalam bio, pergi grab SEKARANG. Stok dia selalu habis — aku dah kena sekali."

## Voice direction line (inject verbatim into Veo prompts)
"Voice direction: Gacrux — male, high energy, excited hype delivery, dynamic volume range, enthusiastic but genuine, capable of sharp pattern-interrupt deadpan drop."

## Pairings to AVOID
- \`confessional-intimate\` — hype energy completely destroys the vulnerability container.
- \`product-whisperer\` — ASMR and hype are polar opposites. Never combine.
- \`inspirational-soft\` — emotional uplift needs soft warmth; gacrux's energy reads as manic next to inspirational content.
- \`educational-expert\` — authority requires composure; hype energy undermines scientific credibility.
- \`mak-cik-converter\` — persona mismatch and voice register mismatch simultaneously.
`,
};
