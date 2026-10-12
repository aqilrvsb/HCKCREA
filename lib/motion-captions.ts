// Motion — AI clean-up of the Whisper transcript before it becomes captions.
// Whisper "small" on Malaysian speech mis-hears words ("GAMDINI", "BEGGUNA",
// "PERCIPAT" for pelipat, "LABET" for label) and mangles brand names. One
// fast LLM call (model_motion_guard slot, falls back to model_motion) returns
// ONLY the words to change, by index — one-for-one, so every word keeps its
// timing and the jump cut / director cues stay valid. Fail-soft: [] on error.

import { orChat } from "@/lib/openrouter";

const SYSTEM = `You correct speech-recognition (Whisper) errors in a Malaysian TikTok seller's transcript (Bahasa Melayu Malaysia, Manglish, code-switching). You get indexed words. Return ONLY the words that are clearly mis-heard, with the corrected spelling:
- fix misspellings and wrongly merged / split syllables INSIDE one token ("begguna" → "beg guna"; "percipat" → "pelipat"; "labet" → "label"; "gamdini" → "gam dia ni")
- the product / brand name exactly as in SELLER CONTEXT
- keep the speaker's colloquial words and slang as they are (tak, nak, je, korang, kan, dia, lah) — don't formalise, don't translate, don't censor, don't add or remove words
- one-for-one: a correction replaces exactly one token (it may contain a space); keep punctuation attached as it was
- when unsure, leave it
Answer ONLY JSON: {"fix": [[index, "corrected"], ...]}`;

export async function fixTranscript(words: { i: number; w: string }[], product?: string): Promise<[number, string][]> {
  if (!words.length) return [];
  const byIndex = new Map(words.map((w) => [w.i, w.w]));
  const r = await orChat({
    modelKey: "model_motion_guard",
    systemPrompt: SYSTEM,
    userPrompt: (product ? `SELLER CONTEXT: ${product.slice(0, 200)}\n\n` : "") +
      `TRANSCRIPT (index:word):\n${words.slice(0, 3000).map((w) => `${w.i}:${w.w}`).join(" ")}\n\nJSON only.`,
    temperature: 0,
    maxTokens: 2500,
    timeoutMs: 45_000,
    hedgeAfterMs: 20_000,
    stream: true,
  }).catch(() => null);
  if (!r?.ok || !r.content) return [];
  const t = r.content.replace(/```(?:json)?/gi, "");
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  let j: any = null;
  try { j = JSON.parse(t.slice(a, b + 1)); } catch { return []; }
  const out: [number, string][] = [];
  for (const f of Array.isArray(j?.fix) ? j.fix : []) {
    const i = Number(f?.[0]);
    const w = String(f?.[1] ?? "").replace(/\s+/g, " ").trim();
    const orig = byIndex.get(i);
    if (orig === undefined || !w || w.length > 40 || w === orig) continue;
    if (w.split(" ").length > 3) continue; // a fix, not a rewrite
    out.push([i, w]);
  }
  return out.slice(0, 400);
}
