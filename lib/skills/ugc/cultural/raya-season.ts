import type { Skill } from "../../types";

export const culturalRayaSeason: Skill = {
  id: "raya-season",
  kind: "cultural",
  tab: "ugc",
  title: "Raya Season Content (Eid ul-Fitr Prep & Celebration)",
  triggers: ["raya", "hari raya", "aidilfitri", "eid", "raya prep", "baju raya", "raya gift", "raya sale", "lebaran", "syawal"],
  body: `# Raya Season Content — Cultural Guardrail

## When to fetch
Fetch whenever user mentions: "raya", "hari raya", "aidilfitri", "eid", "raya prep", "baju raya", "kuih raya", "raya gift set", "syawal", or when date is within the 30-day pre-Raya window (approx. Ramadan weeks 2-4) or the first 2 weeks of Syawal.

## The 30-day prep window (HIGHEST CONVERSION PERIOD)
- **Weeks 1-2 of Ramadan**: subtle "awal prep" messaging. Early adopters. Fashion/skincare/home.
- **Weeks 3-4 of Ramadan**: full Raya prep mode. Fashion, skincare, food gift sets, home decor, kuih.
- **Raya Day 1-7 (Syawal 1-7)**: peak celebration content. Experience-sharing, gifting, outfit reveals.
- **Raya 2025 saw 100% YoY festival content sales growth** — biggest Malaysian TikTok commerce event of the year.

## High-converting Raya content categories
1. **Fashion / Baju Raya**: new collection drops, mix-and-match tutorials, modest fashion, family matching sets
2. **Skincare / Raya Glow**: "raya ready skin" prep (30 days → 14 days → 7 days countdown format)
3. **Food gift sets / kuih**: hamper unboxing, kuih raya haul, biskut raya reviews
4. **Home decor**: minimalist Raya deco, rumah terbuka prep, pelita and ketupat decor
5. **Supplement / health**: fasting + Raya feasting health maintenance, collagen for Raya glow

## Hard avoids
- **Never show non-halal food** in a Raya spread — background plate, props, everything in frame matters
- **Never show immodest clothing** in Raya fashion content (bare shoulders, short hem, body-con on hijabi creator)
- **Never use generic Western festive aesthetics** (christmas colours, generic "celebration") — Raya has its own palette (hijau, emas, merah hati, krem)
- **Never play non-Malay/non-Islamic festive music** in Raya content
- **Never do hard aggressive urgency** on Raya content — the emotional register is warm, celebratory, grateful. Scarcity OK; panic urgency kills the Raya mood.

## Safe patterns that convert
1. **Countdown format**: "14 hari lagi Raya — korang dah start prep kulit belum?"
2. **Family gift framing**: "Nak bagi gift yang bermakna untuk mak — ni yang aku pilih."
3. **Outfit reveal**: Creator shows baju raya with product used to achieve the glow look.
4. **Raya hamper / haul**: unboxing gift sets, showing product inside hamper.
5. **Rumah terbuka prep**: "Prep awal untuk rumah terbuka — ni yang aku stok."
6. **Nostalgic angle**: "Raya dulu aku malu nak jumpa sedara — kulit tak sehat. Raya ni lain."

## Festive timing windows
- **Ramadan Week 2-4**: peak buying intent for Raya prep (fashion, skincare, gifts)
- **Raya Eve (Syawal 1)**: last-minute emotional purchases, family sharing content
- **Raya Day 1-3**: experience sharing, outfit/gift reveal content (high engagement, lower conversion)
- **Raya Day 4-14**: second wave conversion ("dah settled, now restock / try new things")

## Visual / aesthetic notes for Veo
- Colour palette: sage green, warm gold, cream/ivory, deep maroon — avoid harsh primary colours
- Setting: clean Malaysian home interior, ketupat/pelita props in background, modest natural light
- Outfit: baju kurung / baju Melayu / modern modest fashion — always covered, elegant
- Veo prompt addition: "Warm home setting with Raya decor (pelita, ketupat), creator in baju kurung, soft warm light, celebratory but calm mood."

## Sample dialog adjustments
- Prep: "Dah masuk minggu ke-3 Ramadan — aku dah start Raya prep. Kulit kena ready awal."
- Gift: "Untuk hamper Raya tahun ni, aku pilih ni — sebab family aku memang suka."
- Post-Raya: "Raya baru je lepas, tapi kulit aku still glow — ni sebabnya."
`,
};
