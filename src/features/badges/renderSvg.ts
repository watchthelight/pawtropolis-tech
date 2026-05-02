// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/badges/renderSvg.ts
 * WHAT: Render a ResolvedBadge as a self-contained Discord-style SVG pill.
 *       Supports flat color, two/three-stop gradient roles, and the
 *       holographic animation Discord uses for the Holographic role effect.
 * WHY: GitHub embeds SVG via <img> but blocks scripts and external fonts.
 *      We use system fonts, deterministic widths, and SMIL animation
 *      (declarative; no scripts) for the holographic shimmer.
 *
 * Vertical alignment: GitHub renders <img> with vertical-align: baseline
 * by default, putting the image's bottom edge on the text baseline. To
 * make the visible pill sit centered on the text x-height instead, we
 * extend the SVG height with transparent bottom padding, shifting the
 * pill upward relative to the baseline.
 */

import { svgEscape } from "./svgEscape.js";
import {
  DISCORD_BLURPLE,
  DISCORD_DARK_BG,
  DISCORD_NEUTRAL_PILL,
  DISCORD_STALE,
  accentForRole,
  normalizeHex,
  readableTextOn,
  tintForPill,
} from "./color.js";
import type { ResolvedBadge } from "./types.js";

const FONT_FAMILY =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const FONT_SIZE_PX = 13;
const PILL_HEIGHT = 20;
// GitHub's markdown CSS applies vertical-align: middle to inline images, so
// the image's vertical center aligns with the text x-height midline (also
// where bullet markers sit). Keeping SVG height equal to pill height puts
// the visible pill center exactly at the image center -> perfect alignment.
const SVG_HEIGHT = PILL_HEIGHT;
const PADDING_X = 8;
const SUFFIX_GAP = 6;
const SEPARATOR_PADDING = 6;

// Per-char advance widths for system-ui 13px weight 600. Uppercase, "m",
// and "w" are visibly wider; digits/lowercase mid are average; "i", "l",
// "t" are narrower. Tuned by measuring rendered widths of the staff role
// names ("Community Development Lead", "Senior Administrator") and adding
// a small safety margin so text never clips inside the pill.
const NARROW_CHARS = new Set(["i", "l", "t", "I", "j", "f", "r", " "]);
const WIDE_CHARS = new Set([
  "m", "w", "M", "W", "G", "Q", "C", "D", "O", "U", "&", "@",
]);

function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x800) return 15;
  if (code >= 0x80) return 10.5;
  if (NARROW_CHARS.has(ch)) return 5;
  if (WIDE_CHARS.has(ch)) return 10.5;
  if (ch >= "A" && ch <= "Z") return 9.5;
  if (ch >= "0" && ch <= "9") return 7.8;
  return 7.8;
}

function estimateTextWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch);
  // Add 4px safety so the trailing glyph never clips when the browser font
  // metrics differ from our estimator.
  return Math.ceil(w + 4);
}

function gradientStops(badge: ResolvedBadge): string[] {
  const g = badge.gradient;
  if (!g) return [];
  const out = [normalizeHex(g.primary), normalizeHex(g.secondary)];
  if (g.tertiary) out.push(normalizeHex(g.tertiary));
  return out;
}

function defsForFill(
  badge: ResolvedBadge,
  fillId: string,
  textGradId: string,
  isStale: boolean,
): { defs: string; pillFill: string; textFill: string | null } {
  if (isStale) {
    return { defs: "", pillFill: DISCORD_NEUTRAL_PILL, textFill: null };
  }
  const stops = gradientStops(badge);
  if (stops.length >= 2) {
    // Build pill background from tinted stops (same blend used for flat colors)
    const tintedStops = stops.map((s) => tintForPill(s, 0.32));
    const pillStops = tintedStops
      .map((c, i) => {
        const offset = (i / (tintedStops.length - 1)) * 100;
        return `<stop offset="${offset}%" stop-color="${c}"/>`;
      })
      .join("");
    // Text gradient uses the original (un-tinted) accent stops for vibrancy
    const textStops = stops
      .map((c, i) => {
        const offset = (i / (stops.length - 1)) * 100;
        return `<stop offset="${offset}%" stop-color="${c}"/>`;
      })
      .join("");

    let animations = "";
    if (badge.holographic) {
      // Holographic shimmer: rotate the gradient direction continuously,
      // and shift the stops along the spectrum. Discord uses a similar
      // hue-rotation; we approximate with x1/x2 panning and stop drift.
      animations = `
        <animate attributeName="x1" values="0%;-50%;0%" dur="3s" repeatCount="indefinite"/>
        <animate attributeName="x2" values="100%;150%;100%" dur="3s" repeatCount="indefinite"/>
      `;
    }

    return {
      defs: `<defs>
        <linearGradient id="${fillId}" x1="0%" y1="0%" x2="100%" y2="0%">${animations}${pillStops}</linearGradient>
        <linearGradient id="${textGradId}" x1="0%" y1="0%" x2="100%" y2="0%">${animations}${textStops}</linearGradient>
      </defs>`,
      pillFill: `url(#${fillId})`,
      textFill: `url(#${textGradId})`,
    };
  }
  return { defs: "", pillFill: "", textFill: null };
}

