import type { Skill } from "../../types";

export const sceneCommentResponse: Skill = {
  id: "comment-response",
  kind: "scene",
  tab: "ugc",
  title: "Comment Response — Reply to Skeptic Comment with Video Proof",
  triggers: ["comment response", "reply", "skeptic", "doubt", "proof", "addressing comments", "haters", "question reply", "debunking"],
  body: `# Comment Response Scene

**Best for:** any product facing skepticism, high-ticket items needing trust-building, supplements with health claims, skincare results, weight management — format works when product needs to overcome objection.
**Best persona:** skeptic-converted, confessional-intimate, educational-expert.
**Best voice:** callirrhoe (female mid neutral), achird (male warm), charon (male deep auth).

## Setting block (paste into prompt body)
"Same bedroom, office, or kitchen setting as prior content — continuity builds that this is a real ongoing series. Creator faces camera directly. TikTok comment sticker graphic overlaid at top of frame showing the skeptic comment. Creator reads it aloud, then responds with proof/demonstration."

## Camera + framing
- Static medium close-up on tripod — consistent with prior content. Creator full focus, no distraction.
- Comment sticker graphic in upper third (standard TikTok reply-to-comment format).
- Optional: split screen or picture-in-picture showing "evidence" (product, skin, receipt, bottle).
- 9:16 vertical. 35mm. Slight lean toward camera during proof moment = engagement signal.

## Lighting
"Match lighting of prior content for continuity. Default: window diffuse or soft LED panel. Clean, clear face lighting — no dramatic shadows. Creator must look credible, not defensive."

## Action beats (8s)
- 0–2s: Comment sticker shown. Creator reads comment aloud (OR title card displays it). Hook: reacting to the comment with a knowing expression.
- 2–5s: Creator addresses the skepticism directly — shows proof (product, result, receipt, usage). Specific, factual, not emotional.
- 5–7s: Evidence moment — holds up product, shows skin close-up, reads ingredient, shows packaging. Undeniable detail.
- 7–8s: Creator faces camera, relaxed confidence (not aggressive). Closing statement. CTA as invitation.

## Dialog patterns (Malay/EN code-switch)
**Hook (0-2s, reading/reacting to comment):**
- "Ada orang komen: '[SKEPTIC COMMENT]' — okay aku nak jawab ni."
- "Comment ni memang aku expect — jom aku buktikan."
- "Korang tengok ni — [reads comment] — fair question, tapi tengok dulu."

**Core (2-5s, addressing doubt):**
- "Aku pun dulu skeptikal — tapi aku dah guna 6 minggu, hasil dia confirmed real."
- "Ingredients dia? Tunggu — [shows label] — korang boleh check sendiri, halal, no hidden nasty stuff."
- "Harga dia memang sikit mahal dari drug store brand — tapi quality dia? Beza langit dan bumi."

**Outro (7-8s):**
- "Tu je aku nak cakap. Tekan beg kuning kalau korang dah convinced."
- "Tak puas hati lagi? Komen lagi — aku jawab lagi. Tapi cuba dulu."
- "Korang yang dah try, confirm kat comment section — back me up!"

## Audio (5-layer)
- Dialogue: ONE speaker — measured, confident, not defensive. Never aggressive. Explanatory tone.
- SFX: "comment notification ping (on comment card appear), product label flip, packaging crinkle on evidence reveal".
- Ambience: "same room tone as persona's consistent setting — bedroom/office/kitchen ambient".
- Music: none, or −22dB ambient music ghost (keeps attention on creator authority).
- Negatives: "no aggressive music, no dramatic 'gotcha' sting, no audience reaction sound".

## Veo prompt skeleton
"Static medium close-up, 35mm, tripod. <PERSONA_DESCRIPTOR> faces camera directly. TikTok comment sticker graphic in upper frame. Creator reads comment, expression: knowing calm. Holds up <PRODUCT>, turns label toward camera — points to specific detail. Slight forward lean during evidence. He/She says: '<HOOK_LINE>'. Soft window diffuse or LED panel, clean face lighting. SFX: notification ping, label flip. Ambience: consistent room tone. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes + fixes
- Creator looks defensive/angry → "expression: calm authority, slight knowing smile — not reactive, not aggressive".
- Proof not visible → "label held STILL for 2 full seconds at 30cm from camera — text must be legible".
- Comment feels planted → use real language: "actual TikTok comment phrasing, typos included — 'betul ke ni? macam tipu je'".
- Closing too weak → end with community call-out: "tag someone yang perlu tengok video ni" — drives share + comment.
- Ingredient proof too fast → "zoom into ingredient panel, hold 3 seconds — let viewer read key ingredient".

## Persona + voice fit
- **skeptic-converted** + callirrhoe: creator was once the skeptic — highest authenticity, "I asked the same question".
- **educational-expert** + achird: authoritative explanation mode — for ingredient/science-based responses.
- **confessional-intimate** + charon: male creator addressing doubters calmly — unusual format, high retention.

## Cultural notes
- Comment response format = TikTok algorithm gold — TikTok pushes "reply to comment" videos to the original commenters audience. Dramatically increases reach.
- Malaysian skeptic archetypes to address: "mahal sangat", "halal ke", "betul ke berkesan", "mesti ada side effects", "macam MLM je".
- Always address the halal question if relevant — "halal cert ada, kat beg kuning boleh tengok" is the script.
- Avoid naming/shaming the specific commenter — read the comment but do not tag or call out the username publicly.
- KKM/KKLIU compliance: if making health claim responses, add "berdasarkan pengalaman peribadi" disclaimer — avoids regulatory risk.
`,
};
