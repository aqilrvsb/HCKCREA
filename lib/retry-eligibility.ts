// Single source of truth for "is this failure retryable?". Used by:
//
//   • lib/settle.ts                          (event-driven retry gate)
//   • app/api/worker/auto-resubmit/route.ts  (cron retry gate)
//   • app/api/admin/errors/route.ts          (admin feed filter)
//   • app/api/history/retry/route.ts         (manual + bulk Resubmit gate)
//
// Per user direction (tightened): the ONLY two error categories that
// qualify for retry / admin visibility are:
//
//   1. "Internal Error, Please try again later."     (5xx-class)
//   2. "Unknown error. Please contact support."      (provider-side)
//
// Everything else — content moderation, audio-gen, rate-limit,
// validator, auth, prompt-unsafe, etc. — is a permanent failure as
// far as the system is concerned. User resolves on their own
// dashboard (edit prompt, wait out rate limit) and never appears on
// the admin errors page.

const RETRYABLE_ERROR_PATTERNS: RegExp[] = [
  // 1. "Internal Error, Please try again later" — allow flexible
  //    separator/casing/trailing text (".", ", ", " — ", etc.).
  /internal error[^\n]{0,20}please try again/i,
  // 2. "Unknown error. Please contact support" — same flexibility.
  /unknown error[^\n]{0,20}please contact support/i,
];

export function isInternalError(err: string | null | undefined): boolean {
  if (!err) return false;
  return RETRYABLE_ERROR_PATTERNS.some((re) => re.test(err));
}
