import type { Skill } from "../../types";

export const culturalCodeSwitch: Skill = {
  id: "code-switch",
  kind: "cultural",
  tab: "ugc",
  title: "Code-Switch — BM/EN/Mandarin Density Rules per Persona",
  triggers: ["code switch", "bahasa melayu", "manglish", "bm", "mandarin", "chinese", "language mix", "slang", "persona language", "dialect"],
  body: `# Code-Switch — Language Density Rules per Persona

## When to fetch
Fetch when: user specifies a persona, audience demographic involves Chinese-Malaysian or Indian-Malaysian segments, user asks for dialect-specific content, or agent needs to calibrate language mix for a script.

## Language density per persona (FIRM rules — do not deviate without explicit user override)

| Persona | BM | EN | Mandarin | Notes |
|---|---|---|---|---|
| Mak Cik / Auntie | 90% | 10% | 0% | Formal BM preferred. Simple EN only for product terms. |
| Hijabi Bestie | 65% | 30% | 0% | BM dominant, EN for beauty/skincare terms naturally. |
| Chinese-MY (Urban) | 40% | 35% | 25% | Mandarin in parenthetical or exclamatory. EN for tech/beauty terms. |
| Casual Bestie | 60% | 40% | 0% | Natural Manglish. Code-switch mid-sentence is correct and expected. |
| Educational Expert | 50% | 50% | 0% | Technical/clinical terms stay in EN. Explanations in BM. |

## Active slang dictionary (verified 2025-26 — USE these, not dead phrases)

### Address / pronouns
- **korang** — you all (plural, casual, universal)
- **aku** — I (casual, first person, all genders)
- **akak / kak** — older female address (Hijabi Bestie, Mak Cik personas)
- **mak cik** — auntie (respectful term, Mak Cik persona self-reference)
- **abang / bang** — older male (for male personas; rare in skincare UGC)

### Intensifiers
- **gila** — insane/extremely (gila lembut, gila sedap) — universal
- **memang** — truly/exactly (memang berkesan, memang confirm) — universal
- **confirm** — definitely (confirm reorder, confirm okay) — Universal BM-EN hybrid
- **betul-betul** — really/truly — slightly formal, universal
- **padu** — solid/excellent — Gen-Z, urban
- **gempak** — awesome — slightly older Gen-Z
- **terbaik** — best / top tier — universal
- **syok** — enjoyable/feels good — Malaysian-universal (all ethnicities)

### Reactions
- **pergh** — wow/damn (positive surprise) — most versatile Malaysian exclamation
- **fuyoh** — whoa (Chinese-MY origin, now universal)
- **mantap** — solid/impressive — Malay-dominant
- **layan** — worth it / enjoying it — universal

### Conversational particles (these make dialog sound native)
- **kan** — right? / isn't it? — universal tag question
- **tau** — you know / right — softer than "kan"
- **jap** — wait a moment (jap, nak tunjuk cara pakai dia)
- **eh** — hey / softener (eh korang, eh serious ni)
- **lah** — softener / emphasis (memang okay lah, beli je lah)
- **meh** — come / invitation (cuba meh, grab meh)
- **nampak tak** — see it or not? / can you see? — rhetorical

### Shopping / commerce terms (always EN even in BM-heavy scripts)
- **grab** — purchase / buy now (universal TikTok commerce verb)
- **checkout** — complete purchase
- **restock** — restocking
- **stok** — stock / inventory
- **order** — place order
- **repeat order** — reorder (extremely powerful social proof signal)

## Dead phrases — NEVER use (overused, trust-killing)
- "Hi guys! Harini aku nak review..." — YouTube-era opener, alien on TikTok
- "Assalamualaikum dan selamat sejahtera kepada semua..." — formal TV news opening
- "Produk ni memang game changer!" — overused to meaninglessness
- "Aku nak share dengan korang tentang produk yang amazing ini" — textbook corporate-speak
- "Jangan lupa like, share, and subscribe!" — YouTube 2015 energy
- Excessive hashtag stuffing (30 hashtags = algorithm spam signal, not a boost)
- "Percayalah!" without supporting evidence — desperation signal

## Mandarin integration (Chinese-MY persona)
- Exclamatory: "这个真的很好用 (ni memang bagus)" — BM confirmation follows Mandarin claim
- Product category terms can stay in Mandarin: 美白 (whitening), 保湿 (moisturizing)
- Call-to-action stays in BM or EN: "Grab sekarang" / "Tap beg kuning"
- NEVER phonetic Mandarin romanization in BM scripts — use actual Mandarin characters or leave it out

## Manglish syntax rules (Casual Bestie / Chinese-MY)
- Subject-verb inversion: "Best gila this moisturizer" — correct
- EN adjective + BM noun: "Smooth gila kulit dia" — correct
- Mid-sentence switch: "Aku dah try macam-macam brands but this one actually works" — correct
- Particle at sentence end: "You should try this lah" / "Memang berbaloi kan?" — correct
`,
};
