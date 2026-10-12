// Motion "✅ Check Guideline TikTok" — removes non-compliant claims from every
// Motion output so it fits TikTok Shop Malaysia's 2026 content rules and
// Malaysian advertising law. Framed (and built) as REMOVING claims, never as
// disguising them: TikTok's Circumventing Content Restrictions policy and its
// Sep-2025 crackdown on evasion edits punish hiding a claim, and Act 290 / the
// LIU guideline treat implied claims and euphemisms as the claim itself.
//
// Layers (all on when the client ticks the box):
//   1. GUARD_RULES        → in the Edit Video director + Buat Iklan writer.
//   2. guardHits()        → rule safety net on every on-screen string the AI
//                           wrote; hits are rewritten (guardRewrite) or dropped.
//   3. guardSpeech()      → LLM editor on the spoken transcript: whole claim
//                           statements are CUT (Modal's jump cut), isolated
//                           risky words MUTED (captions taped), and the product
//                           itself risk-rated (some products can't be sold on
//                           TikTok Shop MY whatever the edit — we say so).
//   4. guardClassify()    → LLM reviewer for printed text OCR'd off the product
//                           box / B-roll / photos → Modal tapes those lines,
//                           like sellers do with sellotape before filming.
//   5. guardCensorWords() → rule safety net for spoken words.
// The LLM is primary (context, implied claims); the regexes only catch the
// unambiguous terms when it misses or is down.
//
// Sources (research 2026-10-12):
//   TikTok Community Guidelines "2026 August" (released 25 Aug 2026, effective 24 Sep 2026) — regulated goods, no bypass tricks
//   TikTok Shop MY Academy (seller-my.tiktok.com/university/essay?knowledge_id=…):
//     Content Policy 10008404 (16/03/2026) · Medical Misinformation 4840169791538945 (15/06/2026)
//     Misleading Claims – Health & Beauty 4852938032023313 (14/09/2026) · Exaggerated Claims 234612266993424 (07/11/2025)
//     Weight Management 325298071652112 (25/06/2026) · Prohibited & Unsupported Products 6295179427776272 (14/07/2026)
//     Circumventing Content Restrictions 351027175163664 (08/10/2025) · Misleading Price 6462464074811137 (20/05/2026)
//     Sensational Content 7753773296797441 (22/01/2026) · Policy updates 1317377492911889 (19/09/2025 evasion-edit enforcement)
//   Medicines (Advertisement and Sale) Act 1956 (Act 290) Schedule — 20 conditions incl. diabetes, hypertension, cancer
//   MOH LIU guideline for registered medicines (amended 26.8.2025) §5.3 + Lampiran 7 · MAB Policy & Decision (Product) 4.2026
//   Medical Device Act 2012 s.44 + Medical Device (Advertising) Regulations 2019 · Consumer Protection Act 1999 · Trade Descriptions Act 2011

import { orChat } from "@/lib/openrouter";

