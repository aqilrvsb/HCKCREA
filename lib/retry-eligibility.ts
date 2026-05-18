// Single source of truth for "is this failure an internal-server-class
// error that should be retried automatically AND shown on the admin
// errors page?". Used by:
//
//   • lib/settle.ts                          (event-driven retry gate)
//   • app/api/worker/auto-resubmit/route.ts  (cron retry gate)
//   • app/api/admin/errors/route.ts          (admin feed filter)
//   • app/api/history/retry/route.ts         (manual + bulk Resubmit gate)
//
// All four call sites MUST agree: anything that's not an internal-server
// error is treated as a permanent failure (content moderation, audio
// gen, content-safety, rate-limit, validator, auth, etc.). The user
// sees those on their own dashboard and fixes the underlying issue
// (rewrite prompt, etc.) — they aren't admin-actionable and re-firing
// the same row won't help.
//
// Per user direction: "all the logic resubmit is...only for internal
// error...and at admin error also only show internal error".

const INTERNAL_ERROR_PATTERNS: RegExp[] = [
  // HTTP 5xx wording variants
  /internal server/i,
  /\binternal\b/i,
  /\b50[0234]\b/,
  /service internal exception/i,
  // Generic "try again" fallbacks providers return on transient 5xx
  /please try again later/i,
  /try again later/i,
  // Bare upstream timeouts surfaced as "Generation failed" with no body
  /^generation failed$/i,
  // Unknown error with the support-contact phrasing some providers use
  /unknown error\.\s*please contact support/i,
];

export function isInternalError(err: string | null | undefined): boolean {
  if (!err) return false;
  return INTERNAL_ERROR_PATTERNS.some((re) => re.test(err));
}
