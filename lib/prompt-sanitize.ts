// Veo prompt sanitiser. Strips the known-hostile patterns that cause
// Veo's audio-generation step to fail with "The Google model was unable
// to generate audio for this request. Please try a different prompt."
//
// Applied at the video cascade level so every fire (initial + Resubmit)
// gets the same clean prompt — Veo never sees the raw master-plan
// output that contains timestamp markers and em-dashes inside dialog.

export function sanitisePromptForVeo(prompt: string): string {
  let p = prompt;

  // 1. Template-leak text — "CTA LINE HERE:" / "[DIALOG HERE]" that the
  //    LLM left behind because the master plan didn't substitute them.
  //    Veo's TTS reads these as actual dialog otherwise.
  p = p.replace(/\bCTA LINE HERE:\s*/gi, "");
  p = p.replace(/\[?\s*DIALOG (PLACEHOLDER|HERE)\s*\]?:\s*/gi, "");

  // 2. Strip "0-2s:" / "2-6s:" / "6-8s:" timestamp markers (any dash type
  //    — hyphen, en-dash, em-dash). The dialog flow stays intact via the
  //    surrounding line breaks; the timestamps are meta-instructions Veo
  //    must not speak.
  p = p.replace(/\b\d+\s*[-–—]\s*\d+\s*s\s*:\s*/gi, " ");

  // 3. Beat markers in square brackets — "[0–2s — Attention]" / "[Hook]".
  //    The framework skills emit these into the master plan; Veo can read
  //    them as on-screen captions or speak them as voice-over.
  p = p.replace(/\[\s*\d+\s*[-–—]\s*\d+\s*s\s*[—–-]?\s*[A-Za-z ]+\s*\]/g, "");
  p = p.replace(/\*\*\s*\d+\s*[-–—]\s*\d+\s*s\s*[—–-]?\s*[A-Za-z ]+\s*:\s*\*\*/g, "");

  // 4. Em-dash and en-dash inside QUOTED dialog → comma. Veo's TTS reads
  //    "—" as a long pause / non-word and frequently fails on it.
  //    Only targets dashes between letters inside quotes, so the "—"
  //    used to separate prompt sections (outside quotes) survives.
  p = p.replace(/(["'])([^"']{0,400}?)\1/g, (_m, q, body) =>
    q + body.replace(/\s*[—–]\s*/g, ", ") + q
  );

  // 5. Number+unit abbreviations — TTS chokes on "1.3KG" tight kerning.
  p = p.replace(/(\d+(?:\.\d+)?)\s*(KG|kg)\b/g, "$1 kilogram");
  p = p.replace(/(\d+(?:\.\d+)?)\s*(ML|ml)\b/g, "$1 mililiter");
  p = p.replace(/(\d+(?:\.\d+)?)\s*(MG|mg)\b/g, "$1 miligram");
  p = p.replace(/\bCOD\b/g, "cash on delivery");
  p = p.replace(/\bDM\b/g, "direct message");

  // 6. Trim runaway whitespace from the substitutions above
  p = p.replace(/[ \t]{2,}/g, " ").replace(/\n[ \t]+/g, "\n");

  return p;
}