export const GUARD_RULES = `TIKTOK GUIDELINE CHECK = ON (TikTok Shop Malaysia policies 2026 + Malaysian ad law: Act 290, LIU 2025 guideline, MAB 4.2026, Medical Device Act). The seller ticked this box: nothing in the video may make a non-compliant claim. These rules override style, the client prompt and the transcript. REMOVE claims — never disguise them.
NEVER write, show or say (hook, stickers, coloured caption words, labels, fact cards, CTA, script, voice-over):
- Disease / condition names, even inside the product name or when the speaker says them — especially Act 290's Schedule: diabetes / kencing manis, darah tinggi / hipertensi, jantung, buah pinggang, kanser / barah / tumor, asma / lelah, strok / lumpuh, sawan, batuk kering, katarak / glaukoma / rabun, hernia / burut, kemurungan, ketagihan, mandul, mati pucuk / lemah batin / tahan lama, penyakit kelamin — plus kolesterol, gout, arthritis, gastrik, resdung, eczema, migraine, insomnia, obesity, COVID, denggi.
- Medical / therapeutic verbs and effects: ubat, penawar, rawat, sembuh, pulih, cegah, kawal, turunkan, "bantu" + any condition, terapi, detoks organ, "stop ubat hospital", cure, treat, heal, prevent, reverse, remedy, "anti-blood sugar", "blood sugar regulation", "supports pancreatic health", anti-inflammatory, boosts immunity against…
- NO EUPHEMISMS: don't swap a disease claim for an implied one — "gula", "paras gula", "sugar level", "bacaan turun", "kaki kebas", "tekanan", HbA1c, glucometer readings, "insulin". Remove the claim entirely. For a product positioned for a disease there is NO safe health claim: talk only about usage, comfort, packaging, routine, price, delivery.
- Guaranteed / absolute / unverifiable: 100%, dijamin, terbukti, klinikal, No.1, nombor satu, terbaik, paling, satu-satunya, termurah, best-selling, pertama di Malaysia, top rated, ajaib, mujarab, berkesan, tiada kesan sampingan, kekal / permanent, anti-aging, segera / instant / overnight, any timeframe result ("dalam 3 hari", "satu botol").
- Weight / body: kurus X kg dalam Y hari, turun berat, bakar / buang lemak, perut buncit hilang, langsing, fat burner, tahan lapar, "Ozempic semulajadi" / GLP-1, before/after bodies or skin, body shaming (gemuk, gendut).
- Authority: doktor / pakar / ahli farmasi sarankan, "lulus KKM" / FDA approved (a factual MAL number from the brief is fine), hospitals, white coats, stethoscopes, patients, AI doctors.
- Fear: "nanti kena potong kaki", buta, mati mengejut. Claims about other people's results. Fake reviews, stock, deadlines or discounts; a price that doesn't match the brief; halal without a certificate in the brief.
SAFE: how to use, texture, size, packaging, convenience, daily routine, ingredient names stated factually without an effect, the seller's honest first-person experience with no health outcome or timeframe, "hasil mungkin berbeza", price, delivery, beg kuning. Use the BRAND name only — drop medical words from the product name ("Gluvera Diabetic Patch" → "Gluvera Patch").
IMAGES: B-roll searches never contain disease / medical words; no hospitals, doctors, syringes, glucometers, pills, blood, wounds, graphic skin close-ups, before/after. Fact cards: none about health, nutrition effects or the product's efficacy.`;