export function renderBadgeSvg(badge: ResolvedBadge): string {
  const isStale = badge.stale;
  const prefix = badge.prefix;
  const name = badge.displayName || `unknown ${badge.kind}`;
  const suffix = badge.suffix?.trim() || "";

  // Default flat colors
  let pillBg: string;
  let mainColor: string;

  if (isStale) {
    pillBg = DISCORD_NEUTRAL_PILL;
    mainColor = DISCORD_STALE;
  } else if (badge.kind === "role") {
    const hasColor = !!badge.colorHex;
    if (hasColor) {
      const accent = accentForRole(badge.colorHex);
      pillBg = tintForPill(accent, 0.28);
      mainColor = accent;
    } else {
      // No Discord color set: render as neutral pill matching Discord's
      // default mention appearance (light text on dark grey).
      pillBg = DISCORD_NEUTRAL_PILL;
      mainColor = "#DCDDDE";
    }
  } else if (badge.kind === "channel") {
    pillBg = DISCORD_NEUTRAL_PILL;
    mainColor = "#C9CDD3";
  } else if (badge.kind === "user") {
    pillBg = DISCORD_NEUTRAL_PILL;
    mainColor = "#DCDDDE";
  } else {
    const accent = accentForRole(badge.colorHex || DISCORD_BLURPLE);
    pillBg = tintForPill(accent, 0.32);
    mainColor = readableTextOn(pillBg);
  }

  // Derive a stable id suffix from the badge id so multiple badges on the
  // same page do not collide on linearGradient ids.
  const safeIdSuffix = (badge.id || "x").replace(/[^a-z0-9_-]/gi, "");
  const fillId = `bg-${safeIdSuffix}`;
  const textGradId = `tx-${safeIdSuffix}`;
  const { defs, pillFill, textFill } = defsForFill(
    badge,
    fillId,
    textGradId,
    isStale,
  );
  if (pillFill) pillBg = pillFill;
  if (textFill) mainColor = textFill;

  const mainText = `${prefix}${name}`;
  const escapedMain = svgEscape(mainText);
  const escapedSuffix = svgEscape(suffix);

  const mainWidth = estimateTextWidth(mainText);
  let suffixWidth = 0;
  let separatorWidth = 0;
  if (suffix) {
    suffixWidth = estimateTextWidth(suffix);
    separatorWidth = SEPARATOR_PADDING * 2 + 1;
  }

  const innerWidth =
    mainWidth + (suffix ? SUFFIX_GAP + separatorWidth + suffixWidth : 0);
  const totalWidth = innerWidth + PADDING_X * 2;
  const radius = PILL_HEIGHT / 2;

  const titleText = svgEscape(
    suffix ? `${prefix}${name} - ${suffix}` : `${prefix}${name}`,
  );
  const descText = svgEscape(
    isStale
      ? `Discord ${badge.kind} (stale cache); resolved at ${badge.resolvedAt}`
      : `Discord ${badge.kind}; resolved at ${badge.resolvedAt}`,
  );

  const mainTextX = PADDING_X;
  const sepX = mainTextX + mainWidth + SUFFIX_GAP;
  const suffixTextX = sepX + separatorWidth;

  const suffixColor = isStale ? DISCORD_STALE : "#9DA3A8";

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${SVG_HEIGHT}" viewBox="0 0 ${totalWidth} ${SVG_HEIGHT}" role="img" aria-label="${titleText}">`,
  );
  parts.push(`<title>${titleText}</title>`);
  parts.push(`<desc>${descText}</desc>`);
  if (defs) parts.push(defs);
  parts.push(
    `<rect x="0" y="0" width="${totalWidth}" height="${PILL_HEIGHT}" rx="${radius}" ry="${radius}" fill="${pillBg}"/>`,
  );
  parts.push(
    `<text x="${mainTextX}" y="14" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE_PX}" font-weight="600" fill="${mainColor}" text-rendering="geometricPrecision">${escapedMain}</text>`,
  );
  if (suffix) {
    parts.push(
      `<rect x="${sepX + SEPARATOR_PADDING}" y="5" width="1" height="${PILL_HEIGHT - 10}" fill="${suffixColor}" opacity="0.5"/>`,
    );
    parts.push(
      `<text x="${suffixTextX}" y="14" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE_PX}" font-weight="400" fill="${suffixColor}" text-rendering="geometricPrecision">${escapedSuffix}</text>`,
    );
  }
  parts.push(`</svg>`);
  return parts.join("");
}

/**
 * Fallback SVG used when we have no manifest entry at all. Kept tiny.
 */
export function renderUnknownBadgeSvg(label = "unknown badge"): string {
  const safe = svgEscape(label);
  const width = PADDING_X * 2 + estimateTextWidth(label);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${SVG_HEIGHT}" viewBox="0 0 ${width} ${SVG_HEIGHT}" role="img" aria-label="${safe}">`,
    `<title>${safe}</title>`,
    `<desc>Pawtropolis Tech badge fallback</desc>`,
    `<rect x="0" y="0" width="${width}" height="${PILL_HEIGHT}" rx="${PILL_HEIGHT / 2}" ry="${PILL_HEIGHT / 2}" fill="${DISCORD_NEUTRAL_PILL}"/>`,
    `<text x="${PADDING_X}" y="14" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE_PX}" fill="${DISCORD_STALE}">${safe}</text>`,
    `</svg>`,
  ].join("");
}

export const BADGE_HEIGHT = PILL_HEIGHT;
export const BADGE_FONT_FAMILY = FONT_FAMILY;
export { DISCORD_DARK_BG };
