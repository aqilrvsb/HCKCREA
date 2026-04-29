// Date helpers — local-time formatters used across admin filters.
//
// CRITICAL: never use Date.toISOString() for user-facing date strings.
// toISOString converts to UTC, which off-by-ones any Malaysian midnight
// (UTC+8 → UTC strips 8 hours, so 1 Apr 00:00 local renders as
// 31 Mar 16:00 UTC, and slice(0, 10) returns the wrong day). The admin
// date filters were showing "31-Mar" when the real local "Start of
// month" was 1 Apr because of exactly this bug.
//
// Use localDateStr() for any "yyyy-mm-dd" string sent to a <input type="date">
// or used as a server-side filter boundary. The helper reads the user's
// local-clock fields directly so it always produces the wall-clock date
// the user sees on their screen.

export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// First day of the month containing `d` (local time).
export function startOfMonthLocal(d: Date = new Date()): string {
  return localDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
}