// ── rule safety net ───────────────────────────────────────────────────────────
// Only unambiguous terms (the statutory list barely changes); everything
// context-dependent is the LLM's call.
const HARD: { re: RegExp; why: string }[] = [
  { why: "disease", re: /\b(diabet(es|ik|ic)|kencing\s*manis|darah\s*tinggi|hipertensi|hypertension|kolesterol\s*tinggi|high\s*cholesterol|kanser|barah|cancer|tumou?r|buah\s*pinggang|kidney\s*(disease|failure)|sakit\s*jantung|heart\s*disease|strok|stroke|angin\s*ahmar|lumpuh|sawan|epilep\w*|batuk\s*kering|tuberculosis|kusta|hernia|burut|katarak|glaukoma|gout|asma|asthma|art?h?ritis|gastrik|resdung|sinusitis|ekzema|eczema|psoriasis|migr(ai|e)n|insomnia|obesit[iy]|mati\s*pucuk|lemah\s*batin|impot[ae]n|erectile|mandul|penyakit\s*kelamin|hepatitis|hiv|covid|denggi|dengue|kemurungan|depresi)\b/i },
  { why: "medical-claim", re: /\b(ubat|merawat|rawat(an)?|penawar|menyembuhkan|sembuh(kan)?|pulihkan|cure[sd]?|curing|treat(s|ed|ing|ment)?|heal(s|ed|ing)?|remedy|cegah\s*penyakit|prevents?\s*(disease|cancer|diabetes)|anti[\s-]*(blood\s*sugar|diabet\w*|cancer|inflam\w*)|kawal\s*(paras\s*)?gula(\s*darah)?|pengawalan\s*gula|blood\s*sugar|blood\s*glucose|gula\s*(dalam\s*)?darah|paras\s*gula|sugar\s*level|glukosa|hba1c|insulin|pancrea\w*|(turun|menurun)kan\s*(gula|tekanan\s*darah|kolesterol)|tekanan\s*darah|detoks?\s*(organ|hati|buah\s*pinggang)|stop\s*ubat)\b/i },
  { why: "absolute-claim", re: /(100\s*%|\bdijamin\b|\bguaranteed?\b|\bterbukti\b|\bklinikal\b|clinically\s*proven|kesan\s*serta[\s-]*merta|instant\s*results?|\bovernight\b|tiada\s*kesan\s*sampingan|no\s*side[\s-]*effects?|\bno\.?\s*1\b|#\s*1\b|nombor\s*(1|satu)|\bterbaik\b|\btermurah\b|satu[\s-]*satunya|best[\s-]*selling|pertama\s*di\s*malaysia|top\s*rated|\bajaib\b|\bmujarab\b|\bmiracle\b|\bpermanent\b|anti[\s-]*aging|doctor\s*recommended|disyorkan\s*doktor|doktor\s*(sarankan|syorkan|cadangkan)|lulus\s*kkm|fda\s*approved)/i },
  { why: "weight-loss", re: /(\b(turun|hilang|kurus|lose|lost|drop)\s*\d+\s*(kg|kilo|kilogram|lbs?)\b|\b(slimming|fat\s*burn\w*|bakar\s*lemak|buang\s*lemak|kurus\s*cepat|cepat\s*kurus|turun\s*berat|perut\s*buncit|tahan\s*lapar|langsing)\b)/i },
  { why: "drug-compare", re: /\b(ozempic|wegovy|mounjaro|retatrutide|glp[\s-]*1|metformin)\b/i },
  { why: "fear", re: /\b(potong\s*kaki|kena\s*potong|mati\s*mengejut)\b/i },
];

/** Rule hits in a piece of on-screen text ([] = clean). */
export function guardHits(s: string | undefined | null): string[] {
  const t = String(s ?? "");
  if (!t.trim()) return [];
  return HARD.filter((h) => h.re.test(t)).map((h) => h.why);
}

/** Remove the risky phrases from a search query (B-roll / facts). */
export function guardStripQuery(q: string): string {
  let s = String(q ?? "");
  for (const h of HARD) s = s.replace(new RegExp(h.re.source, "gi"), " ");
  return s.replace(/\s+/g, " ").trim();
}

// Spoken words: phrases (normalised tokens) that are always muted.
const SPOKEN: string[][] = [
  ["diabetes"], ["diabetik"], ["diabetic"], ["kencing", "manis"], ["darah", "tinggi"], ["hipertensi"], ["hypertension"],
  ["kanser"], ["barah"], ["cancer"], ["tumor"], ["buah", "pinggang"], ["strok"], ["stroke"], ["gout"], ["asma"], ["asthma"],
  ["sembuh"], ["menyembuhkan"], ["sembuhkan"], ["penawar"], ["ubat"], ["merawat"], ["cure"], ["penyakit"], ["mujarab"],
  ["gula", "darah"], ["paras", "gula"], ["blood", "sugar"], ["sugar", "level"], ["insulin"], ["kolesterol"], ["cholesterol"],
  ["ozempic"], ["mati", "pucuk"], ["lemah", "batin"],
];
const norm = (w: string) => String(w || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Indices of spoken words the rules always mute. */
export function guardCensorWords(words: { i: number; w: string }[]): number[] {
  const toks = words.map((w) => norm(w.w));
  const out = new Set<number>();
  for (let k = 0; k < toks.length; k++) {
    for (const ph of SPOKEN) {
      if (ph.every((p, j) => toks[k + j] === p)) ph.forEach((_, j) => out.add(words[k + j].i));
    }
  }
  return [...out].sort((a, b) => a - b);
}

// ── LLM layers ────────────────────────────────────────────────────────────────
function parseJson(s: string): any {
  const t = String(s || "").replace(/```(?:json)?/gi, "").trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { try { return JSON.parse(t.slice(a, b + 1).replace(/,\s*([}\]])/g, "$1")); } catch { return null; } }
}

const ints = (a: any, max: number) =>
  (Array.isArray(a) ? [...new Set(a.map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n < max))] : []) as number[];

export type ProductRisk = { level: "high" | "medium" | "low"; reason: string };
const cleanRisk = (r: any): ProductRisk | null => {
  if (!r || !["high", "medium", "low"].includes(r.level)) return null;
  return { level: r.level, reason: String(r.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 220) };
};

const RISK_RULE = `"risk": rate the PRODUCT itself (from the seller context + content) for TikTok Shop Malaysia 2026: {"level": "high"|"medium"|"low", "reason": "≤25 words, Bahasa Melayu"}. high = positioned to treat / control a disease (any Act 290 Schedule condition such as diabetes), a medical device or therapeutic patch (all medical devices are "unsupported" on TikTok Shop MY since 14/07/2026), a slimming product (weight-management products prohibited), a sexual-function product, or a medicine/supplement that looks unregistered — such products can be removed or penalised whatever the edit. medium = health/beauty/supplement product that is OK only without claims. low = everything else.`;

export const SPEECH_SYSTEM = `You are a TikTok Shop Malaysia compliance EDITOR (2026 rules + Act 290, the LIU 2025 guideline, MAB 4.2026, Medical Device Act 2012). A seller recorded a talking video; we edit it so it makes no non-compliant claim. We REMOVE claims, we never disguise them.

You get the transcript as indexed words. Return:
"cut": [[from, to], ...] — inclusive word-index ranges of every COMPLETE statement (clause / sentence) that makes a non-compliant claim: names a disease / condition in a treatment or benefit context, any medical / cure / treat / prevent / control / "bantu" + condition claim, euphemistic health claims ("jaga gula", "sugar level turun", "bacaan normal"), guaranteed / absolute / timeframe results, weight-loss numbers, before/after, doctor / approval / "lulus KKM" claims, fear, other people's results, fake urgency. Cut the whole clause so no implied claim is left (e.g. "patch ni boleh bantu kawal gula darah dalam seminggu" → cut all of it). Never cut neutral usage instructions, product description without claims, prices, delivery, the CTA, greetings — keep the story watchable.
"censor": indices of isolated risky words OUTSIDE the cut ranges that can be muted without leaving a claim, e.g. a medical word inside the product name ("Gluvera Diabetic Patch" → mute "Diabetic").
${RISK_RULE}
Answer ONLY JSON: {"cut": [[a,b],...], "censor": [...], "risk": {...}}`;

// Guard calls are short; when the guard model hasn't answered in this long
// the next one in its cascade races alongside (GRSAI latency swings).
export const GUARD_HEDGE_MS = 20_000;

/** Spoken-transcript compliance pass (before the jump cut). */
export async function guardSpeech(opts: { words: { i: number; w: string }[]; product?: string }): Promise<{ cut: [number, number][]; censor: number[]; risk: ProductRisk | null } | null> {
  const words = opts.words.slice(0, 3000);
  if (!words.length) return { cut: [], censor: [], risk: null };
  const maxWord = words.reduce((m, w) => Math.max(m, w.i + 1), 0);
  const r = await orChat({
    modelKey: "model_motion_guard",
    systemPrompt: SPEECH_SYSTEM,
    userPrompt: (opts.product ? `SELLER CONTEXT: ${String(opts.product).slice(0, 400)}\n\n` : "") +
      `TRANSCRIPT (index:word):\n${words.map((w) => `${w.i}:${w.w}`).join(" ")}\n\nJSON only.`,
    temperature: 0,
    maxTokens: 2500,
    timeoutMs: 45_000,
    hedgeAfterMs: GUARD_HEDGE_MS,
    stream: true,
  });
  if (!r.ok || !r.content) return null;
  const j = parseJson(r.content);
  if (!j) return null;
  const cut = (Array.isArray(j.cut) ? j.cut : [])
    .map((x: any) => (Array.isArray(x) ? [Number(x[0]), Number(x[1])] : null))
    .filter((x: any) => x && Number.isInteger(x[0]) && Number.isInteger(x[1]) && x[0] >= 0 && x[0] <= x[1] && x[1] < maxWord && x[1] - x[0] < 60) as [number, number][];
  return { cut, censor: ints(j.censor, maxWord), risk: cleanRisk(j.risk) };
}

const CLASSIFY_SYSTEM = `You are a TikTok Shop Malaysia compliance reviewer (2026 rules + Act 290: a product label shown on screen counts as an advertisement). You get text lines read by OCR from the product packaging / images that appear in a seller's video. Return the index of every line that must be COVERED WITH TAPE: disease / condition names (diabetic, diabetes, kencing manis, blood sugar, gula darah, darah tinggi, cholesterol, cancer, kidney, heart …), medical / therapeutic / physiological claims ("anti-blood sugar", "blood sugar regulation", "pengawalan gula darah", "pengurusan paras gula", "supports pancreatic health", "anti-inflammatory", "improve lipid metabolism", detox, immunity, cure, rawat, sembuh), guaranteed / absolute / unverifiable claims ("100%", "No.1", "top rated", "pertama di Malaysia", "clinically proven", "doctor recommended", "no side effects", "guaranteed"), weight-loss / body claims, before-after. KEEP (do not tape): brand names, neutral product-type words ("patch", "transdermal", "cream"), ingredient names without an effect claim, quantity / size, "Made in Korea", price, shipping / COD / ready-stock badges, usage directions, logos, unrelated background text. OCR text may lack spaces or have typos — judge the meaning; fragments of a risky line are risky.
Answer ONLY JSON: {"risky": [indices]}`;

/** Printed-text compliance pass (OCR lines from video frames / images). */
export async function guardClassify(opts: { kind: string; texts: string[]; product?: string }): Promise<{ risky: number[] } | null> {
  const texts = opts.texts.slice(0, 200);
  if (!texts.length) return { risky: [] };
  const r = await orChat({
    modelKey: "model_motion_guard",
    systemPrompt: CLASSIFY_SYSTEM,
    userPrompt: (opts.product ? `SELLER CONTEXT: ${String(opts.product).slice(0, 300)}\n` : "") +
      `SOURCE: ${opts.kind}\n\nOCR LINES:\n${texts.map((t, k) => `${k}: ${t}`).join("\n")}\n\nJSON only.`,
    temperature: 0,
    maxTokens: 1200,
    timeoutMs: 45_000,
    hedgeAfterMs: GUARD_HEDGE_MS,
    stream: true,
  });
  if (!r.ok || !r.content) return null;
  const j = parseJson(r.content);
  return j ? { risky: ints(j.risky, texts.length) } : null;
}

/** Buat Iklan: risk-rate the product from the brief (pre-flight warning). */
export async function guardProductRisk(brief: string): Promise<ProductRisk | null> {
  const r = await orChat({
    modelKey: "model_motion_guard",
    systemPrompt: `You are a TikTok Shop Malaysia compliance reviewer. ${RISK_RULE}\nAnswer ONLY JSON: {"risk": {...}}`,
    userPrompt: `PRODUCT BRIEF:\n${brief.slice(0, 1800)}\n\nJSON only.`,
    temperature: 0,
    maxTokens: 300,
    timeoutMs: 30_000,
    hedgeAfterMs: GUARD_HEDGE_MS,
    stream: true,
  }).catch(() => null);
  const j = r?.ok && r.content ? parseJson(r.content) : null;
  return cleanRisk(j?.risk);
}

const REWRITE_SYSTEM = `You fix on-screen copy / voice-over lines for a Malaysian TikTok Shop video so it passes TikTok Shop Malaysia's 2026 content review and Malaysian ad law. For each input string return a compliant version in the SAME language and style, about the same length (never longer), keeping the selling energy — or null when it can't be saved. REMOVE the claim, never disguise it: no disease names, no medical / cure / treat / control / "bantu" + condition claims, NO euphemisms ("gula", "sugar level", "bacaan") for a health claim, no guaranteed / absolute / timeframe results, no superlatives (No.1, terbaik, pertama, termurah), no doctor / approval claims, no weight-loss numbers. Keep brand names (drop medical words from them), prices, how-to-use, convenience, texture, routine, the seller's personal experience framed as personal.
Answer ONLY JSON: {"out": [string | null, ...]} in the same order.`;

/** Rewrite risky strings (one LLM call). null = drop it. */
export async function guardRewrite(texts: string[], product?: string): Promise<(string | null)[]> {
  if (!texts.length) return [];
  const r = await orChat({
    modelKey: "model_motion_guard",
    systemPrompt: REWRITE_SYSTEM,
    userPrompt: (product ? `PRODUCT: ${String(product).slice(0, 200)}\n` : "") + JSON.stringify({ in: texts }),
    temperature: 0.3,
    maxTokens: 2000,
    timeoutMs: 40_000,
    hedgeAfterMs: GUARD_HEDGE_MS,
    stream: true,
  }).catch(() => null);
  const j = r?.ok && r.content ? parseJson(r.content) : null;
  const out: any[] = Array.isArray(j?.out) ? j.out : [];
  return texts.map((t, k) => {
    const v = typeof out[k] === "string" ? out[k].replace(/\s+/g, " ").trim().slice(0, Math.max(8, t.length + 6)) : null;
    return v && guardHits(v).length === 0 ? v : null; // still risky → drop
  });
}

/** Rewrite every slot whose text hits a rule (one call); returns how many. */
export async function guardFixSlots(slots: { text: string; set: (v: string | null) => void }[], product?: string): Promise<number> {
  const bad = slots.filter((s) => guardHits(s.text).length > 0);
  if (!bad.length) return 0;
  const fixed = await guardRewrite(bad.map((s) => s.text), product);
  bad.forEach((s, k) => s.set(fixed[k]));
  return bad.length;
}
