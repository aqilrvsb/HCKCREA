import type { Skill } from "../../types";

export const hookFomoSocialProof: Skill = {
  id: "fomo-social-proof",
  kind: "hook",
  tab: "ugc",
  title: "FOMO / Social Proof Hook (Bandwagon & Fear of Missing Out)",
  triggers: ["fomo", "social proof", "viral", "everyone", "ramai", "dah try", "trending", "fyp", "ketinggalan", "bandwagon", "popular"],
  body: `# FOMO / Social Proof Hook

**Pattern:** "Ramai dah try, aku je ketinggalan ke?" / "Dah viral kat FYP" — opens by establishing that the crowd has already moved, positioning the viewer as potentially behind. Triggers belonging need and FOMO simultaneously.
**Why it works:** Social proof is Cialdini's most powerful principle in digital context. When the viewer sees themselves as an outlier in a crowd that's already discovered something, the cost of NOT watching becomes social. "Viral kat FYP" is a culturally specific trust signal for Malaysian TikTok viewers.

## Hook phrase library (verified active 2025-26)
1. "Ramai dah try ni, aku je yang ketinggalan ke?"
2. "Dah viral kat FYP tapi aku baru je jumpa — korang dah try?"
3. "TikTok Shop dah habis jual 3 kali. Aku finally dapat stok."
4. "47K orang dah cuba ni. Aku test untuk tengok hype tu betul ke tak."
5. "Semua orang dalam circle aku dah pakai. Aku je yang skeptical sampai try sendiri."
6. "Kalau korang tengok FYP minggu lepas mesti dah nampak ni. Ni pendapat aku."
7. "Sebab ni trending sampai dermatologist pun buat video pasal dia — aku kena cuba."
8. "Sold out berkali-kali. Aku tunggu restock sebulan. Worth it ke? Ni jawapan aku."
9. "Group skincare aku kecoh pasal ni. 200 orang dah order. Aku last sekali."
10. "Bila stranger kat kedai tanya aku pakai apa, aku tahu dah mainstream."

## Beat math (first 2s only)
- Word count: 7-11 words — crowd established by 1s, viewer's out-of-the-loop position by 2s
- Delivery: casual, slightly wondering tone ("aku je ketinggalan ke?") — not salesy
- Visual: implied crowd (montage of comments/reviews) or speaker with product others want

## Structural rules
- ALWAYS make the social proof specific and verifiable (number, platform, community)
- ALWAYS position the SPEAKER as a late adopter or fellow discoverer — not a promoter
- NEVER fabricate social proof numbers that can be verified and disproven
- ALWAYS deliver an honest opinion after establishing the social proof — not just endorsement

## Pairs best with
- Frameworks: RDR (Reaction-Discovery-Recommend), COV (Conversation Overheard), DRR, AIDA
- Personas: Casual Bestie, Skeptic-Converted, Urban Hijabi Bestie
- Scenes: Unboxing haul, Community screenshot B-roll, Group chat reaction

## Pitfalls
- AVOID fabricating viral claims that are unverifiable — kills trust when disproven
- AVOID using FOMO hook for niche products with genuinely small audiences (incongruent)
- AVOID making the FOMO so aggressive it reads as pressure ("korang MESTI try ni") — too salesy
- AVOID using "viral" without adding personal perspective — FOMO needs a human gateway

## Veo prompt insertion
Show screenshot or comment overlay briefly then speaker's reaction. Example:
"Quick flash of TikTok comments/reviews at 0s, then she looks at camera: 'Ramai dah try ni, aku je yang ketinggalan ke?' Casual expression, natural lighting."
`,
};
