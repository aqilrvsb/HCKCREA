// Motion — AI clean-up of the Whisper transcript before it becomes captions.
// Whisper "small" on Malaysian speech mis-hears words ("GAMDINI", "BEGGUNA",
// "PERCIPAT" for pelipat, "KENAYA" for kena air) and mangles brand names. The
// captions are anchored to the video's chosen language: a token that isn't a
// real word of that language becomes the word the speaker most likely said —
// a proper-language best guess beats sound-alike noise on screen. One fast LLM
// call (model_motion_guard slot, falls back to model_motion) returns ONLY the
// words to change, by index — one-for-one, so every word keeps its timing and
// the jump cut / director cues stay valid. Fail-soft: [] on error.

import { orChat } from "@/lib/openrouter";

type Lang = "ms" | "en" | "auto";

const ANCHOR: Record<Lang, string> = {
  ms: `The captions are in BAHASA MELAYU (Malaysia). Every caption word must be a real Malay word, the brand / product name, or an English word Malaysians commonly mix in and the speaker clearly said (okey, patch, live, check, useless, instruction, complete). Where the audio was unclear Whisper writes sound-alike noise — replace every token that is NOT a real Malay word (and not one of those) with the Malay word the speaker most likely said, judged from the sentence's meaning ("kenaya" → "kena air", "barabahan" → "bahan-bahan", "gatan" → "gatal", "pelu" → "peluh", "dengok" → "tengok"). Also fix real words that make the sentence nonsense when a sound-alike Malay word fits. Always choose the plainest everyday spoken Malay word that makes the sentence natural (what a Malaysian seller would actually say) — never a rare or odd word. A best guess in proper Malay beats leaving noise on screen.`,
  en: `The captions are in ENGLISH. Every caption word must be a real English word or the brand / product name. Replace every token that is not a real English word with the word the speaker most likely said, judged from the sentence's meaning, and fix real words that make the sentence nonsense when a sound-alike word fits.`,
  auto: `The captions follow the speaker's language (Malay, English or Malaysian code-switching). Every caption word must be a real word of the language used in that sentence or the brand / product name. Replace every token that is not a real word with the word the speaker most likely said, judged from the sentence's meaning.`,
};

const SYSTEM = (lang: Lang) => `You correct speech-recognition (Whisper) errors in a Malaysian TikTok seller's transcript so it can be shown as on-screen captions. You get indexed words. Return ONLY the words to change, with the corrected spelling.
${ANCHOR[lang]}
- fix misspellings and wrongly merged / split syllables INSIDE one token ("begguna" → "beg guna"; "percipat" → "pelipat"; "labet" → "label"; "gamdini" → "gam dia ni")
- drop stray symbols glued to a word ("-satu" → "satu", "-cepat" → "cepat")
- the product / brand name exactly as in SELLER CONTEXT
- keep the speaker's colloquial words and slang as they are (tak, nak, je, korang, kan, dia, lah, aja, dekat) — don't formalise, don't translate whole phrases, don't censor, don't add or remove words
- one-for-one: a correction replaces exactly one token (it may contain a space); keep punctuation attached as it was; never repeat the word right before or after it
Answer ONLY JSON: {"fix": [[index, "corrected"], ...]}`;

const bare = (s: string | undefined) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Whisper artifacts fixed without a model: a hyphen glued to the front of a word ("-satu"). */
export function tidyToken(w: string): string {
  return w.replace(/^[-–—]+(?=[\p{L}\p{N}])/u, "");
}

export async function fixTranscript(words: { i: number; w: string }[], product?: string, language: Lang = "ms"): Promise<[number, string][]> {
  if (!words.length) return [];
  const byIndex = new Map(words.map((w) => [w.i, w.w]));
  const lang: Lang = language === "en" || language === "auto" ? language : "ms";
  const r = await orChat({
    modelKey: "model_motion_guard",
    systemPrompt: SYSTEM(lang),
    userPrompt: (product ? `SELLER CONTEXT: ${product.slice(0, 200)}\n\n` : "") +
      `TRANSCRIPT (index:word):\n${words.slice(0, 3000).map((w) => `${w.i}:${w.w}`).join(" ")}\n\nJSON only.`,
    temperature: 0,
    maxTokens: 2500,
    timeoutMs: 45_000,
    hedgeAfterMs: 20_000,
    stream: true,
  }).catch(() => null);
  const out = new Map<number, string>();
  // Deterministic tidy first — kept even when the model is down.
  for (const w of words) {
    const t = tidyToken(w.w);
    if (t && t !== w.w) out.set(w.i, t);
  }
  if (r?.ok && r.content) {
    const t = r.content.replace(/```(?:json)?/gi, "");
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    let j: any = null;
    try { j = JSON.parse(t.slice(a, b + 1)); } catch { /* keep the tidy fixes */ }
    for (const f of Array.isArray(j?.fix) ? j.fix : []) {
      const i = Number(f?.[0]);
      const w = tidyToken(String(f?.[1] ?? "").replace(/\s+/g, " ").trim());
      const orig = byIndex.get(i);
      if (orig === undefined || !w || w.length > 40 || w === orig) continue;
      const parts = w.split(" ");
      if (parts.length > 3) continue; // a fix, not a rewrite
      // "pakaian di" → "pacak di" + the "di" that follows = "di di": a split that
      // repeats a neighbouring word is a bad guess.
      if (parts.length > 1 && (bare(parts[0]) === bare(byIndex.get(i - 1)) || bare(parts[parts.length - 1]) === bare(byIndex.get(i + 1)))) continue;
      out.set(i, w);
    }
  }
  return [...out.entries()].slice(0, 400);
}
