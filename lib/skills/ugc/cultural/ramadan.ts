import type { Skill } from "../../types";

export const culturalRamadan: Skill = {
  id: "ramadan",
  kind: "cultural",
  tab: "ugc",
  title: "Ramadan Content Rules",
  triggers: ["ramadan", "puasa", "sahur", "berbuka", "iftar", "fasting", "bulan puasa", "terawih", "ramadhan"],
  body: `# Ramadan Content Rules — Cultural Guardrail

## When to fetch
Fetch whenever user mentions: "ramadan", "puasa", "sahur", "berbuka", "iftar", "bulan ramadan", "fasting month", or when the current date falls within the Islamic Ramadan calendar window.

## Agent pivot rule
**If user requests mukbang / eating content during Ramadan daylight hours (Subuh to Maghrib):** Do NOT generate. Instead propose:
> "Ramadan daylight eating content may alienate fasting Muslim viewers — propose berbuka (iftar) framing instead: same product, same energy, timed at Maghrib/sunset. Shall I reframe for berbuka?"

**If user requests alcohol-adjacent content or music with explicit lyrics during Ramadan:** Redirect immediately.
> "This content type conflicts with Ramadan audience sensitivities — recommend pausing until after Raya or reframing for spiritual-wellness positioning."

## Hard avoids
- **No daylight mukbang or eating scenes** (Subuh to Maghrib) — deeply offensive to fasting audience
- **No music with explicit or romantic lyrics** during Ramadan content — even as background
- **No non-mahram physical contact** between male and female creators — always sensitive but especially during Ramadan
- **No alcohol or alcohol-adjacent imagery** (glasses that look like wine, bar settings, cocktail colours)
- **No complaint framing** ("penat puasa", "mati kebuluran") — disrespects the ibadah dimension of fasting
- **No forced sales urgency** during tarawih hours (approx. 8pm-10pm) — audience is in spiritual mode

## Safe content windows (Ramadan calendar)
- **Sahur (3am-5am)**: food prep, energy supplements, skincare for early risers, productivity tools
- **Berbuka / Iftar (Maghrib, ~7pm-8pm)**: highest engagement window. Food, drinks, date-based products, family moments.
- **Post-Terawih (10pm-midnight)**: lifestyle, skincare routines, wellness, light shopping. Second-peak engagement.
- **Non-food brands** (skincare, fashion, home): run all day, no timing restrictions.

## Safe content patterns that convert during Ramadan
1. **Berbuka preparation framing**: "Ni yang aku prep untuk berbuka harini — [product]. Senang, cepat, sedap."
2. **Sahur energy framing**: "Untuk korang yang bangun sahur — supplement ni bagi aku energy tahan sampai berbuka."
3. **Spiritual wellness angle**: "Bulan ni aku nak jaga diri lagi baik — kulit, dalaman, semua." (works for skincare, supplements, health)
4. **Raya prep pivot**: "Dah masuk minggu ke-2 Ramadan, aku dah start prep kulit untuk Raya." (bridges Ramadan → Raya purchase funnel)
5. **Tadarus / calm aesthetic**: slow-paced content, warm amber lighting, quran recitation ambience (if no lyrics/words).

## Festive timing windows
- Ramadan 1-10: spiritual focus, softer content, trust-building
- Ramadan 11-20: Raya prep content begins, fashion/skincare/gifting spike
- Ramadan 21-30 (Lailatul Qadr period): reduce hard-sell. Spiritual tone. Brand recall > conversion.
- Eid ul-Fitr Day 1-7: Raya content takes over (see raya-season.ts)

## Sample dialog adjustments
- Berbuka: "Alhamdulillah, masa berbuka tadi aku try [product] — rasa dia subhanallah."
- Sahur: "Pagi tadi sahur, aku minum ni dulu sebelum imsak — bagi energy tahan sampai berbuka."
- Raya pivot from Ramadan: "Dah 2 minggu Ramadan — aku dah start skincare routine untuk Raya. Korang dah start belum?"

## Halal handling during Ramadan
All standard halal locks apply. Additionally: any food/drink product must explicitly confirm "boleh makan/minum waktu berbuka" framing — do not leave ambiguity about consumption timing.
`,
};
