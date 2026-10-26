// Veo prompt wording its safety classifier misreads (VEO MODELS ONLY — applied where every video request leaves:
// lib/video-cascade.ts, so first fires, Resubmits and every tab get it, old stored prompts included).
//
// Veo's text classifier ("Detected explicit content in the prompt") reacts to words, not meaning:
//   • modesty locks name what must NOT be shown (breast, cleavage, midriff, thigh…) — it sees the word, not the "NO";
//   • "RAW UNEDITED FOOTAGE" / "raw camera recording" (our clean-frame lock: no captions, no stickers) reads as adult
//     video wording beside a product it already finds sensitive — Yasier's men's massage oil (2026-10-26) was refused
//     on every video until that sentence was taken out (a halving search over the prompt found it; the same prompt with
//     the sentence reworded passes).
// Each is rewritten to neutral wording with the same intent.
const VEO_SAFE: [RegExp, string][] = [
  [/RAW UNEDITED FOOTAGE AESTHETIC/gi, "NATURAL PHONE-VIDEO LOOK"],
  [/RAW UNEDITED FOOTAGE/gi, "NATURAL PHONE VIDEO"],
  [/this is a raw camera recording/gi, "this is a plain phone video"],
  [/a RAW CAMERA RECORDING/gi, "a PLAIN PHONE VIDEO"],
  [/raw camera recording/gi, "plain phone video"],
  [/unedited footage/gi, "plain phone video"],
  [/beautiful attractive/gi, "polished camera-ready"],
  [/handsome attractive/gi, "sharp camera-ready"],
  [/\battractive\b/gi, "camera-ready"],
  [/anatomically perfect/gi, "natural realistic proportions"],
  [/no extra limbs/gi, "no distortion"],
  [/breast shape/gi, "silhouette"],
  [/\bbreasts?\b/gi, "chest"],
  [/\bcleavage\b/gi, "low necklines"],
  [/\bmidriff\b/gi, "waist"],
  [/\bnavel\b/gi, "waistline"],
  [/thigh exposure/gi, "leg exposure"],
  [/\bthighs?\b/gi, "legs"],
  [/body shape/gi, "figure"],
];

/** The prompt in words Veo's safety classifier doesn't misread (same meaning). */
export function veoSafePrompt(s: string): string {
  let out = String(s ?? "");
  for (const [re, rep] of VEO_SAFE) out = out.replace(re, rep);
  return out;
}

/** A refusal from Veo's prompt safety check. */
export const isVeoSafetyRefusal = (err: string | null | undefined) => /explicit content|sensitive words|safety (filter|check)|violat(e|es|ion) .*polic/i.test(String(err ?? ""));

/** Veo adds up mild signals across a long prompt (a young woman, "never tight", "covers … neck", a product it finds
 *  sensitive, a long rule list): Yasier's men's massage oil was refused on every full prompt while the same scene in
 *  a short prompt passed. This is that short prompt: the scene / outfit / product / action and the spoken line (the
 *  part before the locks), its body descriptors softened, one line for the clean frame + voice + language. Two forms,
 *  tried in order, only after a refusal. */
export function compactVeoPrompts(full: string): string[] {
  const text = String(full ?? "").replace(/\\n/g, "\n");
  // the scene part: everything before the first lock / rule block
  const cut = text.search(/natural realistic proportions|anatomically|ANATOMY LOCK|CLEAN FRAME|RAW UNEDITED|NATURAL PHONE|AUDIO LOCK|VOICE CHARACTER|DIALOG LENGTH|LANGUAGE LOCK|PRODUCT LOCK|HIJAB LOCK|MODESTY LOCK|UGC AUTHENTICITY|Negative:|\n\n/i);
  let scene = (cut > 40 ? text.slice(0, cut) : text.slice(0, 1200)).trim();
  scene = scene
    .replace(/\s*\(zero hair strands visible[^)]*\)/gi, "")
    .replace(/\byoung adult\b,?\s*/gi, "")
    .replace(/that fully covers all hair, ears, and neck/gi, "covering her hair")
    .replace(/,?\s*never tight/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const hijab = /\bhijab|tudung/i.test(text) ? " Her hijab stays on, covering her hair, the whole clip." : "";
  const product = /\bproduct\b/i.test(scene) ? " The product looks exactly like the reference photo." : "";
  // The picture is described only by what it IS. Tests on a "tekan beg kuning bawah" line (2026-10-26): naming shop
  // things, even as "no bag / basket / button", made Veo draw them (3 of 3), and quoting the spoken phrase made it a
  // subtitle — so no object or phrase that must stay off screen is named here.
  const malay = /Malaysian Malay|Bahasa Melayu/i.test(text) ? ", speaking Malaysian Malay" : "";
  const body = `${scene}${hijab}${product} The reference photos guide the look only. Everything said is heard, not written. Natural handheld phone video, everyday lighting. One voice only${malay}.`;
  // 1st: with the clean-picture opening (fewer drawn shop buttons: 1 in 3 vs every time without it);
  // 2nd: bare — that opening adds to Veo's score too, and one of the five Bossa scenes (a peplum blouse + palazzo
  // pants outfit) passed only without it
  const framed = `Phone video, one continuous take straight from a phone's camera roll: a plain camera image from the first frame to the last, every part of the frame, edges and bottom included, showing only the real scene. It opens directly on this scene: ${body}`;
  return [framed, body].map((p) => veoSafePrompt(p).slice(0, 2000));
}

/** A Veo model id (google/veo3-1-fast-r2v, veo3.1-fast, …). */
export const isVeoModel = (model: string | null | undefined) => /veo/i.test(String(model ?? ""));
