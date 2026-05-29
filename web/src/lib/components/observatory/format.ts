/**
 * SSR-safe formatting helpers for the Observatory page. No locale APIs (which
 * vary by server locale): thousands grouping is done with a regex, matching the
 * existing pulse.ts approach.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

export function fmtInt(n: number | null | undefined): string {
  if (n == null) return "n/a";
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function fmtSignedInt(n: number | null | undefined): string {
  if (n == null) return "n/a";
  const rounded = Math.round(n);
  return (rounded >= 0 ? "+" : "") + fmtInt(rounded);
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null) return "n/a";
  return `${n}%`;
}

export function fmtSignedPct(n: number | null | undefined): string {
  if (n == null) return "n/a";
  return `${n >= 0 ? "+" : ""}${n}%`;
}

/** Seconds to a compact human duration: 45s, 4m, 3h 12m, 2d 4h. */
export function fmtDurationS(s: number | null | undefined): string {
  if (s == null) return "n/a";
  const sec = Math.round(s);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  const remMin = min % 60;
  if (hours < 24) return remMin ? `${hours}h ${remMin}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

/** Short minutes label: 540 -> "9h 0m" style for voice totals. */
export function fmtMinutes(min: number | null | undefined): string {
  if (min == null) return "n/a";
  return fmtDurationS(min * 60);
}

/** 'YYYY-MM-DD' to a short 'Mon D' label (UTC, no locale). */
export function fmtDayShort(day: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const parts = day.split("-");
  if (parts.length !== 3) return day;
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!m || !d) return day;
  return `${months[m - 1]} ${d}`;
}
