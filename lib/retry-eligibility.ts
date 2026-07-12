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
  // 5. (REMOVED 2026-06-30 per user direction) Safety / content-filter
  //    rejections — e.g. "attempt1: Detected explicit content in the
  //    prompt. Please modify your prompt and try again." — are NO LONGER
  //    retryable. This is a PROMPT-content problem: re-firing the same
  //    prompt (even on another slot) won't fix it, the user must edit the
  //    prompt. So it is excluded from auto-resubmit, event-driven retry,
  //    the fallback cascade, AND the admin Errors feed. (Patterns removed:
  //    /detected explicit content/, /content filter|moderation/,
  //    /safety classifier blocked/.)
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
  // 7. PROVIDER-slot "Insufficient Credits" — the slot's UPSTREAM account
  //    (APIPod/Crun key) ran out of credits, so it rejects pre-queue (no
  //    task created). Each slot/key has its OWN balance, so rotating to a
  //    different slot CAN recover — same rotation logic as rate-limit (#3)
  //    and the safety-filter class (#5).
  //
  //    🚨 MUST be provider-side, NOT the client's PeningLab balance. The
  //    cascade prefixes every provider attempt with "attempt<n>:" (see
  //    lib/video-cascade.ts), so we REQUIRE that prefix. The client-balance
  //    error is a bare "Insufficient credits" returned pre-flight (HTTP 402,
  //    no history row) by the MCP routes — it never carries "attempt<n>:"
  //    and never reaches a history error_message, so it can never match
  //    here. Real provider phrasing: "attempt1: Insufficient Credits".
  //    Added per user direction 2026-06-13.
  /attempt\s*\d+\s*:[^\n]*insufficient credits/i,
  // 8. PROVIDER-slot "Insufficient balance" (HTTP 402) — same class as #7 but
  //    some providers phrase the out-of-funds rejection as "Insufficient
  //    balance" instead of "Insufficient Credits". This is OUR upstream
  //    provider API account running dry (e.g. admin didn't top up the key),
  //    NOT the client's PeningLab balance — the client error is a pre-flight
  //    bare 402 that never reaches a history error_message, and no code path
  //    writes the literal "insufficient balance" string for a client. Each
  //    provider slot/key has its OWN balance, so rotating to a funded slot
  //    CAN recover → eligible for fallback cascade + event-driven retry +
  //    auto-resubmit cron, and shown on the admin Errors feed.
  //    Real phrasing: 'attempt1: API error (status 402): {"status":"FAILED",
  //    "message":"Insufficient balance in TT API.","data":null}'.
  //    Added per user direction 2026-06-19.
  /attempt\s*\d+\s*:[^\n]*insufficient balance/i,
  /insufficient balance[^\n]{0,30}api/i,
  // 9. Provider param/type validation rejection (APIPod): "Missing Params or
  //    Type Error". Same rotation-recoverable class as the schema validator
  //    (#4) — a different slot/model in the pool accepts. Also un-sticks rows
  //    that hit our own past mis-routing (a grok row sent to the Veo pool),
  //    which now route correctly through the grok cascade. Added 2026-06-19.
  /missing param/i,
  // 10. Provider gateway / 5xx timeout — APIPod (Cloudflare-fronted) returns
  //     "HTTP 524" (origin timeout) or other 5xx when the upstream model
  //     server is slow/overloaded. The task was rejected PRE-QUEUE (no task
  //     created upstream), so nothing is in flight to double-charge — a clean
  //     rotation to another slot/key regenerates fine. Covers 500/502/503/504
  //     and Cloudflare's 520-527 family. Real phrasing observed:
  //       • APIPod: "attempt1: APIPod HTTP 524"
  //     Added per user direction 2026-06-29.
  /\bhttp\s*5\d{2}\b/i,
  /\b52[0-7]\b/,
  // 11. Generic provider transient reject — APIPod sometimes rejects pre-queue
  //     with a bare "An error occurred. Please retry or contact support." It
  //     literally asks to retry, and (like #524 above) no task was created,
  //     so rotating to another slot recovers. Real phrasing observed:
  //       • APIPod: "attempt1: An error occurred. Please retry or contact support."
  //     Added per user direction 2026-06-29.
  /an error occurred[^\n]{0,40}(?:please retry|contact support|please contact)/i,
  // 12. Provider routing / channel-pool errors — APIPod / Crun return
  //     "(status 503)" with "fail_to_fetch_task" / "No available channel"
  //     when their upstream channel pool is momentarily exhausted or the
  //     task lookup misses. Rejected pre-queue (no task created), transient,
  //     rotation-recoverable → eligible for fallback cascade + event-driven
  //     retry + auto-resubmit cron, and shown on the admin Errors feed.
  //     Real phrasing observed (GeminiOmni · p6):
  //       'API error (status 503): {"code":"fail_to_fetch_task",
  //        "message":"...not_found...","message":"No available channel for ..."}'
  //     Added per user direction 2026-06-30.
  /\bstatus\s*5\d{2}\b/i,
  /fail_to_fetch_task/i,
  /no available channel/i,
  // 13. Poll timeout — the task WAS accepted upstream but never finished
  //     within our polling window ("Video generation timed out after
  //     polling"). The provider was slow/stuck on that slot; abandoning it
  //     and firing a fresh attempt (event-driven retry / fallback cascade /
  //     auto-resubmit cron) on another slot usually completes. Also shown on
  //     the admin Errors feed. Added per user direction 2026-06-30.
  /timed out after polling/i,
  /generation timed out/i,
  // 14. Hard task timeout — the row exceeded the max wait window without
  //     the provider ever returning a result ("Task timeout after 1h0m0s").
  //     Same class as the poll timeout above: abandon the stuck task and
  //     fire a fresh attempt (event-driven retry / fallback cascade /
  //     auto-resubmit cron); also shown in admin Errors. Added 2026-06-30.
  /task timeout/i,
  // 15. Provider content-REVIEW rejection ("This request didn't pass
  //     content review"). Different from the hard "Detected explicit
  //     content in the prompt" reject (removed above): this provider-side
  //     review is inconsistent across slots/keys — a different slot/key
  //     often passes the same request — so it's rotation-recoverable →
  //     eligible for event-driven retry / fallback cascade / auto-resubmit
  //     cron, and shown in admin Errors. Added per user direction 2026-06-30.
  //     NOTE: "content review" (not the word "content" alone) keeps this
  //     scoped so it does NOT re-enable the explicit-content prompt reject.
  /content review/i,
  // 16. Flagged reference IMAGE — APIPod rejects a create when one of the
  //     reference images was previously flagged by content policy:
  //     "Reference upload failed: image reference 1 blocked: this image was
  //     previously flagged by content policy (md5=…)". The block is per-image
  //     and permanent (md5-based), so slot rotation can't recover — BUT the
  //     retry paths recover by DROPPING that specific image and re-firing
  //     without it (see dropFlaggedImage). Marked retryable so the automatic
  //     cascade/fallback + event-driven retry + auto-resubmit cron all self-
  //     heal, not just the manual Resubmit button. Scoped to the flagged-image
  //     wording so it does NOT re-enable the prompt explicit-content reject.
  //     Added per user direction 2026-07-12.
  /image reference\s+\d+\s+blocked/i,
  /previously flagged by content policy/i,
  // NOTE: an oversized reference video ("video reference N too large … maximum
  //     is 8.0MB") is deliberately NOT retryable — every slot enforces the same
  //     8MB cap so re-firing the same source can't recover. It's prevented at
  //     the source instead: uploads are shrunk client-side (<8MB) and oversized
  //     pasted URLs are rejected at submit, so the stored videoRef always fits.
];

