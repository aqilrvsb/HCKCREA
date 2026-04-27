import type { Skill } from "../../types";

export const ctaShareTrigger: Skill = {
  id: "share-trigger",
  kind: "cta",
  tab: "ugc",
  title: "Share Trigger CTA (Viral Amplification)",
  triggers: ["share", "send to friend", "tag someone", "viral", "forward", "sister", "bestie", "tofu amplification"],
  body: `# Share Trigger CTA

**Pattern:** Instruct viewer to share or tag a specific person who has the same problem — converts passive viewers into distribution nodes by making the share feel like an act of care, not promotion.

**Psychology (Cialdini — Social Proof + Liking):** Sharing feels selfless when framed as "help your friend." It removes the awkwardness of forwarding content because the CTA does the work of explaining why. TikTok's share metric also boosts distribution to that second audience, creating compound TOFU reach for free.

## CTA phrase library (10 BM/EN verified active 2025-26)
1. "Send dekat sister korang yang penat dengan jerawat."
2. "Tag member korang yang selalu complaint kulit kusam."
3. "Forward ni ke group chat keluarga — ada sorang tu yang perlukan ni."
4. "Kalau ada kawan yang sama struggle, share je video ni."
5. "Tag satu orang dekat bawah yang korang rasa perlu tengok ni."
6. "Share ngan BFF korang yang baru start skincare journey."
7. "Simpan dan send ke mak atau akak korang."
8. "Ada tak kawan yang selalu tanya korang pasal skincare? Send ni."
9. "Tag dia dekat bawah, korang dah tolong dia tanpa korang sedar."
10. "Share this — satu orang dalam contact list korang tengah cari ni right now."

## Beat math (last 2-3s of video)
- Word count: 8-14 BM words
- Delivery: warm, conversational — framed as caring gesture, NOT a promo ask
- Visual: creator mimics share gesture (hand out, forward motion) OR points to comment section
- Timing: name the recipient (0.5s) → name the problem (0.5s) → implicit action (1s)

## Pairs best with
- Hooks: Pain Confession (the pain is what makes sharing feel relevant), Educational opener
- Frameworks: Storytime, PAS (share as part of the "Solve" moment)
- Personas: Hijabi Bestie, Casual Bestie, Mak Cik Auntie
- Funnel stage: TOFU — amplification play, not conversion. Use when viral reach > immediate sale.

## Pitfalls
- NEVER use share trigger instead of beg kuning when product is already in TikTok Shop and audience is warm
- AVOID generic "share this video!" — specify EXACTLY who to share with and WHY (their problem)
- AVOID combining share + save + follow in one video — one CTA per video rule is absolute

## Veo prompt insertion
Place in dialog field for final 2-3s:
"She gestures forward with her hand and says: 'Send dekat sister korang yang penat dengan jerawat.' — soft, caring tone, like texting a friend a helpful link."
`,
};
