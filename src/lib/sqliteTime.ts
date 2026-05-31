// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/lib/sqliteTime.ts
 * WHAT: Parse SQLite datetime('now') strings as the UTC instants they actually are.
 * WHY: SQLite's datetime('now') writes a UTC wall-clock string with no timezone
 *      marker, e.g. "2026-05-31 14:00:00". `new Date(...)` / Date.parse() interpret
 *      that space-separated form as LOCAL time, shifting it by the host's UTC offset
 *      (up to +/-14h) and breaking time-window comparisons against Date.now().
 */

/**
 * Parse a SQLite datetime('now')-style timestamp into epoch milliseconds (UTC).
 * Accepts already-ISO strings (with 'T' and/or trailing 'Z') unchanged.
 * Returns NaN for empty/invalid input.
 */
export function parseSqliteUtc(ts: string | null | undefined): number {
  if (!ts) return NaN;
  const trimmed = ts.trim();
  if (!trimmed) return NaN;
  // Already ISO-8601 (has a 'T' separator or an explicit zone) -> parse as-is.
  if (trimmed.includes("T") || /[zZ]|[+-]\d\d:?\d\d$/.test(trimmed)) {
    return Date.parse(trimmed);
  }
  // SQLite "YYYY-MM-DD HH:MM:SS" (UTC, no marker) -> make it explicit UTC.
  return Date.parse(trimmed.replace(" ", "T") + "Z");
}
