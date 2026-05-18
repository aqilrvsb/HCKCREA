// Single source of truth for "is this failure retryable?". Used by:
//
//   • lib/settle.ts                          (event-driven retry gate)
//   • app/api/worker/auto-resubmit/route.ts  (cron retry gate)
//   • app/api/admin/errors/route.ts          (admin feed filter)
//   • app/api/history/retry/route.ts         (manual + bulk Resubmit gate)
//
// Per user direction: the ONLY four error categories that qualify for
// retry / admin visibility are:
//
//   1. "Internal Error, Please try again later."     (5xx-class)
//   2. "Unknown error. Please contact support."      (provider-side)
//   3. "Rate limited / too many requests"            (429-class — different
//                                                     slot has separate
//                                                     quota, so rotation
//                                                     CAN recover)
//   4. "CUE validator failed"                        (Crun's prompt-schema
//                                                     validator — different
//                                                     slot uses different
//                                                     validator config, so
//                                                     rotation CAN recover)
//
// Everything else — content moderation, audio-gen, prompt-unsafe, auth,
// etc. — is a permanent failure as far as the system is concerned. User
// resolves on their own dashboard (edit prompt) and never appears on
// the admin errors page.

const RETRYABLE_ERROR_PATTERNS: RegExp[] = [
  // 1. "Internal Error, Please try again later" — allow flexible
  //    separator/casing/trailing text (".", ", ", " — ", etc.).
  /internal error[^\n]{0,20}please try again/i,
  // 2. "Unknown error. Please contact support" — same flexibility.
  /unknown error[^\n]{0,20}please contact support/i,
  // 3. Rate limit — covers "rate limit", "rate-limited", "Rate limited",
  //    "too many requests", and bare HTTP 429.
  /rate[\s-]?limit/i,
  /too many requests/i,
  /\b429\b/,
  // 4. CUE validator / prompt-schema validator — both Crun.ai and APIPod
  //    run schema validators against the prompt. Different slot runs a
  //    different validator instance with different config, so rotating
  //    CAN recover (e.g., p6 CUE rejects → p5 APIMart accepts).
  //
  //    Real production phrasings observed:
  //      • Crun: "CUE validator failed: ..."
  //      • APIPod: "attempt1: validation failed: #/Validators.\"veo3-1-fast-ref\".prompt: invalid value ..."
  //
  //    Patterns cover both literal "cue validator" AND APIPod's
  //    "#/Validators.\"<model>\"" + "validation failed: invalid value"
  //    formats so event-driven retry fires for either provider's reject.
  /cue validator/i,
  /#\/validators\./i,
  /validation failed.*invalid value/i,
];

export function isInternalError(err: string | null | undefined): boolean {
  if (!err) return false;
  return RETRYABLE_ERROR_PATTERNS.some((re) => re.test(err));
}
