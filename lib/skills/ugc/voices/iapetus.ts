import type { Skill } from "../../types";

export const voiceIapetus: Skill = {
  id: "iapetus",
  kind: "voice",
  tab: "ugc",
  title: "Voice: Iapetus — Female, Young, Upbeat, Gen-Z Energy",
  triggers: ["iapetus", "female", "young", "upbeat", "gen z", "genz", "bubbly", "cheerful", "bright", "enthusiastic female"],
  body: `# Voice: Iapetus

## Character archetype
Female. Young, upbeat, bright — the vocal fingerprint of Gen-Z creator culture. Not performatively chipper, but genuinely high-energy in a way that feels like a voice note to a best friend. Laughs mid-sentence naturally. Pitch rises at the end of statements (uptalk) as a trust signal, not an uncertainty marker. Age read: 19-27. The voice that makes "okay so listen" feel like an invitation.

## Best persona pairings
- \`casual-bestie\` — canonical match. Youth upbeat energy is the entire delivery mechanism.
- \`urban-hijabi-bestie\` — secondary match for the younger (22-26) end of the hijabi bestie spectrum.
- \`comedic-foodie\` — female version; bright excited delivery works for taste reaction content.

## Best scene pairings
- Bedroom direct-to-cam (casual, fast, unfiltered)
- "I found this and I'm obsessed" product discovery
- Getting-ready voice-note style GRWM
- TikTok shop product drop first-look
- Night routine wind-down (even low-energy iapetus is still upbeat relative to achernar)
- Comment reply / "you asked, I answered" format

## Sample BM-EN dialog (3 lines)
1. "Okay so aku KENA cakap ni sekarang sebab kalau tak cakap aku rasa nak burst."
2. "Serious — dah seminggu aku guna and my skin has never looked like this? Like ever?"
3. "Link bio, grab, thank me later. Dah. Bye. Pergi grab."

## Voice direction line (inject verbatim into Veo prompts)
"Voice direction: Iapetus — female, young, upbeat Gen-Z energy, naturally bright pitch, warm enthusiasm, slight uptalk, laughs naturally mid-sentence, fast conversational pacing."

## Pairings to AVOID
- \`mak-cik-converter\` — persona and voice mismatch; youthful energy erases mak cik authority entirely.
- \`educational-expert\` — upbeat delivery undermines scientific authority; credibility requires a grounded voice.
- \`confessional-intimate\` — vulnerability space requires softness (achernar); iapetus is too present and energetic.
- \`pious-religious-tone\` — Gen-Z upbeat energy clashes with sincere faith grounding; enceladus owns that space.
- \`product-whisperer\` — ASMR and upbeat are incompatible; even quiet iapetus disrupts sensory calm.
`,
};
