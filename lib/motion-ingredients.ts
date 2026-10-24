// Ingredients the speaker names get their pictures on screen — REQUIRED (the owner's call, 2026-10-24: a seller said
// "dua bahan … daun mulberry dan akar astragalus" and nothing showed). Motion Default / Custom with a video and every
// CLIPPER clip: one read of the transcript finds every named ingredient (and plain "bahan-bahan / kandungan dia"
// mentions), each gets a clean picture (stock photo → web, the vision pick, kept on our storage), and they go on
// screen as full-frame shots on the very word. The shots are pinned ("must"): the composition moves a headline or
// drops a scene for them, and the render's QA never drops them.
import { orChat } from "@/lib/openrouter";
import { extractJson } from "@/lib/motion";
import { pickPhoto } from "@/lib/motion-headline";

export type IngredientShot = {
  at: string; to: string; layout: "full"; kind: "photo"; label: string; query: string; candidates: string[]; must: true;
};
type W = { w: string; t: number; e?: number };

const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").replace(/[<>{}]/g, "").trim().slice(0, n);

/** Every ingredient moment in the transcript: the word its name starts on, its on-screen label, a stock query. */
export async function findIngredientMentions(words: W[], context: string, deadline?: number): Promise<{ i: number; label: string; query: string; generic: boolean }[]> {
  if (words.length < 3) return [];
  const r = await orChat({
    modelKey: "model_motion_guard",
    systemPrompt: `You read a Malaysian seller's transcript (indexed words) and find every moment they NAME an ingredient or component of the product (or of a recipe they explain): herbs, plants, leaves, roots, flowers, fruits, seeds, extracts, vitamins, minerals, oils, proteins, active ingredients — e.g. "daun mulberry", "akar astragalus", "kunyit", "madu", "kolagen", "vitamin C", "hyaluronic acid", "habbatus sauda". The transcript comes from speech recognition: read misheard names as the real ingredient ("melberry" = mulberry, "atragulus" = astragalus).
For each: "i" = the index of the first word of its name; "label" = how it shows on screen, correctly spelt, in the speaker's language, ≤ 3 words ("Daun Mulberry", "Akar Astragalus"); "query" = 2–4 plain English stock-photo words showing just that thing ("mulberry leaves", "astragalus root", "turmeric root", "honey jar").
Also every moment they talk about THIS PRODUCT'S ingredients WITHOUT naming them ("bahan-bahan dia kita letak", "bahan dalam patch ni", "ramuan semula jadi dia") → "generic": true, "label" ("Bahan-bahan"), "query" = what fits (the product's back label when they point at the box; else "natural ingredients").
NOT ingredients: the product or brand name itself, body parts, symptoms, prices, the packaging, and what is IN SOMETHING ELSE ("berapa kandungan gula dalam air kotak" is a drink's sugar, not this product's ingredient — skip it).
Answer ONLY JSON: {"items": [{"i": n, "label": "...", "query": "...", "generic"?: true}]} — "items": [] when there is none.`,
    userPrompt: `${context ? `PRODUCT / VIDEO: ${context.slice(0, 400)}\n` : ""}TRANSCRIPT (index:word):\n${words.slice(0, 1500).map((w, i) => `${i}:${w.w}`).join(" ")}\nJSON only.`,
    temperature: 0,
    maxTokens: 900,
    timeoutMs: 40_000,
    hedgeAfterMs: 18_000,
    ...(deadline ? { deadline } : {}),
  }).catch(() => null);
  if (!r?.ok || !r.content) return [];
  let raw: any = null;
  try { raw = extractJson(r.content); } catch { return []; }
  const seen = new Set<string>();
  return (Array.isArray(raw?.items) ? raw.items : [])
    .map((x: any) => ({ i: Number(x?.i), label: clean(x?.label, 28), query: clean(x?.query, 60), generic: x?.generic === true }))
    .filter((x: { i: number; label: string; query: string }) => Number.isInteger(x.i) && x.i >= 0 && x.i < words.length && x.label && x.query)
    .sort((a: { i: number }, b: { i: number }) => a.i - b.i)
    // the same ingredient named again shows once (its first time)
    .filter((x: { label: string }) => { const k = x.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The full-frame ingredient shots for a video / clip (cues on these words). Fail-soft: [] — never blocks a render. */
export async function ingredientShots(words: W[], context: string, o: { uploads?: string[]; deadline?: number } = {}): Promise<IngredientShot[]> {
  const found = await findIngredientMentions(words, context, o.deadline).catch(() => []);
  if (!found.length) return [];
  const named = found.filter((x) => !x.generic);
  // a plain "bahan-bahan" right before / after the names is said by the named shots already
  const plain = found.filter((x) => x.generic && !named.some((n) => Math.abs(words[n.i].t - words[x.i].t) < 8));
  const moments = [...named, ...plain].sort((a, b) => a.i - b.i).slice(0, 6);
  const own = (o.uploads ?? []).filter((u) => /^https:\/\//.test(u));
  let ownNext = 0;
  const pics = await Promise.all(moments.map(async (m) => {
    // the seller pointing at their product's ingredients: their own product photo says it best
    if (m.generic && own.length) return own[ownNext++ % own.length];
    return pickPhoto(m.query, m.label, context);
  }));
  const shots: IngredientShot[] = [];
  moments.forEach((m, k) => {
    const url = pics[k];
    if (!url) return;
    const t0 = words[m.i].t;
    // on until the next ingredient is named (a quick series), else ~1.8 s; 1–2.4 s
    const next = moments[k + 1] ? words[moments[k + 1].i].t : Infinity;
    const end = t0 + Math.max(1, Math.min(2.4, next - t0 < 2.6 ? next - t0 - 0.05 : 1.8));
    let j = m.i;
    while (j + 1 < words.length && words[j + 1].t < end) j++;
    shots.push({ at: `w${m.i}`, to: `w${j}$`, layout: "full", kind: "photo", label: m.label, query: m.query, candidates: [url], must: true });
  });
  return shots;
}

/** The time a cue stands for on these words (seconds). */
export function cueSec(c: string | number | undefined, words: W[], end = false): number {
  if (typeof c === "number") return c;
  const m = /^w(\d+)(\$)?([+-][\d.]+)?/.exec(String(c ?? ""));
  if (!m) return Number(c) || 0;
  const w = words[Math.min(words.length - 1, Number(m[1]))];
  return ((m[2] || end) ? (w?.e ?? w?.t ?? 0) : (w?.t ?? 0)) + (m[3] ? Number(m[3]) : 0);
}

/** The ingredient shots first; any other B-roll that would share their time gives way. */
export function withIngredientShots<T extends { at: string | number; to?: string | number }>(broll: T[], shots: IngredientShot[], words: W[]): (T | IngredientShot)[] {
  if (!shots.length) return broll;
  const wins = shots.map((s) => [cueSec(s.at, words) - 0.3, cueSec(s.to, words, true) + 0.3]);
  const rest = broll.filter((b) => {
    const s = cueSec(b.at, words), e = b.to !== undefined ? cueSec(b.to, words, true) : s + 2.2;
    return !wins.some(([a, z]) => s < z && e > a);
  });
  // the render takes 16 B-roll moments at most: every ingredient shot is kept, the rest fill what's left
  return [...shots, ...rest.slice(0, Math.max(0, 16 - shots.length))].sort((a, b) => cueSec(a.at, words) - cueSec(b.at, words));
}
