// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/badges/renderSvg.ts
 * WHAT: Render a ResolvedBadge as a self-contained SVG pill.
 * WHY: GitHub embeds SVG via <img> but blocks <script>, external <image>,
 *      and remote fonts. We render system-font text and approximate text
 *      width with a per-character estimate so dimensions are deterministic
 *      and stable across machines.
 *
 * Visual targets:
 *   role:    @Name           or  @Name · suffix
 *   channel: #channel-name
 *   user:    @display
 *   custom:  configured label
 */

import { svgEscape } from "./svgEscape.js";
import {
  DISCORD_BLURPLE,
  DISCORD_DARK_BG,
  DISCORD_NEUTRAL_PILL,
  DISCORD_STALE,
  accentForRole,
  readableTextOn,
  tintForPill,
} from "./color.js";
import type { ResolvedBadge } from "./types.js";

const FONT_FAMILY =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const FONT_SIZE_PX = 13;
const HEIGHT_PX = 22;
const PADDING_X = 8;
const SUFFIX_GAP = 6;
const SEPARATOR_PADDING = 6;

/**
 * Crude width estimator. We do not have a real font metric inside Node, so
 * we approximate: 7.0px per ASCII char, 12px per non-ASCII char, plus a small
 * fudge for the glyph (@ or #). Good enough for layout; SVG text is centered
 * to the computed pill width.
 */
function estimateTextWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x80) w += 7.0;
    else if (code < 0x800) w += 9.0;
    else w += 12.0;
  }
  return Math.ceil(w);
}

export function renderBadgeSvg(badge: ResolvedBadge): string {
  const isStale = badge.stale;
  const prefix = badge.prefix;
  const name = badge.displayName || `unknown ${badge.kind}`;
  const suffix = badge.suffix?.trim() || "";

  let pillBg: string;
  let mainText: string;
  let mainColor: string;

  if (isStale) {
    pillBg = DISCORD_NEUTRAL_PILL;
    mainColor = DISCORD_STALE;
  } else if (badge.kind === "role") {
    const accent = accentForRole(badge.colorHex || DISCORD_BLURPLE);
    pillBg = tintForPill(accent, 0.28);
    mainColor = accent;
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

  mainText = `${prefix}${name}`;
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
  const radius = HEIGHT_PX / 2;

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
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${HEIGHT_PX}" viewBox="0 0 ${totalWidth} ${HEIGHT_PX}" role="img" aria-label="${titleText}">`,
  );
  parts.push(`<title>${titleText}</title>`);
  parts.push(`<desc>${descText}</desc>`);
  parts.push(
    `<rect x="0" y="0" width="${totalWidth}" height="${HEIGHT_PX}" rx="${radius}" ry="${radius}" fill="${pillBg}"/>`,
  );
  parts.push(
    `<text x="${mainTextX}" y="15" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE_PX}" font-weight="600" fill="${mainColor}" text-rendering="geometricPrecision">${escapedMain}</text>`,
  );
  if (suffix) {
    parts.push(
      `<rect x="${sepX + SEPARATOR_PADDING}" y="6" width="1" height="${HEIGHT_PX - 12}" fill="${suffixColor}" opacity="0.5"/>`,
    );
    parts.push(
      `<text x="${suffixTextX}" y="15" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE_PX}" font-weight="400" fill="${suffixColor}" text-rendering="geometricPrecision">${escapedSuffix}</text>`,
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
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT_PX}" viewBox="0 0 ${width} ${HEIGHT_PX}" role="img" aria-label="${safe}">`,
    `<title>${safe}</title>`,
    `<desc>Pawtropolis Tech badge fallback</desc>`,
    `<rect x="0" y="0" width="${width}" height="${HEIGHT_PX}" rx="${HEIGHT_PX / 2}" ry="${HEIGHT_PX / 2}" fill="${DISCORD_NEUTRAL_PILL}"/>`,
    `<text x="${PADDING_X}" y="15" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE_PX}" fill="${DISCORD_STALE}">${safe}</text>`,
    `</svg>`,
  ].join("");
}

export const BADGE_HEIGHT = HEIGHT_PX;
export const BADGE_FONT_FAMILY = FONT_FAMILY;
export { DISCORD_DARK_BG };
