// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/badges/color.ts
 * WHAT: Color helpers used by the badge renderer.
 * WHY: Discord roles supply a 24-bit color; we need a readable text color
 *      and a tinted background that resembles a Discord mention pill.
 */

export const DISCORD_BLURPLE = "#5865F2";
export const DISCORD_DARK_BG = "#2B2D31";
export const DISCORD_TEXT_LIGHT = "#FFFFFF";
export const DISCORD_TEXT_DARK = "#0D0D0D";
export const DISCORD_NEUTRAL_PILL = "#404249";
export const DISCORD_STALE = "#6E6E6E";

export function intToHex(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DISCORD_BLURPLE;
  }
  const clamped = Math.max(0, Math.min(0xffffff, Math.floor(value)));
  return "#" + clamped.toString(16).padStart(6, "0").toUpperCase();
}

export function normalizeHex(hex: string | undefined | null): string {
  if (!hex) return DISCORD_BLURPLE;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return DISCORD_BLURPLE;
  return "#" + m[1].toUpperCase();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = normalizeHex(hex).slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

/**
 * Pick a readable text color (white or near-black) based on background.
 * Uses sRGB luminance with a 0.55 cutoff; matches Discord's behavior closely.
 */
export function readableTextOn(hex: string): string {
  return relativeLuminance(hex) > 0.55 ? DISCORD_TEXT_DARK : DISCORD_TEXT_LIGHT;
}

/**
 * Tint a role color into a translucent-looking pill background by blending
 * the role color toward Discord's dark background. We render an opaque hex
 * because GitHub's image proxy can be picky about alpha.
 */
export function tintForPill(hex: string, mix = 0.25): string {
  const fg = hexToRgb(normalizeHex(hex));
  const bg = hexToRgb(DISCORD_DARK_BG);
  const r = Math.round(fg.r * mix + bg.r * (1 - mix));
  const g = Math.round(fg.g * mix + bg.g * (1 - mix));
  const b = Math.round(fg.b * mix + bg.b * (1 - mix));
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

/**
 * Foreground accent for a role pill: the role color itself, lightened a touch
 * if very dark so the @ glyph and name stay legible.
 */
export function accentForRole(hex: string): string {
  const norm = normalizeHex(hex);
  const lum = relativeLuminance(norm);
  if (lum < 0.05) return "#B5B7BD";
  return norm;
}
