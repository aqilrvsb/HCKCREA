import type { Skill } from "../../types";

export const lockVisualClean: Skill = {
  id: "visual-clean",
  kind: "lock",
  tab: "ugc",
  title: "Visual Clean Lock (Caption & Overlay Free)",
  triggers: ["captions", "subtitles", "text overlay", "stickers", "watermark", "clean video", "no text", "bottom safe zone"],
  body: `# Visual Clean Lock

## The exact lock text
\`\`\`
RAW UNEDITED FOOTAGE — bottom 25% of frame completely empty, no subtitles, no captions, no sticker text, no overlays, no watermarks, no burned-in text of any kind anywhere in frame
\`\`\`

## Why it exists
Veo infers from UGC scene context that captions and stickers are part of the authentic format — which is correct for real TikTok content, but wrong for AI-generated base clips that go through post-production. Without this lock:
- Auto-caption style text burns into the video (impossible to remove)
- Motivational phrase stickers appear in corners
- Product name text overlays render mid-frame
- Engagement prompts ("like & follow") appear at bottom

Post-production (CapCut, TikTok native) requires a clean base clip. Burned-in text from Veo cannot be removed without re-generating the clip.

The "bottom 25% empty" instruction is critical specifically because TikTok's UI (beg kuning, comment icon, share, heart, username) occupies the bottom 25% of the screen. Any visual content in that zone is obscured by UI elements AND Veo-burned text compounds the problem.

## When to disable / soften
- **Explicit meme-style content** (user wants captions baked in by Veo): remove; specify exact caption style instead
- **Tutorial with step numbers** (user wants overlays): specify exact overlay positions
- **Final-cut scene** (no post-production planned): soften "empty bottom" if no TikTok UI overlay expected
- This lock should almost never be fully disabled for TikTok Shop content

## Veo failure if absent
Scene: creator applies moisturizer. Without lock → Veo burns in white caption text at bottom reading "GLOWING SKIN ROUTINE" and adds a sticker-style product name overlay mid-frame. Bottom 30% has two layers of text (Veo + TikTok UI). Video is unusable without full re-gen.

## Notes
"Bottom 25% completely empty" is non-negotiable for all TikTok Shop content. TikTok's beg kuning icon sits at approx. 80-85% screen height. Any Veo-generated text in that zone directly conflicts with the primary purchase CTA.
`,
};