// dropFlaggedImage — given an APIPod "image reference N blocked / previously
// flagged by content policy" error and the reference-image list, return the
// list with the flagged image removed. The 1-based index is parsed from the
// message; when absent, the FIRST image is dropped (per user direction).
// Returns null when the error isn't a flagged-image block or there's nothing
// to drop, so callers can leave the list untouched.
export function isFlaggedImageError(msg: string | null | undefined): boolean {
  const s = String(msg || "");
  return /image reference\s+\d+\s+blocked/i.test(s) || /previously flagged by content policy/i.test(s);
}

export function dropFlaggedImage(
  msg: string | null | undefined,
  imageUrls: string[]
): { urls: string[]; dropped: string; index: number } | null {
  if (!imageUrls || imageUrls.length === 0) return null;
  if (!isFlaggedImageError(msg)) return null;
  const m = String(msg).match(/image reference\s+(\d+)/i);
  const index = m ? parseInt(m[1], 10) - 1 : 0; // 1-based → 0-based; default first
  if (index < 0 || index >= imageUrls.length) return null;
  const dropped = imageUrls[index];
  return { urls: imageUrls.filter((_, i) => i !== index), dropped, index };
}

export function isInternalError(err: string | null | undefined): boolean {
  if (!err) return false;
  return RETRYABLE_ERROR_PATTERNS.some((re) => re.test(err));
}
