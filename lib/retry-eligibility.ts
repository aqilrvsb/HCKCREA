// Single source of truth for "is this failure retryable?". Used by:
//
//   • lib/settle.ts                          (event-driven retry gate)
//   • app/api/worker/auto-resubmit/route.ts  (cron retry gate)
//   • app/api/admin/errors/route.ts          (admin feed filter)
//   • app/api/history/retry/route.ts         (manual + bulk Resubmit gate)
//
// Per user direction: the ONLY error categories that qualify for retry /
// admin visibility are the patterns in RETRYABLE_ERROR_PATTERNS below
// (#6 "Job failed / Server exception ... please try again", #7
// "Insufficient Credits" — both rotation-recoverable across slots):
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
//   5. "Detected explicit content" / safety filter   (provider safety
//                                                     classifiers vary
//                                                     PER ACCOUNT KEY — a
//                                                     prompt rejected by
//                                                     p6-a frequently
//                                                     passes p6-b or p2,
//                                                     so rotation CAN
//                                                     recover. Empirical:
//                                                     ~130 of these per
//                                                     week across 4 users
//                                                     all hitting only
//                                                     p6-a. Added per
//                                                     user direction
//                                                     2026-06-08.)
//
// Everything else — audio-gen, prompt-unsafe, auth, etc. — is a permanent
// failure as far as the system is concerned. User resolves on their own
// dashboard (edit prompt) and never appears on the admin errors page.

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
  // 5. Safety / content-filter classifier rejections. Provider safety
  //    layers vary PER ACCOUNT KEY — a prompt that p6-a flags often
  //    sails through p6-b or p2. Same rotation-recovery logic as the
  //    CUE validator class above. Real production phrasings observed:
  //      • APIPod:  "attempt1: Detected explicit content in the prompt..."
  //      • Generic: "content filter triggered", "content moderation rejected"
  //      • Safety:  "safety classifier blocked"
  /detected (?:explicit|inappropriate|unsafe) content/i,
  /content[\s-]?(?:filter|moderation)/i,
  /safety[\s-]?(?:classifier|filter|check)[\s-]?(?:rejected|blocked|triggered|flagged)/i,
  // 6. Generic provider transient failure — the task WAS accepted (a
  //    task_id was created) then the provider failed the generation
  //    DOWNSTREAM and returned a "... please try again later" message that
  //    is NOT prefixed "Internal Error". Same recoverable class as #1:
  //    rotating to a different slot/key regenerates fine. Without this the
  //    rows show "Job failed, Please try again later" in the user's history
  //    but never reach the admin Errors feed, event-driven retry, or the
  //    auto-resubmit cron. Real production phrasings observed:
  //      • APIPod / RunningHub: "Job failed, Please try again later."
  //      • Crun:                "Server exception, please try again later."
  //    Added per user direction 2026-06-11.
  /job failed[^\n]{0,30}please try again/i,
  /server exception[^\n]{0,30}please try again/i,
  // 7. Provider-slot "Insufficient Credits" — the slot's UPSTREAM account
  //    (APIPod/Crun key) ran out of credits, so it rejects pre-queue (no
  //    task created). Each slot/key has its OWN credit balance, so
  //    rotating to a different slot CAN recover — same rotation logic as
  //    rate-limit (#3) and the safety-filter class (#5). Real phrasing:
  //    "attempt1: Insufficient Credits". Added per user direction 2026-06-13.
  /insufficient credits/i,
];

export function isInternalError(err: string | null | undefined): boolean {
  if (!err) return false;
  return RETRYABLE_ERROR_PATTERNS.some((re) => re.test(err));
}
