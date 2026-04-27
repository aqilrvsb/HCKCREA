import type { Skill } from "../../types";

export const ctaSaveTrigger: Skill = {
  id: "save-trigger",
  kind: "cta",
  tab: "ugc",
  title: "Save Trigger CTA (TOFU Engagement)",
  triggers: ["save", "bookmark", "save video", "tofu", "cold traffic", "top of funnel", "reminder", "refer back"],
  body: `# Save Trigger CTA

**Pattern:** Ask viewer to save the video for future reference — positions content as valuable information worth keeping, not an ad worth skipping.

**Psychology (Cialdini — Commitment & Consistency + Reciprocity):** Save = the highest-value signal on TikTok's algorithm (beats likes and follows in reach weighting). For the viewer, saving creates a mental bookmark that pulls them back — 60%+ of purchasers save before buying. Framing it as "you'll thank yourself later" pre-loads anticipated gratitude.

## CTA phrase library (10 BM/EN verified active 2025-26)
1. "Save video ni dulu, lepas ni korang akan thank yourself."
2. "Tekan save — ni info yang korang tak boleh scroll past."
3. "Save this, come back bila dah ready nak try."
4. "Simpan dulu, share ngan member korang yang sama problem."
5. "Save je dulu kalau belum ready — tapi jangan lupa balik."
6. "Press save sebelum korang scroll lagi — guaranteed korang cari balik."
7. "Ni tips aku, save for later bila korang nak start routine."
8. "Save this video — korang boleh refer balik cara pakai."
9. "Bookmark ni, esok korang tengok balik and baru faham kenapa."
10. "Kalau korang nak ingat product ni, save je sekarang."

## Beat math (last 2-3s of video)
- Word count: 8-14 BM words
- Delivery: warm, slightly knowing — "I'm doing you a favour"
- Visual: creator taps upward on phone screen, mimicking the save gesture
- Timing: "save" word at second 1, reason/payoff at second 2 — lean into the reason

## Pairs best with
- Hooks: Educational opener, Tips/Hacks format
- Frameworks: Educational Tutorial, How-It-Works explainer
- Personas: Educational Expert, Urban Hijabi Bestie, Casual Bestie
- Funnel stage: TOFU — ideal for cold traffic; primes future purchase without pressuring

## Pitfalls
- NEVER use save trigger as a replacement for beg kuning on BOFU content — wastes hot intent
- AVOID pairing with urgency/scarcity CTA in same video — mixed signals kill one message
- AVOID "don't forget to save!" — feels like a YouTube trope, not TikTok-native

## Veo prompt insertion
Place in dialog field for final 2-3s:
"She taps upward on her phone and says: 'Save video ni dulu, lepas ni korang akan thank yourself.' — warm, slightly conspiratorial smile, like sharing a secret tip."
`,
};
