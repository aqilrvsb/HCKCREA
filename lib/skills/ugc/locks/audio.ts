import type { Skill } from "../../types";

export const lockAudio: Skill = {
  id: "audio",
  kind: "lock",
  tab: "ugc",
  title: "Audio Lock (Single Voice Integrity)",
  triggers: ["audio", "voice", "background voice", "chatter", "noise", "single voice", "audio lock", "sound"],
  body: `# Audio Lock

## The exact lock text
\`\`\`
ONE single voice only, no background chatter, no crowd noise, no secondary speakers, no overlapping dialogue
\`\`\`

## Why it exists
Veo generates ambient audio that fits the scene context. In domestic settings (bedroom, bathroom, kitchen — the most common UGC scenes), the model frequently adds:
- Background TV dialogue
- Family member voices in adjacent room
- Ambient crowd murmur (from "lived-in" scene inference)
- Echo/reverb that implies a second person in the room

For TikTok UGC, a single creator voice is the format signature. Background voices signal either a poorly recorded home video or a busy set — both break the parasocial intimacy the format depends on.

## When to disable / soften
- **Group reaction video** (multiple creators intentionally): remove this lock; multi-voice is the format
- **Market/street scene** (if ambient crowd is part of the scene authenticity): soften to "one foreground voice, background crowd ambient only (no distinct words)"
- **Testimonial compilation** (explicitly multiple speakers): omit

## Veo failure if absent
Scene: creator in bedroom doing skincare. Without lock → Veo adds audible TV dialogue in background, plus faint second voice (implied family). Creator's narration competes with background audio. Unusable without audio edit pass.

## Notes
This lock is cheap (8 tokens) and should almost never be removed. Even in street scenes, "no distinct background words" is a softer version that preserves authenticity without allowing competing narration.
`,
};
