// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/badges/svgEscape.ts
 * WHAT: Strict XML/SVG text escaping.
 * WHY: All names rendered into SVG come from Discord and could contain
 *      &, <, >, ", ', or control characters. We must never inject raw
 *      input into SVG. No HTML, no scripts, no foreign content.
 */

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function svgEscape(input: string): string {
  if (typeof input !== "string") return "";
  // Strip control chars except tab/newline/CR; XML 1.0 forbids most C0 codes.
  const cleaned = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return cleaned.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c] ?? c);
}

/**
 * Sanitize a badge id for use as a filesystem name and URL segment.
 * Allows lowercase ASCII, digits, underscore, dash. 1..64 chars.
 */
export function isSafeBadgeId(id: string): boolean {
  return typeof id === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id);
}
