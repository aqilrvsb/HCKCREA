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
  ms: `The captions are in BAHASA MELAYU (Malaysia), spoken the Malaysian way: sellers freely mix in English words and terms (skincare, serum, glowing, moisturizer, review, before after, original, free gift, promo, checkout, COD, okey, patch, live, check, useless, complete). Every caption word must be a real Malay word, the brand / product name, or an English word the speaker clearly said — keep those in correct ENGLISH spelling and restore it when Whisper spelt an English term the Malay way ("skinker" → "skincare", "glowing" stays "glowing", "rebiu" → "review"); never translate them into Malay. Where the audio was unclear Whisper writes sound-alike noise — replace every token that is NOT a real Malay word (and not one of those) with the Malay word the speaker most likely said, judged from the sentence's meaning ("kenaya" → "kena air", "barabahan" → "bahan-bahan", "gatan" → "gatal", "pelu" → "peluh", "dengok" → "tengok"). Also fix real words that make the sentence nonsense when a sound-alike Malay word fits. Always choose the plainest everyday spoken Malay word that makes the sentence natural (what a Malaysian seller would actually say) — never a rare or odd word. A best guess in proper Malay beats leaving noise on screen.`,
  en: `The captions are in ENGLISH. Every caption word must be a real English word or the brand / product name. Replace every token that is not a real English word with the word the speaker most likely said, judged from the sentence's meaning, and fix real words that make the sentence nonsense when a sound-alike word fits.`,
  auto: `The captions follow the speaker's language (Malay, English or Malaysian code-switching). Every caption word must be a real word of the language used in that sentence or the brand / product name. Replace every token that is not a real word with the word the speaker most likely said, judged from the sentence's meaning.`,
};

const SYSTEM = (lang: Lang) => `You correct speech-recognition (Whisper) errors in a Malaysian TikTok seller's transcript so it can be shown as on-screen captions. You get indexed words. Return ONLY the words to change, with the corrected spelling.
${ANCHOR[lang]}
- fix misspellings and wrongly merged / split syllables INSIDE one token ("begguna" → "beg guna"; "percipat" → "pelipat"; "labet" → "label"; "gamdini" → "gam dia ni")
- drop stray symbols glued to a word ("-satu" → "satu", "-cepat" → "cepat")
- the product / brand name exactly as in SELLER CONTEXT
- names of herbs, plants and ingredients are often misheard or split into odd tokens: restore the real name when the sentence names an ingredient ("akar rasamulia" → "akar astragalus", "daun melberry" → "daun mulberry", "habatus" → "habbatus")
- a real word that makes its sentence nonsense where it stands was misheard: replace it with the sound-alike word that makes the sentence natural — read the words around it ("minum letih tujuh kotak" → "lebih", while "saya letih sangat" stays "letih") and what the video is about (SELLER CONTEXT: "kulit" (skin) in a cake seller's video → "kulat" (mould)). A real word that makes sense where it stands stays as it is, even when another word could also fit ("kena sediakan sabun" stays "sabun"); a name stays a name.
- keep the speaker's colloquial words and slang as they are (tak, nak, je, korang, kan, dia, lah, aja, dekat) — don't formalise, don't translate whole phrases, don't censor, don't add or remove words
- NEVER turn a token into a vulgar, sexual, explicit or insulting word (Malay or English). Sellers of intimate / feminine-care products speak in polite euphemisms ("bunga", "kewanitaan", "area sensitif", "bahagian bawah") — an unclear token there is one of those polite words (use the one the speaker says elsewhere), never a crude anatomical word. If you're not sure, leave the token unchanged.
- one-for-one: a correction replaces exactly one token (it may contain a space); keep punctuation attached as it was; never repeat the word right before or after it
Answer ONLY JSON: {"fix": [[index, "corrected"], ...]}`;

const bare = (s: string | undefined) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

// Words a "fix" may never introduce (a model once turned an unclear "bunga" —
// the seller's polite word — into a crude one). Kept only if the speaker's own
// token already was that word.
const VULGAR = new Set([
  "cipap", "puki", "pukimak", "pepek", "burit", "kote", "konek", "butuh", "pantat", "lancau", "jubur", "sundal", "pelacur",
  "fuck", "fucking", "shit", "pussy", "dick", "cock", "cunt", "bitch", "slut", "whore", "penis", "vagina",
]);
const isVulgar = (w: string) => w.split(/\s+/).some((p) => VULGAR.has(bare(p)));

/** Whisper artifacts fixed without a model: a hyphen glued to the front of a word ("-satu"). */
export function tidyToken(w: string): string {
  return w.replace(/^[-–—]+(?=[\p{L}\p{N}])/u, "");
}

/** The model's word with the speaker's own punctuation around it: a fix changes the word, never the full stop /
 *  comma the caption lines break on ("sabun." → "sabun" is no fix). */
function keepPunct(orig: string, fixed: string): string {
  const edge = (s: string) => /^([^\p{L}\p{N}]*)([\s\S]*?)([^\p{L}\p{N}]*)$/u.exec(s) ?? ["", "", s, ""];
  const [, pre, , post] = edge(orig);
  const core = edge(fixed)[2];
  return core ? `${pre}${core}${post}` : fixed;
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
      const orig = byIndex.get(i);
      if (orig === undefined) continue;
      const w = tidyToken(keepPunct(orig, String(f?.[1] ?? "").replace(/\s+/g, " ").trim()));
      if (!w || w.length > 40 || w === orig) continue;
      if (isVulgar(w) && !isVulgar(orig)) continue; // never put a crude word in the speaker's mouth
      const parts = w.split(" ");
      if (parts.length > 3) continue; // a fix, not a rewrite
      // a token split into words keeps its own start ("begguna" → "beg guna", "kenaya" → "kena air"); one that
      // grows a new word in front ("ipah" → "Kak Ipah" after "kakak") adds a word the speaker didn't say
      if (parts.length > 1 && bare(parts[0])[0] !== bare(orig)[0]) continue;
      // "pakaian di" → "pacak di" + the "di" that follows = "di di": a split that
      // repeats a neighbouring word is a bad guess.
      if (parts.length > 1 && (bare(parts[0]) === bare(byIndex.get(i - 1)) || bare(parts[parts.length - 1]) === bare(byIndex.get(i + 1)))) continue;
      out.set(i, w);
    }
  }
  return [...out.entries()].slice(0, 400);
}
