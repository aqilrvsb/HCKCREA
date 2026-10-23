import { extractJson } from "@/lib/motion";
import { orChat } from "@/lib/openrouter";
import type { PolishKeyword, PolishZoom } from "@/lib/clipper-preview";
import { HEADLINE_SPEC, cleanHeadlines, type HeadlinePlan } from "@/lib/motion-headline";

type PlanWord = { i: number; w: string; t: number; e?: number };
const KEY_COLORS = new Set(["benefit", "price", "pain", "brand", "accent"]);

/** CLIPPER captions polish (one quick AI call): the words that carry the clip get a colour (and now and then an
 *  emoji), and the emphasis / punchline lines get a punch-in zoom — what Submagic / OpusClip ship by default.
 *  Cues are word indices ("w12", "w18$"), resolved by the render like the director's. Fails → none.
 *  Made once per clip: for the Studio preview (/api/clipper/preview), then reused by the render. */
export async function clipPolish(words: PlanWord[], duration: number, title: string, deadline: number, context = ""): Promise<{ keywords: PolishKeyword[]; zooms: PolishZoom[]; headlines: HeadlinePlan[] }> {
  // the headline layouts are required: made up from the title when the call fails or the clip is too short for it
  const fallback = () => ({ keywords: [] as PolishKeyword[], zooms: [] as PolishZoom[], headlines: cleanHeadlines([], words, duration, title) });
  if (words.length < 8) return fallback();
  const r = await orChat({
    modelKey: "model_motion",
    systemPrompt: `You polish the captions of a short podcast / talking clip for TikTok / Reels (Malaysia). The words are numbered. Choose:
1. "keywords": the words that carry the meaning — the punchline word, numbers, names, strong verbs / adjectives, the key noun of each sentence. About one every 2–3 seconds, never two neighbours. "color": "benefit" (positive, good outcome), "pain" (negative, problem, danger), "price" (numbers, money, quantities), "brand" (names of people / places / brands / books), "accent" (any other emphasis). Add "emoji" (one character) only where it lands naturally — at most one every 6 seconds; none on serious / religious / tragic topics.
2. "zooms": 2–6 punch-in moments on the emphasis and the punchline — {"at": "w12", "to": "w18$", "scale": 1.08–1.18} (cue "wN" = when word N starts, "wN$" = when it ends); each 1.5–5 s, spread over the clip, never in the first 2 seconds.
3. ${HEADLINE_SPEC.replace(/CUE/g, '"wN"')}
   The clip's first ~2.5 s carry its hook title: no headline there. No zoom inside a headline's time.
Return ONLY JSON: {"keywords": [{"i": n, "color": "...", "emoji"?: "…"}], "zooms": [{"at": "wN", "to": "wM$", "scale": n}], "headlines": [{"kind": "over" | "split" | "pip", "at": "wN", "to"?: "wM$", "lead": "...", "big": "...", "box": "...", "query"?: "...", "media"?: "video" | "photo"}]}`,
    userPrompt: `${context ? `THE VIDEO (what it is about and why — every headline and every B-roll query serves this): ${context.slice(0, 600)}\n` : ""}CLIP: "${title}" (${Math.round(duration)} s)\nWORDS (index:word@second):\n${words.map((w) => `${w.i}:${w.w}@${w.t.toFixed(1)}`).join(" ")}\nJSON only.`,
    temperature: 0.3,
    maxTokens: 2600,
    timeoutMs: 45_000,
    stream: true,
    deadline,
  }).catch(() => null);
  if (!r?.ok || !r.content) return fallback();
  let raw: any = null;
  try { raw = extractJson(r.content); } catch { return fallback(); }
  const n = words.length;
  const used = new Set<number>();
  let emojis = 0;
  const keywords = (Array.isArray(raw?.keywords) ? raw.keywords : [])
    .map((k: any) => {
      const i = Number(k?.i);
      if (!Number.isInteger(i) || i < 0 || i >= n || used.has(i) || !KEY_COLORS.has(k?.color)) return null;
      used.add(i);
      const em = typeof k?.emoji === "string" ? Array.from(k.emoji.trim()).slice(0, 2).join("") : "";
      const emoji = em && /\p{Extended_Pictographic}/u.test(em) && emojis < Math.max(1, Math.ceil(duration / 6)) ? (emojis++, em) : "";
      return { i, color: k.color, ...(emoji ? { emoji } : {}) };
    })
    .filter(Boolean)
    .slice(0, Math.ceil(duration / 2));
  const cue = (c: unknown) => {
    const m = /^w(\d+)(\$)?$/i.exec(String(c ?? "").trim());
    return m && Number(m[1]) < n ? `w${Number(m[1])}${m[2] ? "$" : ""}` : undefined;
  };
  const zooms = (Array.isArray(raw?.zooms) ? raw.zooms : [])
    .map((z: any) => {
      const at = cue(z?.at);
      if (!at || words[Number(at.slice(1).replace("$", ""))].t < 2) return null;
      const to = cue(z?.to);
      return { at, ...(to ? { to } : {}), scale: Math.min(1.2, Math.max(1.05, Number(z?.scale) || 1.12)) };
    })
    .filter(Boolean)
    .slice(0, Math.max(2, Math.ceil(duration / 8)));
  return { keywords, zooms, headlines: cleanHeadlines(raw?.headlines, words, duration, title) };
}
